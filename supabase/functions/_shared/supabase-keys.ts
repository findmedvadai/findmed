// Single place that resolves which API keys an Edge Function uses.
//
// Supabase injects both the new keys (`SUPABASE_SECRET_KEYS` /
// `SUPABASE_PUBLISHABLE_KEYS`, JSON dictionaries keyed by key name) and the
// legacy JWT keys (`SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY`). The
// legacy service_role key leaked in a public commit (ERRORES.md 2026-10-12) and
// is being revoked, so every function must prefer the new keys and only fall
// back to legacy while the migration is in flight. Nothing outside this file
// should read those env vars directly.

function firstKey(jsonEnv: string): string | null {
  const raw = Deno.env.get(jsonEnv);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    // Prefer the key literally named "default"; otherwise the first non-empty.
    if (typeof parsed.default === "string" && parsed.default) return parsed.default;
    for (const v of Object.values(parsed)) if (typeof v === "string" && v) return v;
  } catch {
    console.error(`[supabase-keys] ${jsonEnv} is not valid JSON`);
  }
  return null;
}

/** Server-side key with full access (bypasses RLS). */
export function getServiceKey(): string {
  const key = firstKey("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("No service key available (SUPABASE_SECRET_KEYS / SUPABASE_SERVICE_ROLE_KEY)");
  return key;
}

/** Public key used to build a client that verifies a user's JWT. */
export function getPublishableKey(): string {
  const key = firstKey("SUPABASE_PUBLISHABLE_KEYS") ?? Deno.env.get("SUPABASE_ANON_KEY");
  if (!key) throw new Error("No publishable key available (SUPABASE_PUBLISHABLE_KEYS / SUPABASE_ANON_KEY)");
  return key;
}
