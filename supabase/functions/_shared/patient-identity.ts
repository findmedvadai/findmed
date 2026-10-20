// Who is who when one phone books for several people (garantía 20-oct-2026).
//
// `patients` is keyed by phone: the row belongs to the TITULAR, the person who
// owns the number and writes on WhatsApp. A mother can book for her son with
// her own number. Until 20-oct every booking did
// `UPDATE patients SET full_name = <name received>`, so booking for the son
// renamed the mother and every past and future appointment showed his name.
//
// Rule now:
//   * patients.full_name is the titular. A booking never renames an existing
//     patient, except to fill a placeholder ("Paciente", empty, or a phone).
//   * The name received with the booking is the person attended in THAT
//     appointment → appointments.patient_name (reservation_sessions.patient_name
//     carries it from the /reserva link to reserve-create).
//   * Screens and messages show `appointments.patient_name ?? patients.full_name`.
//
// Shared by booking-session (MCP create_booking_link / triage-webhook),
// admin-create-appointment and doctor-create-appointment.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mxPhoneLookupVariants } from "./phone.ts";

export const PERSON_NAME_MAX = 120;

/** Collapses whitespace and trims; null when empty or not a string. */
export function cleanPersonName(raw: unknown, max = PERSON_NAME_MAX): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.replace(/\s+/g, " ").trim().slice(0, max).trim();
  return v.length > 0 ? v : null;
}

/** A name nobody chose: empty, the "Paciente" placeholder, or just digits/phone symbols. */
export function isPlaceholderName(name: string | null | undefined): boolean {
  const v = (name ?? "").trim();
  if (!v) return true;
  if (v.toLowerCase() === "paciente") return true;
  return /^[+\d\s()\-.]+$/.test(v);
}

/** Name to show for an appointment: who is attended, else the titular. */
export function attendedName(
  appointmentPatientName: string | null | undefined,
  titularName: string | null | undefined,
): string | null {
  return cleanPersonName(appointmentPatientName) ?? cleanPersonName(titularName);
}

export type MatchPatientResult =
  | { ok: true; patientId: string; created: boolean; titularName: string }
  | { ok: false; error: string };

/**
 * Match-or-create the patient by every +52/+521 variant of `canonicalPhone`.
 * Never renames an existing patient unless its name is a placeholder.
 */
export async function matchOrCreatePatient(
  supabase: SupabaseClient,
  input: { canonicalPhone: string; name: string | null },
): Promise<MatchPatientResult> {
  const variants = mxPhoneLookupVariants(input.canonicalPhone);
  const name = cleanPersonName(input.name);

  const find = async () => {
    const { data, error } = await supabase
      .from("patients")
      .select("id, full_name")
      .in("phone", variants)
      .order("created_at", { ascending: true })
      .limit(1);
    return { row: (data as { id: string; full_name: string | null }[] | null)?.[0] ?? null, error };
  };

  const adopt = async (row: { id: string; full_name: string | null }): Promise<MatchPatientResult> => {
    if (name && isPlaceholderName(row.full_name)) {
      await supabase.from("patients").update({ full_name: name }).eq("id", row.id);
      return { ok: true, patientId: row.id, created: false, titularName: name };
    }
    return { ok: true, patientId: row.id, created: false, titularName: row.full_name ?? name ?? "Paciente" };
  };

  const existing = await find();
  if (existing.error) return { ok: false, error: existing.error.message };
  if (existing.row) return adopt(existing.row);

  const { data: created, error } = await supabase
    .from("patients")
    .insert({ full_name: name ?? "Paciente", phone: input.canonicalPhone })
    .select("id")
    .single();
  if (error || !created) {
    // Created meanwhile by another flow (patients.phone is UNIQUE).
    if ((error as { code?: string } | null)?.code === "23505") {
      const raced = await find();
      if (raced.row) return adopt(raced.row);
    }
    return { ok: false, error: error?.message ?? "insert_failed" };
  }
  return { ok: true, patientId: (created as { id: string }).id, created: true, titularName: name ?? "Paciente" };
}
