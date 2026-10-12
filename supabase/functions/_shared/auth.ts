// Shared auth helpers for admin-facing Edge Functions.
//
// Pattern: each admin Edge Function expects a `Authorization: Bearer <jwt>`
// header from a logged-in admin/superadmin. We decode the JWT, verify it via
// the anon client's `auth.getClaims`, and check the role with the existing
// `is_admin_or_superadmin` Postgres function.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getPublishableKey } from "../_shared/supabase-keys.ts";

export interface AuthedAdmin {
  userId: string;
}

/**
 * Verifies a user JWT (signature + expiry) and returns its claims, or null.
 * Replaces the old `decodeJwtPayload`, which only base64-decoded the token and
 * therefore accepted forged tokens on functions with verify_jwt = false.
 */
export async function verifyJwtClaims(token: string): Promise<Record<string, unknown> | null> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = getPublishableKey();
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await anon.auth.getClaims(token);
  if (error || !data?.claims?.sub) return null;
  return data.claims as Record<string, unknown>;
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
  const SUPABASE_ANON_KEY = getPublishableKey();

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

/**
 * Like requireAdmin but also accepts a doctor user provided they are the
 * `expectedDoctorId`. Used by office CRUD endpoints where both an admin and
 * the office's owning doctor are valid callers.
 */
export async function requireAdminOrDoctor(
  req: Request,
  supabase: SupabaseClient,
  expectedDoctorId: string
): Promise<{ ok: true; userId: string; isAdmin: boolean } | { ok: false; status: number; error: string }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return { ok: false, status: 401, error: "Unauthorized" };
  const token = authHeader.slice("Bearer ".length);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = getPublishableKey();
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: claimsData, error: claimsErr } = await anon.auth.getClaims(token);
  if (claimsErr || !claimsData?.claims?.sub) {
    return { ok: false, status: 401, error: "Invalid token" };
  }
  const userId = claimsData.claims.sub as string;

  const [{ data: isAdmin }, { data: userRow }] = await Promise.all([
    supabase.rpc("is_admin_or_superadmin", { _user_id: userId }),
    supabase.from("users").select("doctor_id").eq("id", userId).maybeSingle(),
  ]);

  if (isAdmin) return { ok: true, userId, isAdmin: true };
  if (userRow?.doctor_id === expectedDoctorId) return { ok: true, userId, isAdmin: false };
  return { ok: false, status: 403, error: "Forbidden" };
}
