// External-system auth (n8n / WhatsApp bot): `Authorization: Bearer fm_...`
// validated by SHA-256 against `api_keys.key_hash`. Same contract as the
// inline check in triage-webhook / search-doctors / update-appointment-status.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function verifyApiKey(req: Request, supabase: SupabaseClient): Promise<boolean> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const rawKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!rawKey.startsWith("fm_")) return false;

  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
  const keyHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const { data: apiKey } = await supabase
    .from("api_keys")
    .select("id")
    .eq("key_hash", keyHash)
    .eq("is_active", true)
    .maybeSingle();
  if (!apiKey) return false;

  // Fire-and-forget usage tracking.
  supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", apiKey.id)
    .then(() => {});
  return true;
}
