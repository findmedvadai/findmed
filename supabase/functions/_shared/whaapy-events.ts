// Processing of stored WHAAPY webhook events (public.whaapy_events) — block B7.
//
//  * message.sent/delivered/read/failed → delivery receipts (messaging.ts).
//  * message.received with a FindMed quick-reply payload
//      "confirmar_cita:<appointment_id>" | "cancelar_cita:<appointment_id>"
//    → prepare + commit the action for THAT appointment, with the button as
//    confirmation evidence (A4/A6, fixes F14: n8n acted on "the first
//    appointment of this phone"). The payload only identifies the appointment;
//    ownership is still checked against the phone that pressed the button.
//    Plain "confirmar_cita"/"cancelar_cita" (buttons sent by n8n) are left
//    to n8n, so the two systems never act on the same button.
//  * Everything else is just marked processed (kept for the messaging center).
//
// On a successful action the patient's confirmation arrives through the normal
// appointment.status_changed message; on failure we answer with a short text
// (the patient just wrote, so the 24 h window is open).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyReceipt, BUTTON_PAYLOAD_PREFIX } from "./messaging.ts";
import { commitAction, prepareAction } from "./operations.ts";
import type { WhaapyClient } from "./whaapy-client.ts";

const BUTTON_RE = new RegExp(
  `^(${BUTTON_PAYLOAD_PREFIX.confirm}|${BUTTON_PAYLOAD_PREFIX.cancel}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$`,
  "i",
);

const FAILURE_REPLY: Record<string, string> = {
  already_confirmed: "Tu cita ya estaba confirmada 👍",
  already_cancelled: "Esa cita ya estaba cancelada.",
  in_past: "Esa cita ya pasó, así que ya no es posible modificarla.",
  not_found: "No encontré esa cita asociada a este número.",
  invalid_state: "Esa cita ya no se puede modificar desde aquí.",
};
const GENERIC_REPLY = "No pude procesar tu respuesta en este momento. Puedes gestionar tu cita desde el enlace que te enviamos.";

interface StoredEvent {
  id: string;
  event_type: string;
  payload: { data?: Record<string, unknown> };
}

export interface ButtonPress {
  action: "confirm" | "cancel";
  appointmentId: string;
  phone: string;
  wamid: string | null;
}

/** Extracts a FindMed button press from a message.received payload (Meta format). */
export function parseButtonPress(data: Record<string, unknown> | undefined): ButtonPress | null {
  const message = data?.message as {
    from?: string;
    id?: string;
    button?: { payload?: string };
    interactive?: { button_reply?: { id?: string } };
  } | undefined;
  const raw = message?.button?.payload ?? message?.interactive?.button_reply?.id;
  if (!raw || !message?.from) return null;
  const m = BUTTON_RE.exec(raw.trim());
  if (!m) return null;
  return {
    action: m[1].toLowerCase() === BUTTON_PAYLOAD_PREFIX.confirm ? "confirm" : "cancel",
    appointmentId: m[2].toLowerCase(),
    phone: message.from,
    wamid: message.id ?? null,
  };
}

export type ProcessResult = { outcome: string; error?: string };

export async function handleButtonPress(
  supabase: SupabaseClient,
  whaapy: WhaapyClient,
  press: ButtonPress,
): Promise<ProcessResult> {
  const prepared = await prepareAction(supabase, {
    phone: press.phone,
    appointmentId: press.appointmentId,
    action: press.action,
    channel: "whatsapp_button",
  });
  let code: string | null = null;
  if (!prepared.ok) {
    code = prepared.code;
  } else {
    const r = await commitAction(supabase, {
      phone: press.phone,
      operationId: prepared.operation_id,
      evidence: { type: "whatsapp_button", ref: press.wamid },
    });
    if (!("operation_id" in r)) code = r.code;
    else if (r.status !== "succeeded") code = String((r.result as { code?: string } | null)?.code ?? r.status);
  }
  if (!code) return { outcome: `button_${press.action}_succeeded` };

  const reply = FAILURE_REPLY[code] ?? GENERIC_REPLY;
  const sent = await whaapy.sendMessage({ to: press.phone, content: reply });
  return { outcome: `button_${press.action}_${code}`, error: sent.ok ? undefined : `reply_failed_${sent.status}` };
}

export async function processWhaapyEvent(
  supabase: SupabaseClient,
  whaapy: WhaapyClient,
  ev: StoredEvent,
): Promise<ProcessResult> {
  const data = ev.payload?.data ?? {};
  if (ev.event_type.startsWith("message.") && ev.event_type !== "message.received") {
    return { outcome: `receipt_${await applyReceipt(supabase, ev.event_type, data as never)}` };
  }
  if (ev.event_type === "message.received") {
    const press = parseButtonPress(data);
    if (press) return handleButtonPress(supabase, whaapy, press);
  }
  return { outcome: "stored" };
}

/** Runs processWhaapyEvent and records the result on the row (never throws). */
export async function processAndMark(supabase: SupabaseClient, whaapy: WhaapyClient, ev: StoredEvent): Promise<ProcessResult> {
  let result: ProcessResult;
  try {
    result = await processWhaapyEvent(supabase, whaapy, ev);
  } catch (e) {
    result = { outcome: "error", error: e instanceof Error ? e.message : String(e) };
  }
  await supabase
    .from("whaapy_events")
    .update({ processed_at: new Date().toISOString(), processing_error: result.error ?? null })
    .eq("id", ev.id);
  return result;
}
