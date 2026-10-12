// Unit tests for _shared helpers (P-001..P-004 in docs/findmed-migration/pruebas.md).
//
//   npx deno test --allow-read --allow-env supabase/tests/shared-helpers_test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";
import { generateManageToken, generateSecureToken } from "../functions/_shared/manage-token.ts";
import { isServiceRequest } from "../functions/_shared/service-auth.ts";
import { getPublishableKey, getServiceKey } from "../functions/_shared/supabase-keys.ts";
import {
  isValidLocalDate,
  isValidLocalTime,
  msToMxIso,
  mxDayBoundsMs,
  mxLocalToMs,
  mxToday,
} from "../functions/_shared/mx-time.ts";

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = Deno.env.get(k);
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

Deno.test("P-001 generateSecureToken: length, alphabet, no collisions", () => {
  const t = generateManageToken();
  assertEquals(t.length, 32);
  assert(/^[A-HJ-NP-Za-km-z2-9]+$/.test(t), "unexpected characters");
  const set = new Set(Array.from({ length: 2000 }, () => generateSecureToken()));
  assertEquals(set.size, 2000);
});

Deno.test("P-002 isServiceRequest accepts only server keys", () => {
  withEnv(
    { SUPABASE_SERVICE_ROLE_KEY: "legacy-jwt", SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_abc" }) },
    () => {
      const r = (h: Record<string, string>) => isServiceRequest(new Request("http://x", { headers: h }));
      assertEquals(r({}), false);
      assertEquals(r({ Authorization: "Bearer legacy-jwt" }), true);
      assertEquals(r({ Authorization: "Bearer legacy-jwX" }), false);
      assertEquals(r({ apikey: "sb_secret_abc" }), true);
      assertEquals(r({ Authorization: "Bearer sb_secret_abc" }), true);
      assertEquals(r({ apikey: "sb_publishable_xyz", Authorization: "Bearer user.jwt.token" }), false);
    },
  );
});

Deno.test("P-003 mx-time conversions", () => {
  assertEquals(msToMxIso(mxLocalToMs("2026-10-12", "09:30")), "2026-10-12T09:30:00-06:00");
  assertEquals(new Date(mxLocalToMs("2026-10-12", "09:30")).toISOString(), "2026-10-12T15:30:00.000Z");
  assertEquals(msToMxIso(mxLocalToMs("2026-10-12", "23:45") + 30 * 60_000), "2026-10-13T00:15:00-06:00");
  const { startMs, endMs } = mxDayBoundsMs("2026-10-12");
  assertEquals(new Date(startMs).toISOString(), "2026-10-12T06:00:00.000Z");
  assertEquals(endMs - startMs, 86_400_000);
  assertEquals(mxToday(Date.parse("2026-10-13T05:59:00Z")), "2026-10-12");
  assertEquals(mxToday(Date.parse("2026-10-13T06:00:00Z")), "2026-10-13");
  assertEquals(isValidLocalDate("2026-02-30"), false);
  assertEquals(isValidLocalDate("2026-10-12"), true);
  assertEquals(isValidLocalTime("24:00"), false);
  assertEquals(isValidLocalTime("9:30"), false);
  assertEquals(isValidLocalTime("09:30"), true);
});

Deno.test("P-004 supabase-keys prefers new keys and falls back to legacy", () => {
  withEnv({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_new" }), SUPABASE_SERVICE_ROLE_KEY: "legacy" }, () =>
    assertEquals(getServiceKey(), "sb_secret_new"));
  withEnv({ SUPABASE_SECRET_KEYS: undefined, SUPABASE_SERVICE_ROLE_KEY: "legacy" }, () =>
    assertEquals(getServiceKey(), "legacy"));
  withEnv({ SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ other: "sb_publishable_x" }), SUPABASE_ANON_KEY: "anon" }, () =>
    assertEquals(getPublishableKey(), "sb_publishable_x"));
});
