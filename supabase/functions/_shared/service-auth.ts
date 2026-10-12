// Server-to-server auth for Edge Functions that must only be reachable by our
// own backend: pg_cron jobs (which send the key stored in Vault) and other
// Edge Functions (which send their SUPABASE_SERVICE_ROLE_KEY env).
//
// Accepts the legacy service_role key and, to allow migrating off it (the
// legacy key leaked in a public commit, see ERRORES.md 2026-10-12), any of the
// new `sb_secret_...` keys injected by the runtime in SUPABASE_SECRET_KEYS.
// The key may arrive as `Authorization: Bearer <key>` or as the `apikey` header.

function serviceKeys(): string[] {
  const keys: string[] = [];
  // Dedicated credential for pg_cron → Edge Function calls (Vault secret
  // `service_role_key` holds this value since 2026-10-12). It is independent
  // of Supabase API keys, so rotating/revoking those never breaks the crons.
  const cron = Deno.env.get("FINDMED_CRON_SECRET");
  if (cron) keys.push(cron);
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) keys.push(legacy);

  const secretKeysJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeysJson) {
    try {
      const parsed = JSON.parse(secretKeysJson) as Record<string, string>;
      for (const value of Object.values(parsed)) {
        if (typeof value === "string" && value) keys.push(value);
      }
    } catch {
      console.error("[service-auth] SUPABASE_SECRET_KEYS is not valid JSON");
    }
  }
  return keys;
}

// Constant-time string comparison so the key can't be guessed byte by byte.
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

export function isServiceRequest(req: Request): boolean {
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const apikey = req.headers.get("apikey") ?? "";
  const candidates = [bearer, apikey].filter(Boolean);
  if (candidates.length === 0) return false;

  const keys = serviceKeys();
  return candidates.some((c) => keys.some((k) => timingSafeEqual(c, k)));
}
