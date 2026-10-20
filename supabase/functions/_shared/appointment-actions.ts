// Patient-initiated appointment transitions (confirm / cancel), shared by every
// channel: /gestionar (manage-cancel), WhatsApp buttons and the legacy n8n
// endpoints (confirm-appointment, update-appointment-status), and the FindMed
// MCP (commit_appointment_action).
//
// Guarantees (X09, F14 in docs/findmed-migration):
//  * the caller always names ONE appointment_id — resolving "the patient's
//    appointment" from a phone is the caller's job and must be unambiguous;
//  * the status change is a conditional UPDATE on the previous status, so a
//    concurrent transition (cron auto-cancel, staff, another tab) can't be
//    overwritten silently — zero rows means "someone else changed it";
//  * appointments whose start already passed can't be confirmed/cancelled;
//  * cancelling also deletes the Google/Outlook event and reports the result;
//  * the same notification + events are emitted whatever the channel.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { deleteAppointmentEvents, type CalendarDeleteResult } from "./calendar-sync.ts";
import { emitEvent, manageUrlFor } from "./events.ts";
import { formatMxLongDateTime } from "./mx-time.ts";
import { attendedName } from "./patient-identity.ts";

export type PatientAction = "confirm" | "cancel";
export type ActionChannel = "web" | "whatsapp" | "mcp" | "api";

export type ActionErrorCode =
  | "not_found"
  | "already_confirmed"
  | "already_cancelled"
  | "invalid_state"
  | "in_past"
  | "concurrent_change"
  | "db_error";

export type ActionResult =
  | {
    ok: true;
    appointment_id: string;
    previous_status: string;
    new_status: "confirmed" | "cancelled";
    calendar?: CalendarDeleteResult;
  }
  | { ok: false; code: ActionErrorCode; message_es: string };

const MESSAGES_ES: Record<ActionErrorCode, string> = {
  not_found: "No encontramos esa cita.",
  already_confirmed: "Tu cita ya estaba confirmada.",
  already_cancelled: "Esta cita ya fue cancelada.",
  invalid_state: "Esta cita ya no se puede modificar.",
  in_past: "Esta cita ya pasó y no se puede modificar.",
  concurrent_change: "La cita cambió mientras procesábamos tu solicitud. Revisa su estado actual.",
  db_error: "No pudimos actualizar la cita. Intenta de nuevo en unos minutos.",
};

const fail = (code: ActionErrorCode): ActionResult => ({ ok: false, code, message_es: MESSAGES_ES[code] });

interface ActionInput {
  appointmentId: string;
  action: PatientAction;
  channel: ActionChannel;
  /** Token the patient used, to build the /gestionar link in events. Optional. */
  manageToken?: string | null;
}

export async function applyPatientAction(supabase: SupabaseClient, input: ActionInput): Promise<ActionResult> {
  const { data: appt, error: readErr } = await supabase
    .from("appointments")
    .select("id, status, doctor_id, office_id, patient_id, patient_name, start_at, end_at, google_event_id, outlook_event_id")
    .eq("id", input.appointmentId)
    .maybeSingle();
  if (readErr) return fail("db_error");
  if (!appt) return fail("not_found");

  if (input.action === "confirm" && appt.status === "confirmed") return fail("already_confirmed");
  if (input.action === "cancel" && appt.status === "cancelled") return fail("already_cancelled");
  const allowedFrom = input.action === "confirm" ? ["scheduled"] : ["scheduled", "confirmed"];
  if (!allowedFrom.includes(appt.status)) return fail("invalid_state");
  if (Date.parse(appt.start_at) <= Date.now()) return fail("in_past");

  const newStatus = input.action === "confirm" ? "confirmed" : "cancelled";
  const patch = input.action === "confirm" ? { status: newStatus } : { status: newStatus, cancel_reason: "patient" };
  const { data: updated, error: updErr } = await supabase
    .from("appointments")
    .update(patch)
    .eq("id", appt.id)
    .eq("status", appt.status) // guard: only if nobody changed it meanwhile
    .select("id")
    .maybeSingle();
  if (updErr) {
    console.error("[appointment-actions] update failed:", updErr);
    return fail("db_error");
  }
  if (!updated) return fail("concurrent_change");

  // Side effects. None of them can undo the transition; failures are logged
  // and (for the calendar) reported back to the caller.
  const calendar = input.action === "cancel" ? await deleteAppointmentEvents(supabase, appt) : undefined;

  const { data: patient } = await supabase
    .from("patients")
    .select("full_name, phone")
    .eq("id", appt.patient_id)
    .maybeSingle();
  const patientName = attendedName(appt.patient_name, patient?.full_name) ?? "Paciente";
  const when = formatMxLongDateTime(appt.start_at); // "martes 14 de octubre, 10:00"
  const via = input.channel === "whatsapp" || input.channel === "mcp" ? " vía WhatsApp" : "";

  await supabase.from("notifications").insert({
    doctor_id: appt.doctor_id,
    appointment_id: appt.id,
    recipient_role: "doctor",
    type: input.action === "confirm" ? "appointment_scheduled" : "appointment_cancelled_by_patient",
    title: input.action === "confirm" ? "Cita confirmada" : "Cita cancelada por paciente",
    body: `${patientName} ${input.action === "confirm" ? "confirmó" : "canceló"} su cita del ${when}${via}`,
  });

  let manageToken = input.manageToken ?? null;
  if (!manageToken) {
    const { data: tok } = await supabase
      .from("appointment_manage_tokens")
      .select("token")
      .eq("appointment_id", appt.id)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    manageToken = tok?.token ?? null;
  }

  const payload = {
    appointment_id: appt.id,
    doctor_id: appt.doctor_id,
    patient_name: attendedName(appt.patient_name, patient?.full_name),
    patient_phone: patient?.phone ?? null,
    start_at: appt.start_at,
    end_at: appt.end_at,
    previous_status: appt.status,
    new_status: newStatus,
    channel: input.channel,
    timestamp: new Date().toISOString(),
    manage_url: manageUrlFor(manageToken),
    ...(input.action === "confirm" ? { confirmed_at: new Date().toISOString() } : { cancel_reason: "patient" }),
  };
  await Promise.all([
    emitEvent(input.action === "confirm" ? "appointment.confirmed" : "appointment.cancelled_by_patient", payload),
    emitEvent("appointment.status_changed", payload),
  ]);

  return { ok: true, appointment_id: appt.id, previous_status: appt.status, new_status: newStatus, calendar };
}

export interface UpcomingAppointment {
  appointment_id: string;
  status: string;
  start_at: string;
  end_at: string;
  doctor_id: string;
  office_id: string | null;
}

/**
 * Upcoming live appointments (scheduled/confirmed, start in the future) of the
 * patient(s) behind a phone. Looks across every patient row matching the +52 /
 * +521 variants instead of picking the oldest one, and returns ALL matches so
 * the caller can ask "which one?" instead of acting on the first row (F14).
 */
export async function findUpcomingAppointmentsByPhone(
  supabase: SupabaseClient,
  phoneVariants: string[],
): Promise<{ ok: true; appointments: UpcomingAppointment[] } | { ok: false }> {
  const { data: patients, error: pErr } = await supabase.from("patients").select("id").in("phone", phoneVariants);
  if (pErr) return { ok: false };
  const ids = (patients ?? []).map((p) => p.id);
  if (ids.length === 0) return { ok: true, appointments: [] };
  const { data, error } = await supabase
    .from("appointments")
    .select("id, status, start_at, end_at, doctor_id, office_id")
    .in("patient_id", ids)
    .in("status", ["scheduled", "confirmed"])
    .gt("start_at", new Date().toISOString())
    .order("start_at", { ascending: true });
  if (error) return { ok: false };
  return {
    ok: true,
    appointments: (data ?? []).map((a) => ({
      appointment_id: a.id,
      status: a.status,
      start_at: a.start_at,
      end_at: a.end_at,
      doctor_id: a.doctor_id,
      office_id: a.office_id,
    })),
  };
}

/** HTTP status a thin adapter should use for each error code. */
export function httpStatusFor(code: ActionErrorCode): number {
  switch (code) {
    case "not_found":
      return 404;
    case "db_error":
      return 500;
    default:
      return 409;
  }
}
