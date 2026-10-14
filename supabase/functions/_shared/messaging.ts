// FindMed-owned WhatsApp messaging — block B7 (decision A5, R33–R38).
//
//   dispatch-webhook ──(route owner = 'findmed')──▶ enqueueEvent ─▶ domain_outbox
//   findmed-events-worker ─▶ claim_outbox ─▶ processOutboxRow ─▶ WHAAPY template(s)
//                                              └─▶ message_deliveries (one per step)
//   whaapy-inbound ─▶ applyReceipt (sent/delivered/read/failed)
//
// Guarantees:
//  * Single owner per event type (message_routes): when FindMed owns it,
//    dispatch-webhook stops sending it to n8n.
//  * At-least-once with duplicate mitigation: a step already accepted by
//    WHAAPY is never re-sent; a lost response (timeout, unexpected 5xx) is
//    'uncertain' and waits for a person (WHAAPY has no idempotency key, N23).
//  * Stale events are skipped: everything is re-read from the database at send
//    time (phone, names, status) and an event that no longer matches the
//    appointment (e.g. a 48 h reminder for a cancelled appointment, an old
//    reschedule) is not sent (R33).
//  * Steps flagged skip_on_reschedule (pedir_documentos) go only with the
//    original booking, never with a reschedule (isRescheduleEvent).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getOrCreateManageUrl } from "./manage-token.ts";
import { msToMxIso } from "./mx-time.ts";
import type { WhaapyClient } from "./whaapy-client.ts";

export type RouteOwner = "n8n" | "findmed" | "none";

export const MAX_ATTEMPTS = 5;
const BACKOFF_MINUTES = [1, 5, 15, 60];

/** Owner of an event type. Any lookup problem keeps today's behavior (n8n). */
export async function routeOwner(supabase: SupabaseClient, eventType: string): Promise<RouteOwner> {
  const { data, error } = await supabase.from("message_routes").select("owner").eq("event_type", eventType).maybeSingle();
  if (error || !data) return "n8n";
  const owner = (data as { owner: string }).owner;
  return owner === "findmed" || owner === "none" ? owner : "n8n";
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Same event emitted twice (retries, double clicks) → same key → one outbox row. */
export function dedupeMaterial(eventType: string, p: Record<string, unknown>): string {
  return [
    eventType,
    p.appointment_id ?? "",
    p.new_status ?? "",
    p.start_at ?? "",
    p.previous_start_at ?? "",
  ].map(String).join("|");
}

export async function enqueueEvent(
  supabase: SupabaseClient,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; duplicate: boolean }> {
  const appointmentId = typeof payload.appointment_id === "string" ? payload.appointment_id : null;
  const { data, error } = await supabase
    .from("domain_outbox")
    .upsert(
      {
        event_type: eventType,
        aggregate_id: appointmentId,
        payload,
        dedupe_key: await sha256Hex(dedupeMaterial(eventType, payload)),
        status: "pending",
        attempts: 0,
        next_attempt_at: new Date().toISOString(),
      },
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    )
    .select("id");
  if (error) {
    console.error("[messaging] enqueue failed", eventType, error.message);
    return { ok: false, duplicate: false };
  }
  return { ok: true, duplicate: !data || (data as unknown[]).length === 0 };
}

// ---------------------------------------------------------------------------
// Formatting (same text the n8n flows produced: "12 de Octubre, 3:00 pm")

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export function formatMxDateTime(isoUtc: string): string {
  const local = msToMxIso(Date.parse(isoUtc)); // YYYY-MM-DDTHH:mm:ss-06:00
  const month = Number(local.slice(5, 7));
  const day = Number(local.slice(8, 10));
  let hour = Number(local.slice(11, 13));
  const min = local.slice(14, 16);
  const ampm = hour >= 12 ? "pm" : "am";
  hour = hour % 12 || 12;
  return `${day} de ${MESES[month - 1]}, ${hour}:${min} ${ampm}`;
}

// ---------------------------------------------------------------------------
// Context and validity

export interface AppointmentContext {
  id: string;
  status: string;
  cancel_reason: string | null;
  start_at: string;
  end_at: string;
  patient_name: string | null;
  patient_phone: string | null;
  doctor_name: string | null;
  office_address: string | null;
  min_confirm_hours: number;
}

export async function loadAppointmentContext(supabase: SupabaseClient, appointmentId: string): Promise<AppointmentContext | null> {
  const { data: appt } = await supabase
    .from("appointments")
    .select("id, status, cancel_reason, start_at, end_at, doctor_id, office_id, patient_id")
    .eq("id", appointmentId)
    .maybeSingle();
  if (!appt) return null;
  const a = appt as Record<string, string | null>;
  const [{ data: patient }, { data: doctor }, { data: office }, { data: settings }] = await Promise.all([
    supabase.from("patients").select("full_name, phone").eq("id", a.patient_id).maybeSingle(),
    supabase.from("doctors").select("full_name").eq("id", a.doctor_id).maybeSingle(),
    a.office_id
      ? supabase.from("doctor_offices").select("name, address").eq("id", a.office_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("doctor_schedule_settings").select("min_confirm_hours_before").eq("doctor_id", a.doctor_id).maybeSingle(),
  ]);
  const p = patient as { full_name?: string; phone?: string } | null;
  const o = office as { name?: string | null; address?: string | null } | null;
  return {
    id: a.id!,
    status: a.status!,
    cancel_reason: a.cancel_reason ?? null,
    start_at: a.start_at!,
    end_at: a.end_at!,
    patient_name: p?.full_name ?? null,
    patient_phone: p?.phone ?? null,
    doctor_name: (doctor as { full_name?: string } | null)?.full_name ?? null,
    // 9 bookable offices had no address (14-oct): without a fallback every
    // reminder of those offices failed with missing_value_office_address.
    office_address: templateText(o?.address) ?? templateText(o?.name),
    min_confirm_hours: (settings as { min_confirm_hours_before?: number } | null)?.min_confirm_hours_before ?? 24,
  };
}

/** Why an event should NOT be sent any more (null = still valid). */
export function staleReason(eventType: string, payload: Record<string, unknown>, ctx: AppointmentContext, now = Date.now()): string | null {
  const future = Date.parse(ctx.start_at) > now;
  const active = ctx.status === "scheduled" || ctx.status === "confirmed";
  switch (eventType) {
    case "appointment.status_changed":
      if (ctx.status !== payload.new_status) return `status_now_${ctx.status}`;
      if ((ctx.status === "scheduled" || ctx.status === "confirmed") && !future) return "appointment_in_past";
      return null;
    case "appointment.reminder_48h":
      if (ctx.status !== "scheduled") return `status_now_${ctx.status}`;
      return future ? null : "appointment_in_past";
    case "appointment.reminder_day_of":
      if (!active) return `status_now_${ctx.status}`;
      return future ? null : "appointment_in_past";
    case "appointment.cancelled_by_doctor":
    case "appointment.auto_cancelled":
      return ctx.status === "cancelled" ? null : `status_now_${ctx.status}`;
    case "appointment.rescheduled_by_staff":
      if (!active) return `status_now_${ctx.status}`;
      if (typeof payload.start_at === "string" && Date.parse(payload.start_at) !== Date.parse(ctx.start_at)) {
        return "superseded_by_newer_schedule";
      }
      return future ? null : "appointment_in_past";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Template requests

export interface RouteStep {
  position: number;
  template_name: string;
  language: string;
  body_params: string[];
  url_button_param: string | null;
  quick_reply_action: "confirm" | "cancel" | null;
  when_status: string | null;
  when_cancel_reason: string | null;
  /** Only on the original booking: not sent when the event comes from a reschedule. */
  skip_on_reschedule?: boolean | null;
}

/**
 * Whether an event comes from a reschedule (patient, doctor or FindMed).
 * A patient reschedule creates a NEW appointment and emits
 * appointment.status_changed for it, indistinguishable from a first booking
 * except for `rescheduled_from` (old appointment id) set by manage-reschedule.
 */
export function isRescheduleEvent(eventType: string, payload: Record<string, unknown>): boolean {
  if (eventType === "appointment.rescheduled" || eventType === "appointment.rescheduled_by_staff") return true;
  return typeof payload.rescheduled_from === "string" && payload.rescheduled_from.length > 0;
}

/** Steps of an event that apply to this appointment state and origin. */
export function applicableSteps(
  steps: RouteStep[],
  ctx: Pick<AppointmentContext, "status" | "cancel_reason">,
  reschedule: boolean,
): RouteStep[] {
  return steps.filter((s) =>
    (!s.when_status || s.when_status === ctx.status) &&
    (!s.when_cancel_reason || s.when_cancel_reason === ctx.cancel_reason) &&
    !(reschedule && s.skip_on_reschedule === true)
  );
}

export const BUTTON_PAYLOAD_PREFIX = { confirm: "confirmar_cita", cancel: "cancelar_cita" } as const;

/**
 * A template variable as WhatsApp accepts it: Meta rejects parameters with
 * newlines, tabs or more than four consecutive spaces (error 132018), and
 * empty ones. Addresses typed in a textarea and names with double spaces
 * would make the whole send fail. Returns null when nothing is left.
 */
export function templateText(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const clean = String(v).replace(/\s+/g, " ").trim();
  return clean ? clean : null;
}

export function buildTemplateRequest(
  step: RouteStep,
  ctx: AppointmentContext,
  extra: { manageToken: string | null; previousStartAt: string | null },
): { body: Record<string, unknown> } | { error: string } {
  if (!ctx.patient_phone) return { error: "missing_patient_phone" };
  const values: Record<string, string | null> = {
    patient_name: ctx.patient_name,
    start_local: formatMxDateTime(ctx.start_at),
    previous_start_local: extra.previousStartAt ? formatMxDateTime(extra.previousStartAt) : null,
    doctor_name: ctx.doctor_name,
    office_address: ctx.office_address,
    min_confirm_hours: String(ctx.min_confirm_hours),
  };
  const params: string[] = [];
  for (const key of step.body_params) {
    const v = values[key];
    if (v === undefined) return { error: `unknown_param_${key}` };
    const text = templateText(v);
    if (!text) return { error: `missing_value_${key}` };
    params.push(text);
  }

  const components: Record<string, unknown>[] = [];
  if (params.length) components.push({ type: "body", parameters: params.map((text) => ({ type: "text", text })) });
  if (step.url_button_param === "manage_token") {
    if (!extra.manageToken) return { error: "missing_manage_token" };
    components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: extra.manageToken }] });
  }
  if (step.quick_reply_action) {
    components.push({
      type: "button",
      sub_type: "quick_reply",
      index: "0",
      parameters: [{ type: "payload", payload: `${BUTTON_PAYLOAD_PREFIX[step.quick_reply_action]}:${ctx.id}` }],
    });
  }

  return {
    body: {
      to: ctx.patient_phone,
      type: "template",
      template: { name: step.template_name, language: { policy: "deterministic", code: step.language }, components },
      ...(step.quick_reply_action ? { allowButtonIdOverride: true } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Outbox processing

export interface OutboxRow {
  id: string;
  event_type: string;
  aggregate_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
}

export type OutboxOutcome = "sent" | "skipped" | "retry" | "failed" | "uncertain";

const DONE = new Set(["accepted", "sent", "delivered", "read"]);

/** WHAAPY answered 429/503: nothing was processed, safe to retry. */
const retryable = (status: number) => status === 429 || status === 503;

async function finish(
  supabase: SupabaseClient,
  row: OutboxRow,
  outcome: OutboxOutcome,
  error: string | null,
): Promise<OutboxOutcome> {
  const now = new Date();
  if (outcome === "retry") {
    if (row.attempts >= MAX_ATTEMPTS) outcome = "failed";
    else {
      const minutes = BACKOFF_MINUTES[Math.min(row.attempts - 1, BACKOFF_MINUTES.length - 1)] ?? 60;
      await supabase.from("domain_outbox").update({
        status: "pending",
        locked_until: null,
        last_error: error,
        next_attempt_at: new Date(now.getTime() + minutes * 60_000).toISOString(),
      }).eq("id", row.id);
      return "retry";
    }
  }
  await supabase.from("domain_outbox").update({
    status: outcome,
    locked_until: null,
    last_error: error,
    processed_at: now.toISOString(),
  }).eq("id", row.id);
  return outcome;
}

export async function processOutboxRow(
  supabase: SupabaseClient,
  whaapy: WhaapyClient,
  row: OutboxRow,
  now = Date.now(),
): Promise<OutboxOutcome> {
  // Ownership is re-checked at send time: if the event went back to n8n
  // (rollback), queued rows are not sent by FindMed as well.
  if ((await routeOwner(supabase, row.event_type)) !== "findmed") return finish(supabase, row, "skipped", "route_not_owned_by_findmed");
  if (!row.aggregate_id) return finish(supabase, row, "skipped", "no_appointment");
  // Staff created the appointment with "Avisar al paciente por WhatsApp" off
  // (admin/doctor-create-appointment send notify_patient=false): the dialog
  // promises no message, so the confirmation is not sent.
  if (row.payload?.notify_patient === false) return finish(supabase, row, "skipped", "patient_notification_disabled");

  const ctx = await loadAppointmentContext(supabase, row.aggregate_id);
  if (!ctx) return finish(supabase, row, "skipped", "appointment_not_found");
  const stale = staleReason(row.event_type, row.payload, ctx, now);
  if (stale) return finish(supabase, row, "skipped", stale);

  const { data: stepRows, error: stepsErr } = await supabase
    .from("message_route_steps")
    .select("*")
    .eq("event_type", row.event_type)
    .eq("enabled", true)
    .order("position", { ascending: true });
  if (stepsErr) return finish(supabase, row, "retry", "steps_unavailable");
  const reschedule = isRescheduleEvent(row.event_type, row.payload);
  const matching = applicableSteps((stepRows ?? []) as RouteStep[], ctx, false);
  const steps = applicableSteps(matching, ctx, reschedule);
  if (steps.length === 0) {
    // e.g. only "pedir_documentos" matched and this is a reschedule.
    return finish(supabase, row, "skipped", matching.length > 0 ? "only_first_booking_steps" : "no_template_for_event");
  }
  if (!whaapy.configured) return finish(supabase, row, "retry", "whaapy_not_configured");

  let manageToken: string | null = null;
  if (steps.some((s) => s.url_button_param === "manage_token")) {
    try {
      const url = await getOrCreateManageUrl({
        supabase,
        appointmentId: ctx.id,
        endAt: ctx.end_at,
        patientPhone: ctx.patient_phone ?? "",
      });
      manageToken = new URL(url).searchParams.get("token");
    } catch (e) {
      console.error("[messaging] manage token failed", e);
      return finish(supabase, row, "retry", "manage_token_unavailable");
    }
  }
  const previousStartAt = typeof row.payload.previous_start_at === "string" ? row.payload.previous_start_at : null;

  for (const step of steps) {
    const { data: existing } = await supabase
      .from("message_deliveries")
      .select("id, status, error_code, attempts")
      .eq("outbox_id", row.id)
      .eq("step_position", step.position)
      .maybeSingle();
    const prev = existing as { id: string; status: string; error_code: string | null; attempts: number } | null;
    if (prev && DONE.has(prev.status)) continue; // already accepted: never twice
    if (prev && (prev.status === "uncertain" || prev.status === "sending")) {
      // "sending" here means a previous run died mid-call: we can't know.
      if (prev.status === "sending") await supabase.from("message_deliveries").update({ status: "uncertain" }).eq("id", prev.id);
      return finish(supabase, row, "uncertain", `step_${step.position}_uncertain`);
    }
    if (prev && prev.status === "failed" && !prev.error_code?.startsWith("retry:")) {
      return finish(supabase, row, "failed", `step_${step.position}_failed`);
    }

    const built = buildTemplateRequest(step, ctx, { manageToken, previousStartAt });
    if ("error" in built) return finish(supabase, row, "failed", `step_${step.position}_${built.error}`);

    let deliveryId = prev?.id ?? null;
    const sending = { status: "sending", request: built.body, attempts: (prev?.attempts ?? 0) + 1, error_code: null, error_message: null };
    if (deliveryId) {
      await supabase.from("message_deliveries").update(sending).eq("id", deliveryId);
    } else {
      const { data: ins, error: insErr } = await supabase
        .from("message_deliveries")
        .insert({
          outbox_id: row.id,
          step_position: step.position,
          appointment_id: ctx.id,
          to_phone: ctx.patient_phone,
          template_name: step.template_name,
          language: step.language,
          source: "worker",
          ...sending,
        })
        .select("id")
        .single();
      if (insErr || !ins) return finish(supabase, row, "retry", "delivery_insert_failed");
      deliveryId = (ins as { id: string }).id;
    }

    const r = await whaapy.sendMessage(built.body);
    if (r.ok) {
      await supabase.from("message_deliveries").update({
        status: "accepted",
        whaapy_message_id: r.data.message_id,
        wamid: r.data.wamid,
      }).eq("id", deliveryId);
      continue;
    }
    if (r.status === 0 || (r.status >= 500 && !retryable(r.status))) {
      // Timeout / connection drop / unexpected 5xx: it may have been sent.
      await supabase.from("message_deliveries").update({ status: "uncertain", error_code: String(r.status), error_message: r.error }).eq("id", deliveryId);
      return finish(supabase, row, "uncertain", `step_${step.position}_${r.error}`);
    }
    if (retryable(r.status)) {
      await supabase.from("message_deliveries").update({ status: "failed", error_code: `retry:${r.status}`, error_message: r.error }).eq("id", deliveryId);
      return finish(supabase, row, "retry", `step_${step.position}_http_${r.status}`);
    }
    // 4xx: wrong template/parameters/number — retrying won't help.
    await supabase.from("message_deliveries").update({ status: "failed", error_code: String(r.status), error_message: r.error }).eq("id", deliveryId);
    return finish(supabase, row, "failed", `step_${step.position}_http_${r.status}`);
  }
  return finish(supabase, row, "sent", null);
}

// ---------------------------------------------------------------------------
// Delivery receipts (from whaapy-inbound)

const RANK: Record<string, number> = { sending: 0, uncertain: 0, accepted: 1, sent: 2, delivered: 3, read: 4 };
const RECEIPT_STATUS: Record<string, string> = {
  "message.sent": "sent",
  "message.delivered": "delivered",
  "message.read": "read",
  "message.failed": "failed",
};

/** Moves a delivery forward (never backwards: a late "sent" can't undo "read"). */
export async function applyReceipt(
  supabase: SupabaseClient,
  eventType: string,
  data: { message_id?: string; error?: { code?: string; message?: string; title?: string } },
): Promise<"updated" | "ignored" | "unknown_message"> {
  const next = RECEIPT_STATUS[eventType];
  if (!next || !data.message_id) return "ignored";
  const { data: row } = await supabase
    .from("message_deliveries")
    .select("id, status")
    .eq("whaapy_message_id", data.message_id)
    .maybeSingle();
  const d = row as { id: string; status: string } | null;
  if (!d) return "unknown_message";
  if (next === "failed") {
    if ((RANK[d.status] ?? 0) >= RANK.delivered) return "ignored";
    await supabase.from("message_deliveries").update({
      status: "failed",
      error_code: data.error?.code ?? null,
      error_message: data.error?.message ?? data.error?.title ?? null,
    }).eq("id", d.id);
    return "updated";
  }
  if (d.status === "failed" || (RANK[d.status] ?? 0) >= RANK[next]) return "ignored";
  await supabase.from("message_deliveries").update({ status: next }).eq("id", d.id);
  return "updated";
}
