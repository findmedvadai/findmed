// Signed OAuth `state` for the Google / Outlook calendar connect flow (N12).
//
// Before: state was `${doctorId}:${officeId}:${b64(origin)}` in clear text. The
// callback trusted it blindly, so anyone could (a) craft a state for ANY office
// and attach their own Google/Microsoft account to it — every appointment of
// that office would then be written into the attacker's calendar — and (b)
// make the callback redirect to any origin (open redirect).
//
// Now: state = base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload)).
//   payload = { v, p: provider, d: doctorId, o: officeId, r: origin, u: userId,
//               n: random nonce, e: expiry epoch ms }
// The HMAC key is derived from the project's service key (no new secret):
//   key = HMAC-SHA256(serviceKey, "findmed-oauth-state-v1")
// so it never leaves the Edge runtime and rotates with the service key. States
// expire after 15 minutes; signatures are compared in constant time.
//
// The redirect origin is double-checked: *-auth only signs allow-listed origins
// and the callback re-applies the allow-list before redirecting. Anything else
// falls back to the APP_URL origin.
//
// Known limit: state is not bound to the browser that started the flow (no
// cookie) nor single-use (no nonce table). A user with access to an office can
// still hand a fresh state to someone else within 15 minutes; doing better
// needs a server-side nonce store.

import { getServiceKey } from "./supabase-keys.ts";
import { timingSafeEqual } from "./service-auth.ts";

export type OAuthProvider = "google" | "outlook";

export const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;
const KEY_CONTEXT = "findmed-oauth-state-v1";

export interface OAuthStateData {
  provider: OAuthProvider;
  doctorId: string;
  officeId: string;
  /** Frontend origin that started the flow (allow-listed when signed), or null. */
  origin: string | null;
  /** Auth user that started the flow (audit/debug only). */
  userId: string | null;
}

export type OAuthStateResult =
  | { ok: true; data: OAuthStateData; expiresAt: number }
  // Signature is valid, so `data` is trustworthy (used to send the popup back
  // to the right origin with an error), but the flow must not continue.
  | { ok: false; reason: "expired"; data: OAuthStateData }
  | { ok: false; reason: "malformed" | "bad_signature" | "wrong_provider" };

interface Payload {
  v: 1;
  p: OAuthProvider;
  d: string;
  o: string;
  r: string | null;
  u: string | null;
  n: string;
  e: number;
}

interface SignOptions {
  /** Defaults to Date.now(). */
  now?: number;
  /** Defaults to getServiceKey(). Tests pass their own. */
  secret?: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmacSha256(key: BufferSource, data: BufferSource): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, data);
}

/** HMAC(derivedKey, body) where derivedKey = HMAC(serviceKey, KEY_CONTEXT). */
async function signBody(body: string, secret: string): Promise<string> {
  const derived = await hmacSha256(enc.encode(secret), enc.encode(KEY_CONTEXT));
  return b64urlEncode(await hmacSha256(derived, enc.encode(body)));
}

function isProvider(p: unknown): p is OAuthProvider {
  return p === "google" || p === "outlook";
}

function parsePayload(bytes: Uint8Array): Payload | null {
  try {
    const p = JSON.parse(dec.decode(bytes)) as Partial<Payload> | null;
    if (
      !p ||
      p.v !== 1 ||
      !isProvider(p.p) ||
      typeof p.d !== "string" || !p.d ||
      typeof p.o !== "string" || !p.o ||
      (p.r !== null && typeof p.r !== "string") ||
      (p.u !== null && typeof p.u !== "string") ||
      typeof p.n !== "string" || !p.n ||
      typeof p.e !== "number" || !Number.isFinite(p.e)
    ) {
      return null;
    }
    return p as Payload;
  } catch {
    return null;
  }
}

export async function signOAuthState(data: OAuthStateData, opts: SignOptions = {}): Promise<string> {
  const now = opts.now ?? Date.now();
  const secret = opts.secret ?? getServiceKey();
  const payload: Payload = {
    v: 1,
    p: data.provider,
    d: data.doctorId,
    o: data.officeId,
    r: data.origin,
    u: data.userId,
    n: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))),
    e: now + OAUTH_STATE_TTL_MS,
  };
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  return `${body}.${await signBody(body, secret)}`;
}

export async function verifyOAuthState(
  state: string | null | undefined,
  expectedProvider: OAuthProvider,
  opts: SignOptions = {},
): Promise<OAuthStateResult> {
  if (!state) return { ok: false, reason: "malformed" };
  const parts = state.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [body, signature] = parts;

  const secret = opts.secret ?? getServiceKey();
  const expected = await signBody(body, secret);
  if (!timingSafeEqual(signature, expected)) return { ok: false, reason: "bad_signature" };

  const bytes = b64urlDecode(body);
  const payload = bytes ? parsePayload(bytes) : null;
  if (!payload) return { ok: false, reason: "malformed" };
  if (payload.p !== expectedProvider) return { ok: false, reason: "wrong_provider" };

  const data: OAuthStateData = {
    provider: payload.p,
    doctorId: payload.d,
    officeId: payload.o,
    origin: payload.r,
    userId: payload.u,
  };
  const now = opts.now ?? Date.now();
  if (payload.e <= now) return { ok: false, reason: "expired", data };
  return { ok: true, data, expiresAt: payload.e };
}

// ---------------------------------------------------------------------------
// Redirect origin allow-list
// ---------------------------------------------------------------------------

/** Production frontend; also the fallback when APP_URL is missing or invalid. */
export const DEFAULT_APP_ORIGIN = "https://app.findmed.com.mx";

const STATIC_ALLOWED_ORIGINS = [
  DEFAULT_APP_ORIGIN,
  "http://localhost:5173", // vite dev (CLAUDE.md)
  "http://localhost:8080", // vite dev (vite.config.ts server.port)
  "http://localhost:4173", // vite preview
];

/** Canonical origin ("scheme://host[:port]") of an http(s) URL, or null. */
export function normalizeOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Origin of APP_URL (the deployed frontend, e.g. on Vercel), else app.findmed.com.mx. */
export function appOrigin(): string {
  return normalizeOrigin(Deno.env.get("APP_URL")) ?? DEFAULT_APP_ORIGIN;
}

/**
 * Origins the OAuth popup may return to: production, local dev ports, the
 * APP_URL origin and any extra origin listed (comma-separated) in the optional
 * OAUTH_ALLOWED_ORIGINS env var (e.g. a Vercel preview domain). Not a secret.
 */
export function allowedOAuthOrigins(): Set<string> {
  const allowed = new Set<string>(STATIC_ALLOWED_ORIGINS);
  allowed.add(appOrigin());
  for (const extra of (Deno.env.get("OAUTH_ALLOWED_ORIGINS") ?? "").split(",")) {
    const origin = normalizeOrigin(extra);
    if (origin) allowed.add(origin);
  }
  return allowed;
}

/** The origin itself when allow-listed; otherwise the APP_URL origin. */
export function resolveOAuthRedirectOrigin(raw: string | null | undefined): string {
  const origin = normalizeOrigin(raw);
  return origin && allowedOAuthOrigins().has(origin) ? origin : appOrigin();
}
