// Shared resolver for the calendar Edge Functions. Each calendar API endpoint
// (list / events / create-event / update-event / delete-event) receives an
// `office_id` and must verify:
//   1. The caller is the owning doctor or an admin/superadmin.
//   2. The office exists and is not soft-deleted.
//
// For the read paths that aggregate multiple offices (typically the admin
// "filtered by doctor, no specific office" view), `resolveOfficesForDoctor`
// returns every active, non-deleted office of a given doctor — the caller
// must be admin or that doctor.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface OfficeRow {
  id: string;
  doctor_id: string;
  name: string;
  address: string | null;
  city_id: string | null;
  zone_id: string | null;
  google_calendar_connected: boolean;
  google_refresh_token_ref: string | null;
  google_calendar_id: string | null;
  outlook_calendar_connected: boolean;
  outlook_refresh_token_ref: string | null;
  outlook_calendar_id: string | null;
  appointment_duration_minutes: number;
  is_active: boolean;
  is_deleted: boolean;
}

const OFFICE_SELECT =
  "id, doctor_id, name, address, city_id, zone_id, " +
  "google_calendar_connected, google_refresh_token_ref, google_calendar_id, " +
  "outlook_calendar_connected, outlook_refresh_token_ref, outlook_calendar_id, " +
  "appointment_duration_minutes, is_active, is_deleted";

export async function isCallerAdmin(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase.rpc("is_admin_or_superadmin", { _user_id: userId });
  return Boolean(data);
}

export async function getCallerDoctorId(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("users")
    .select("doctor_id")
    .eq("id", userId)
    .maybeSingle();
  return data?.doctor_id ?? null;
}

/**
 * Resolve a single office for an authenticated caller. Allowed when:
 *   - The caller is admin/superadmin, OR
 *   - The caller is the doctor that owns the office.
 *
 * Returns null with a status code when the office doesn't exist or the
 * caller can't access it. Caller maps statuses to HTTP responses.
 */
export async function resolveOfficeForCaller(
  supabase: SupabaseClient,
  userId: string,
  officeId: string
): Promise<{ office: OfficeRow } | { error: string; status: number }> {
  const { data: office } = await supabase
    .from("doctor_offices")
    .select(OFFICE_SELECT)
    .eq("id", officeId)
    .maybeSingle();

  if (!office || office.is_deleted) {
    return { error: "Consultorio no encontrado", status: 404 };
  }

  const [admin, callerDoctorId] = await Promise.all([
    isCallerAdmin(supabase, userId),
    getCallerDoctorId(supabase, userId),
  ]);

  if (!admin && office.doctor_id !== callerDoctorId) {
    return { error: "No autorizado para este consultorio", status: 403 };
  }

  return { office: office as OfficeRow };
}

/**
 * Returns every active, non-deleted office of `doctorId` provided the caller
 * is admin or the doctor itself. Used for read paths that want to aggregate
 * across all offices of a doctor.
 */
export async function resolveOfficesForDoctor(
  supabase: SupabaseClient,
  userId: string,
  doctorId: string
): Promise<{ offices: OfficeRow[] } | { error: string; status: number }> {
  const [admin, callerDoctorId] = await Promise.all([
    isCallerAdmin(supabase, userId),
    getCallerDoctorId(supabase, userId),
  ]);

  if (!admin && callerDoctorId !== doctorId) {
    return { error: "No autorizado", status: 403 };
  }

  const { data: offices } = await supabase
    .from("doctor_offices")
    .select(OFFICE_SELECT)
    .eq("doctor_id", doctorId)
    .eq("is_active", true)
    .eq("is_deleted", false);

  return { offices: (offices ?? []) as OfficeRow[] };
}

/**
 * Convenience: parse `office_id` and `doctor_id` from a request URL. The
 * calendar Edge Functions accept either; office_id wins when both are
 * present (it's strictly narrower).
 */
export function parseTargetParams(req: Request): {
  officeId: string | null;
  doctorId: string | null;
} {
  const url = new URL(req.url);
  return {
    officeId: url.searchParams.get("office_id"),
    doctorId: url.searchParams.get("doctor_id"),
  };
}
