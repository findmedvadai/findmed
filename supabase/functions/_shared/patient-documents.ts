// "Documentos recibidos" (FindMed decision b, 14-oct-2026).
//
// After a booking FindMed sends the pedir_documentos template (policy + INE).
// When the patient then sends an image or a PDF by WhatsApp, the upcoming
// appointment (scheduled/confirmed, today or later) that already had its
// documents requested is marked documents_received_at and admins get a
// notification. Nothing is copied or stored: no file, no media URL. The team
// opens the conversation in the WHAAPY inbox (/admin/whatsapp).
//
// Idempotent: the mark is a conditional UPDATE (documents_received_at IS NULL)
// and the notification is created only by the call that set it, so a second
// photo (the INE after the policy) or a webhook retry does nothing.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { formatMxDateTime } from "./messaging.ts";
import { mxDayBoundsMs, mxToday } from "./mx-time.ts";
import { isValidNormalizedPhone, mxPhoneLookupVariants, normalizeMxPhone } from "./phone.ts";
import { attendedName } from "./patient-identity.ts";

/** Template that asks for the documents (message_route_steps). */
export const DOCUMENTS_TEMPLATE = "pedir_documentos";
const ACCEPTED_DELIVERY = ["accepted", "sent", "delivered", "read"];
const DOCUMENT_TYPES = new Set(["image", "document"]);

export interface InboundMedia {
  phone: string;
  type: "image" | "document";
  wamid: string | null;
}

/** Image or document in a message.received payload (Meta format), or null. */
export function parseInboundMedia(data: Record<string, unknown> | undefined): InboundMedia | null {
  const message = data?.message as { from?: unknown; id?: unknown; type?: unknown } | undefined;
  const type = typeof message?.type === "string" ? message.type : null;
  if (!type || !DOCUMENT_TYPES.has(type) || typeof message?.from !== "string" || !message.from) return null;
  return { phone: message.from, type: type as InboundMedia["type"], wamid: typeof message.id === "string" ? message.id : null };
}

/**
 * A patient reschedule (manage-reschedule) creates a NEW appointment and
 * pedir_documentos is not sent again (skip_on_reschedule), so the new row
 * inherits the documents state of the one it replaces: otherwise a patient who
 * already sent the policy would show "No solicitados" (or be asked again).
 * Best-effort: never blocks the reschedule (also safe before the migration).
 */
export async function carryOverDocuments(supabase: SupabaseClient, fromAppointmentId: string, toAppointmentId: string): Promise<void> {
  const { data, error } = await supabase
    .from("appointments")
    .select("documents_requested_at, documents_received_at")
    .eq("id", fromAppointmentId)
    .maybeSingle();
  if (error || !data) return;
  const prev = data as { documents_requested_at: string | null; documents_received_at: string | null };
  const patch: Record<string, string> = {};
  if (prev.documents_requested_at) patch.documents_requested_at = prev.documents_requested_at;
  if (prev.documents_received_at) patch.documents_received_at = prev.documents_received_at;
  if (Object.keys(patch).length === 0) return;
  const { error: upErr } = await supabase.from("appointments").update(patch).eq("id", toAppointmentId);
  if (upErr) console.error("[patient-documents] carry over failed", upErr.message);
}

interface UpcomingRow {
  id: string;
  doctor_id: string;
  patient_id: string;
  patient_name?: string | null;
  start_at: string;
  documents_requested_at: string | null;
  documents_received_at: string | null;
}

export type DocumentsOutcome =
  | "documents_received"
  | "media_invalid_phone"
  | "media_no_patient"
  | "media_no_upcoming_appointment"
  | "media_documents_already_received"
  | "media_documents_not_requested"
  | "media_lookup_failed";

export async function markDocumentsReceived(
  supabase: SupabaseClient,
  rawPhone: string,
  now = Date.now(),
): Promise<{ outcome: DocumentsOutcome; appointment_ids: string[] }> {
  const done = (outcome: DocumentsOutcome, appointment_ids: string[] = []) => ({ outcome, appointment_ids });
  const canonical = normalizeMxPhone(rawPhone);
  if (!isValidNormalizedPhone(canonical)) return done("media_invalid_phone");

  const { data: patients, error: pErr } = await supabase
    .from("patients")
    .select("id, full_name")
    .in("phone", mxPhoneLookupVariants(canonical));
  if (pErr) return done("media_lookup_failed");
  const people = (patients ?? []) as { id: string; full_name: string | null }[];
  if (people.length === 0) return done("media_no_patient");
  const nameOf = Object.fromEntries(people.map((p) => [p.id, p.full_name]));

  // Upcoming = scheduled/confirmed starting today (CDMX) or later.
  const { startMs } = mxDayBoundsMs(mxToday(now));
  const { data: appts, error: aErr } = await supabase
    .from("appointments")
    .select("id, doctor_id, patient_id, patient_name, start_at, documents_requested_at, documents_received_at")
    .in("patient_id", people.map((p) => p.id))
    .in("status", ["scheduled", "confirmed"])
    .gte("start_at", new Date(startMs).toISOString())
    .order("start_at", { ascending: true });
  if (aErr) return done("media_lookup_failed");
  const upcoming = (appts ?? []) as UpcomingRow[];
  if (upcoming.length === 0) return done("media_no_upcoming_appointment");
  const pending = upcoming.filter((a) => !a.documents_received_at);
  if (pending.length === 0) return done("media_documents_already_received");

  // Requested = marker set by the delivery trigger, or (fallback) an accepted
  // pedir_documentos delivery for that appointment.
  const requestedAt = new Map<string, string>();
  for (const a of pending) if (a.documents_requested_at) requestedAt.set(a.id, a.documents_requested_at);
  const unknown = pending.filter((a) => !requestedAt.has(a.id)).map((a) => a.id);
  if (unknown.length > 0) {
    const { data: deliveries } = await supabase
      .from("message_deliveries")
      .select("appointment_id, created_at")
      .in("appointment_id", unknown)
      .eq("template_name", DOCUMENTS_TEMPLATE)
      .in("status", ACCEPTED_DELIVERY);
    for (const d of (deliveries ?? []) as { appointment_id: string; created_at: string }[]) {
      if (!requestedAt.has(d.appointment_id)) requestedAt.set(d.appointment_id, d.created_at);
    }
  }
  const targets = pending.filter((a) => requestedAt.has(a.id));
  if (targets.length === 0) return done("media_documents_not_requested");

  const stamp = new Date(now).toISOString();
  const marked: string[] = [];
  for (const a of targets) {
    const patch: Record<string, string> = { documents_received_at: stamp };
    if (!a.documents_requested_at) patch.documents_requested_at = requestedAt.get(a.id)!;
    const { data: won, error: uErr } = await supabase
      .from("appointments")
      .update(patch)
      .eq("id", a.id)
      .is("documents_received_at", null)
      .select("id");
    if (uErr || !won || (won as unknown[]).length === 0) continue; // already marked by a concurrent event
    marked.push(a.id);
    const name = attendedName(a.patient_name, nameOf[a.patient_id]) ?? "Paciente";
    const { error: nErr } = await supabase.from("notifications").insert({
      recipient_role: "admin",
      doctor_id: a.doctor_id,
      appointment_id: a.id,
      type: "documents_received",
      title: `Documentos recibidos de ${name}`,
      body: `Envió su documentación por WhatsApp para su cita del ${formatMxDateTime(a.start_at)}. Revísala en el módulo WhatsApp.`,
    });
    if (nErr) console.error("[patient-documents] notification insert failed", nErr.message);
  }
  return marked.length > 0 ? done("documents_received", marked) : done("media_documents_already_received");
}
