// Shared auth helpers for admin-facing Edge Functions.
//
// Pattern: each admin Edge Function expects a `Authorization: Bearer <jwt>`
// header from a logged-in admin/superadmin. We decode the JWT, verify it via
// the anon client's `auth.getClaims`, and check the role with the existing
// `is_admin_or_superadmin` Postgres function.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface AuthedAdmin {
  userId: string;
}

export async function requireAdmin(
  req: Request,
  supabase: SupabaseClient
): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  const token = authHeader.slice("Bearer ".length);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  // We need to verify the JWT belongs to a real authenticated user. Using the
  // anon client with the user's bearer token validates the signature/expiry
  // and exposes the claims; the service-role client (passed in) is used for
  // the actual data work after authorization passes.
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: claimsData, error: claimsErr } = await anon.auth.getClaims(token);
  if (claimsErr || !claimsData?.claims?.sub) {
    return { ok: false, status: 401, error: "Invalid token" };
  }
  const userId = claimsData.claims.sub as string;

  const { data: isAdmin, error: roleErr } = await supabase.rpc("is_admin_or_superadmin", {
    _user_id: userId,
  });
  if (roleErr || !isAdmin) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  return { ok: true, userId };
}
