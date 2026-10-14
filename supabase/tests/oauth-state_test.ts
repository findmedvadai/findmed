// Unit tests for _shared/oauth-state.ts (N12: OAuth state firmado + redirección abierta).
//
//   npx -y deno test --no-lock --node-modules-dir=none --allow-read --allow-env supabase/tests/oauth-state_test.ts

import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import {
  allowedOAuthOrigins,
  appOrigin,
  normalizeOrigin,
  OAUTH_STATE_TTL_MS,
  type OAuthStateData,
  resolveOAuthRedirectOrigin,
  signOAuthState,
  verifyOAuthState,
} from "../functions/_shared/oauth-state.ts";

const SECRET = "sb_secret_test_key_for_oauth_state";
const NOW = Date.parse("2026-10-13T18:00:00Z");

const DATA: OAuthStateData = {
  provider: "google",
  doctorId: "11111111-1111-4111-8111-111111111111",
  officeId: "22222222-2222-4222-8222-222222222222",
  origin: "http://localhost:5173",
  userId: "33333333-3333-4333-8333-333333333333",
};

function withEnv(vars: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = Deno.env.get(k);
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
  const restore = () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  };
  try {
    const r = fn();
    if (r instanceof Promise) return r.finally(restore);
    restore();
  } catch (e) {
    restore();
    throw e;
  }
}

function b64urlJson(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// Firma
// ---------------------------------------------------------------------------

Deno.test("oauth-state: firma válida se verifica y devuelve los datos", async () => {
  const state = await signOAuthState(DATA, { secret: SECRET, now: NOW });
  assert(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(state), "formato body.firma base64url");
  const r = await verifyOAuthState(state, "google", { secret: SECRET, now: NOW + 1000 });
  assert(r.ok);
  if (r.ok) {
    assertEquals(r.data, DATA);
    assertEquals(r.expiresAt, NOW + OAUTH_STATE_TTL_MS);
  }
});

Deno.test("oauth-state: cada state lleva un nonce distinto", async () => {
  const a = await signOAuthState(DATA, { secret: SECRET, now: NOW });
  const b = await signOAuthState(DATA, { secret: SECRET, now: NOW });
  assertNotEquals(a, b);
});

Deno.test("oauth-state: usa la service key del runtime cuando no se pasa secret", async () => {
  await withEnv(
    { SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }), SUPABASE_SERVICE_ROLE_KEY: undefined },
    async () => {
      const state = await signOAuthState(DATA, { now: NOW });
      assert((await verifyOAuthState(state, "google", { now: NOW })).ok);
      // Firmado con la key del runtime = verificable con el mismo secreto explícito.
      assert((await verifyOAuthState(state, "google", { secret: SECRET, now: NOW })).ok);
    },
  );
});

Deno.test("oauth-state: payload alterado (otro consultorio) se rechaza", async () => {
  const state = await signOAuthState(DATA, { secret: SECRET, now: NOW });
  const [body, sig] = state.split(".");
  const payload = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/")));
  payload.o = "99999999-9999-4999-8999-999999999999";
  const forged = `${b64urlJson(payload)}.${sig}`;
  const r = await verifyOAuthState(forged, "google", { secret: SECRET, now: NOW });
  assertEquals(r, { ok: false, reason: "bad_signature" });
});

Deno.test("oauth-state: firma alterada o de otro secreto se rechaza", async () => {
  const state = await signOAuthState(DATA, { secret: SECRET, now: NOW });
  const [body, sig] = state.split(".");
  const flipped = sig[0] === "A" ? `B${sig.slice(1)}` : `A${sig.slice(1)}`;
  assertEquals(
    await verifyOAuthState(`${body}.${flipped}`, "google", { secret: SECRET, now: NOW }),
    { ok: false, reason: "bad_signature" },
  );
  assertEquals(
    await verifyOAuthState(state, "google", { secret: "otra-key", now: NOW }),
    { ok: false, reason: "bad_signature" },
  );
});

Deno.test("oauth-state: state forjado sin firma válida (formato viejo o inventado) se rechaza", async () => {
  const legacy = `${DATA.doctorId}:${DATA.officeId}:${btoa("https://evil.example")}`;
  for (const bad of [legacy, "", "abc", "a.b.c", ".", "x.", ".y"]) {
    const r = await verifyOAuthState(bad, "google", { secret: SECRET, now: NOW });
    assert(!r.ok, `debió rechazar ${JSON.stringify(bad)}`);
  }
  assertEquals(await verifyOAuthState(null, "google", { secret: SECRET }), { ok: false, reason: "malformed" });
});

Deno.test("oauth-state: expira a los 15 minutos (pero conserva el origen firmado)", async () => {
  const state = await signOAuthState(DATA, { secret: SECRET, now: NOW });
  const justBefore = await verifyOAuthState(state, "google", { secret: SECRET, now: NOW + OAUTH_STATE_TTL_MS - 1 });
  assert(justBefore.ok);
  const expired = await verifyOAuthState(state, "google", { secret: SECRET, now: NOW + OAUTH_STATE_TTL_MS });
  assertEquals(expired.ok, false);
  if (!expired.ok) {
    assertEquals(expired.reason, "expired");
    assert("data" in expired && expired.data.origin === DATA.origin);
  }
});

Deno.test("oauth-state: un state de Google no sirve en el callback de Outlook", async () => {
  const state = await signOAuthState(DATA, { secret: SECRET, now: NOW });
  assertEquals(
    await verifyOAuthState(state, "outlook", { secret: SECRET, now: NOW }),
    { ok: false, reason: "wrong_provider" },
  );
});

// ---------------------------------------------------------------------------
// Orígenes permitidos
// ---------------------------------------------------------------------------

Deno.test("oauth-state: orígenes permitidos se respetan", () => {
  withEnv({ APP_URL: "https://findmed-prod.example.app/", OAUTH_ALLOWED_ORIGINS: undefined }, () => {
    for (const origin of [
      "https://app.findmed.com.mx",
      "http://localhost:5173",
      "http://localhost:8080",
      "http://localhost:4173",
      "https://findmed-prod.example.app", // origen de APP_URL (Vercel)
    ]) {
      assertEquals(resolveOAuthRedirectOrigin(origin), origin);
    }
    // Se normaliza a origen: se descarta ruta, query y barra final.
    assertEquals(resolveOAuthRedirectOrigin("https://app.findmed.com.mx/doctor/configuracion?x=1"), "https://app.findmed.com.mx");
  });
});

Deno.test("oauth-state: origen no permitido cae a APP_URL", () => {
  withEnv({ APP_URL: "https://findmed-prod.example.app", OAUTH_ALLOWED_ORIGINS: undefined }, () => {
    for (const origin of [
      "https://evil.example",
      "https://app.findmed.com.mx.evil.example",
      "https://app.findmed.com.mx@evil.example",
      "http://app.findmed.com.mx", // http en producción
      "http://localhost:3000",
      "javascript:alert(1)",
      "//evil.example",
      "no es url",
      "",
      null,
      undefined,
    ]) {
      assertEquals(resolveOAuthRedirectOrigin(origin), "https://findmed-prod.example.app", `origen: ${origin}`);
    }
  });
});

Deno.test("oauth-state: sin APP_URL el respaldo es app.findmed.com.mx", () => {
  withEnv({ APP_URL: undefined, OAUTH_ALLOWED_ORIGINS: undefined }, () => {
    assertEquals(appOrigin(), "https://app.findmed.com.mx");
    assertEquals(resolveOAuthRedirectOrigin("https://evil.example"), "https://app.findmed.com.mx");
  });
  withEnv({ APP_URL: "no-es-una-url", OAUTH_ALLOWED_ORIGINS: undefined }, () => {
    assertEquals(appOrigin(), "https://app.findmed.com.mx");
  });
});

Deno.test("oauth-state: OAUTH_ALLOWED_ORIGINS agrega orígenes extra (previews de Vercel)", () => {
  withEnv(
    { APP_URL: undefined, OAUTH_ALLOWED_ORIGINS: " https://findmed-git-dev-team.vercel.app , basura ,https://staging.example.mx/" },
    () => {
      const allowed = allowedOAuthOrigins();
      assert(allowed.has("https://findmed-git-dev-team.vercel.app"));
      assert(allowed.has("https://staging.example.mx"));
      assert(!allowed.has("basura"));
      assertEquals(resolveOAuthRedirectOrigin("https://staging.example.mx"), "https://staging.example.mx");
    },
  );
});

Deno.test("oauth-state: normalizeOrigin solo acepta http(s) sin credenciales", () => {
  assertEquals(normalizeOrigin("HTTPS://App.FindMed.com.mx:443/x"), "https://app.findmed.com.mx");
  assertEquals(normalizeOrigin("ftp://app.findmed.com.mx"), null);
  assertEquals(normalizeOrigin("https://user:pass@app.findmed.com.mx"), null);
  assertEquals(normalizeOrigin("data:text/html,hola"), null);
});
