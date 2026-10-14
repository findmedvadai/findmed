// Moving an appointment in place — the write shared by admin-reschedule-appointment
// and doctor-reschedule-appointment (the patient flow, manage-reschedule,
// creates a new appointment instead).
//
// Rules (audit 14-oct):
//  * Only live appointments move. A cancelled or completed one can't come back
//    to the agenda through a reschedule (the admin dialog offered "Reagendar"
//    on completed appointments and the functions only rejected cancelled).
//  * The UPDATE is guarded on the status that was read: a patient cancelling,
//    the auto-cancel cron or another person acting at the same time wins and
//    the reschedule reports concurrent_change instead of overwriting it.
//  * Reminder markers are cleared: they belong to the old date. Otherwise an
//    appointment moved after its 48 h reminder never got one for the new date,
//    the patient was never asked to confirm, and auto-cancel cancelled it.
//  * A `scheduled` appointment moved to less than 48 h ahead becomes
//    `confirmed`, the same rule as booking (reserve-create, manage-reschedule).
//    Without it, moving it inside the doctor's confirmation window made
//    auto-cancel-unconfirmed cancel it within 15 minutes ("no confirmó a tiempo").
//  * The patient's still-valid /gestionar links follow the appointment: they
//    expire at the NEW end (they used to die at the old end time).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const MOVABLE_STATUSES = ["scheduled", "confirmed"] as const;
const AUTO_CONFIRM_MS = 48 * 60 * 60 * 1000;

export type StaffMoveResult =
  | { ok: true; status: string; auto_confirmed: boolean }
  | { ok: false; code: "not_movable" | "concurrent_change" | "slot_conflict" | "db_error"; message_es: string };

const MESSAGES_ES = {
  not_movable: "Solo se pueden reagendar citas agendadas o confirmadas.",
  concurrent_change: "La cita cambió mientras la reagendabas (por ejemplo, el paciente la canceló). Recarga y revisa su estado.",
  slot_conflict: "Ese horario ya está ocupado.",
  db_error: "No se pudo reagendar la cita.",
} as const;

export function isMovable(status: string | null | undefined): boolean {
  return (MOVABLE_STATUSES as readonly string[]).includes(status ?? "");
}

export async function moveAppointment(
  supabase: SupabaseClient,
  appt: { id: string; status: string },
  startAt: string,
  endAt: string,
  now = Date.now(),
): Promise<StaffMoveResult> {
  if (!isMovable(appt.status)) return { ok: false, code: "not_movable", message_es: MESSAGES_ES.not_movable };

  const autoConfirm = appt.status === "scheduled" && Date.parse(startAt) - now < AUTO_CONFIRM_MS;
  const status = autoConfirm ? "confirmed" : appt.status;

  const { data, error } = await supabase
    .from("appointments")
    .update({ start_at: startAt, end_at: endAt, status, reminder_48h_sent_at: null, reminder_day_of_sent_at: null })
    .eq("id", appt.id)
    .eq("status", appt.status)
    .select("id")
    .maybeSingle();
  if (error) {
    // 23P01 = appointments_no_overlap_per_doctor: a concurrent booking took the slot.
    if ((error as { code?: string }).code === "23P01") {
      return { ok: false, code: "slot_conflict", message_es: MESSAGES_ES.slot_conflict };
    }
    console.error("[staff-reschedule] update failed:", error);
    return { ok: false, code: "db_error", message_es: MESSAGES_ES.db_error };
  }
  if (!data) return { ok: false, code: "concurrent_change", message_es: MESSAGES_ES.concurrent_change };

  const { error: tokErr } = await supabase
    .from("appointment_manage_tokens")
    .update({ expires_at: endAt })
    .eq("appointment_id", appt.id)
    .gt("expires_at", new Date(now).toISOString());
  if (tokErr) console.error("[staff-reschedule] manage token expiry not extended:", tokErr);

  return { ok: true, status, auto_confirmed: autoConfirm };
}
