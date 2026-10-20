// Creates a 72-hour reservation session and its /reserva link for an explicit
// (doctor, office) pair. Shared by `triage-webhook` (legacy HTTP contract) and
// the FindMed MCP tool `create_booking_link`.
//
// A booking link is an INVITATION to book, not an appointment (F08/X12): the
// appointment exists only after the patient picks a slot in /reserva
// (reserve-create). Callers must word it that way.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isValidNormalizedPhone, normalizeMxPhone } from "./phone.ts";
import { cleanPersonName, matchOrCreatePatient } from "./patient-identity.ts";
import { generateSecureToken } from "./manage-token.ts";
import { appBaseUrl } from "./events.ts";

export const SESSION_TTL_MS = 72 * 60 * 60 * 1000;

export type BookingSessionResult =
  | {
    ok: true;
    session_id: string;
    token: string;
    reserve_url: string;
    expires_at: string;
    patient_id: string;
    doctor_name: string;
    office_id: string;
    office_name: string;
    office_address: string | null;
  }
  | { ok: false; status: number; code: "invalid_phone" | "doctor_not_found" | "office_not_found" | "db_error"; message_es: string };

export async function createReservationSession(
  supabase: SupabaseClient,
  input: { doctorId: string; officeId: string; patientName: string; patientPhone: string; symptoms?: string | null },
): Promise<BookingSessionResult> {
  const phone = normalizeMxPhone(input.patientPhone);
  if (!isValidNormalizedPhone(phone)) {
    return { ok: false, status: 400, code: "invalid_phone", message_es: "El teléfono del paciente no es válido." };
  }

  const { data: doctor } = await supabase
    .from("doctors")
    .select("id, full_name")
    .eq("id", input.doctorId)
    .eq("is_active", true)
    .eq("is_deleted", false)
    .maybeSingle();
  if (!doctor) return { ok: false, status: 404, code: "doctor_not_found", message_es: "El médico no está disponible." };

  // The office must belong to that doctor and be active (X02, R17).
  const { data: office } = await supabase
    .from("doctor_offices")
    .select("id, name, address, doctor_id, is_active, is_deleted")
    .eq("id", input.officeId)
    .eq("doctor_id", input.doctorId)
    .maybeSingle();
  if (!office || !office.is_active || office.is_deleted) {
    return { ok: false, status: 404, code: "office_not_found", message_es: "Ese consultorio no está disponible." };
  }

  // Match-or-create the patient by every +52/+521 variant. The phone's owner
  // (titular) is never renamed: `patientName` is who will be attended (it can
  // be a relative booking with the titular's number) and travels on the
  // session to the appointment (garantía 20-oct-2026, patient-identity.ts).
  const name = cleanPersonName(input.patientName);
  const matched = await matchOrCreatePatient(supabase, { canonicalPhone: phone, name });
  if (!matched.ok) {
    console.error("[booking-session] patient match/insert failed:", matched.error);
    return { ok: false, status: 500, code: "db_error", message_es: "No pudimos registrar al paciente." };
  }
  const patientId = matched.patientId;

  const token = generateSecureToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const { data: session, error: sErr } = await supabase
    .from("reservation_sessions")
    .insert({
      doctor_id: input.doctorId,
      office_id: input.officeId,
      patient_id: patientId,
      patient_name: name,
      token,
      symptoms: input.symptoms?.trim() || null,
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (sErr || !session) {
    console.error("[booking-session] session insert failed:", sErr);
    return { ok: false, status: 500, code: "db_error", message_es: "No pudimos generar el enlace de reserva." };
  }

  return {
    ok: true,
    session_id: session.id,
    token,
    reserve_url: `${appBaseUrl()}/reserva?token=${token}`,
    expires_at: expiresAt,
    patient_id: patientId,
    doctor_name: doctor.full_name,
    office_id: office.id,
    office_name: office.name,
    office_address: office.address,
  };
}
