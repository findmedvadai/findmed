// Prepared, idempotent patient actions (confirm / cancel) — block B4 part 2.
//
// prepare → the patient sees exactly what will happen (which appointment,
//           when, where) and gets an operation_id; nothing changes yet.
// commit  → executes ONCE with recorded confirmation evidence. A replay of a
//           finished operation returns the stored result (X06); an operation
//           can't be committed for a different phone, after it expires, or
//           twice concurrently (atomic claim).
//
// Ownership (X07): the appointment must belong to the phone that prepares and
// commits; otherwise it's "not_found" (we never reveal other patients' data).
// Execution is delegated to applyPatientAction (appointment-actions.ts).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyPatientAction, findUpcomingAppointmentsByPhone, type PatientAction } from "./appointment-actions.ts";
import { isValidNormalizedPhone, mxPhoneLookupVariants, normalizeMxPhone } from "./phone.ts";
import { getOrCreateManageUrl } from "./manage-token.ts";
import { msToMxIso } from "./mx-time.ts";

export const PREPARE_TTL_MS = 15 * 60 * 1000;

export type OperationChannel = "mcp" | "whatsapp_button" | "web" | "api";

export interface ConfirmationEvidence {
  /** How the patient confirmed. "whatsapp_button" is verified server-side by whaapy-inbound. */
  type: "whatsapp_button" | "chat_confirmation" | "web";
  /** Provider reference (e.g. WHAAPY message id), when available. */
  ref?: string | null;
}

type Fail = { ok: false; code: string; message_es: string };
const fail = (code: string, message_es: string): Fail => ({ ok: false, code, message_es });

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function phoneOf(raw: string): { canonical: string; variants: string[] } | null {
  const canonical = normalizeMxPhone(raw);
  if (!isValidNormalizedPhone(canonical)) return null;
  return { canonical, variants: mxPhoneLookupVariants(canonical) };
}

export interface PreparedOperation {
  ok: true;
  operation_id: string;
  status: "pending_confirmation";
  action: PatientAction;
  expires_at: string;
  summary: { appointment_id: string; date: string; start_time: string; doctor_name: string | null; office_name: string | null; office_address: string | null };
  /** Secure fallback: the patient can do the same from /gestionar. */
  manage_url: string | null;
}

export async function prepareAction(
  supabase: SupabaseClient,
  input: { phone: string; appointmentId: string; action: PatientAction; channel: OperationChannel },
): Promise<PreparedOperation | Fail> {
  const who = phoneOf(input.phone);
  if (!who) return fail("invalid_phone", "No pude identificar el número de este contacto.");

  const upcoming = await findUpcomingAppointmentsByPhone(supabase, who.variants);
  if (!upcoming.ok) return fail("temporarily_unavailable", "No pude consultar la cita en este momento.");
  const appt = upcoming.appointments.find((a) => a.appointment_id === input.appointmentId);
  if (!appt) return fail("not_found", "No encontré esa cita entre tus citas próximas.");
  if (input.action === "confirm" && appt.status === "confirmed") return fail("already_confirmed", "Tu cita ya estaba confirmada.");

  // Reuse a live intent for the same thing; expire a stale one.
  const now = new Date().toISOString();
  const { data: pending } = await supabase
    .from("operation_requests")
    .select("id, expires_at")
    .eq("subject_phone", who.canonical)
    .eq("appointment_id", appt.appointment_id)
    .eq("action", input.action)
    .eq("status", "pending_confirmation")
    .maybeSingle();
  let operationId: string | null = null;
  let expiresAt = new Date(Date.now() + PREPARE_TTL_MS).toISOString();
  if (pending && pending.expires_at > now) {
    operationId = pending.id;
    expiresAt = pending.expires_at;
  } else {
    if (pending) await supabase.from("operation_requests").update({ status: "expired" }).eq("id", pending.id);
    const { data: created, error } = await supabase
      .from("operation_requests")
      .insert({
        channel: input.channel,
        status: "pending_confirmation",
        subject_phone: who.canonical,
        action: input.action,
        appointment_id: appt.appointment_id,
        payload_hash: await sha256Hex(`${input.channel}|${who.canonical}|${input.action}|${appt.appointment_id}`),
        expires_at: expiresAt,
      })
      .select("id")
      .single();
    if ((error as { code?: string } | null)?.code === "23505") {
      // A simultaneous prepare (double button press) won the one-pending
      // index: reuse its operation instead of failing the second press.
      const { data: raced } = await supabase
        .from("operation_requests")
        .select("id, expires_at")
        .eq("subject_phone", who.canonical)
        .eq("appointment_id", appt.appointment_id)
        .eq("action", input.action)
        .eq("status", "pending_confirmation")
        .maybeSingle();
      if (raced) {
        operationId = raced.id;
        expiresAt = raced.expires_at;
      }
    }
    if (!operationId && (error || !created)) {
      console.error("[operations] prepare insert failed:", error);
      return fail("temporarily_unavailable", "No pude preparar la acción en este momento.");
    }
    operationId ??= created!.id;
  }

  const [{ data: doctor }, { data: office }] = await Promise.all([
    supabase.from("doctors").select("full_name").eq("id", appt.doctor_id).maybeSingle(),
    appt.office_id
      ? supabase.from("doctor_offices").select("name, address").eq("id", appt.office_id).maybeSingle()
      : Promise.resolve({ data: null as { name: string; address: string | null } | null }),
  ]);
  const local = msToMxIso(Date.parse(appt.start_at));
  let manageUrl: string | null = null;
  try {
    manageUrl = await getOrCreateManageUrl({ supabase, appointmentId: appt.appointment_id, endAt: appt.end_at, patientPhone: who.canonical });
  } catch (err) {
    console.error("[operations] manage url failed:", err);
  }

  return {
    ok: true,
    operation_id: operationId!,
    status: "pending_confirmation",
    action: input.action,
    expires_at: expiresAt,
    summary: {
      appointment_id: appt.appointment_id,
      date: local.slice(0, 10),
      start_time: local.slice(11, 16),
      doctor_name: doctor?.full_name ?? null,
      office_name: office?.name ?? null,
      office_address: office?.address ?? null,
    },
    manage_url: manageUrl,
  };
}

export interface OperationOutcome {
  ok: boolean;
  operation_id: string;
  status: "succeeded" | "failed" | "expired" | "executing";
  replayed: boolean;
  result: Record<string, unknown> | null;
}

export async function commitAction(
  supabase: SupabaseClient,
  input: { phone: string; operationId: string; evidence: ConfirmationEvidence },
): Promise<OperationOutcome | Fail> {
  const who = phoneOf(input.phone);
  if (!who) return fail("invalid_phone", "No pude identificar el número de este contacto.");

  const read = async () =>
    (await supabase
      .from("operation_requests")
      .select("id, status, action, appointment_id, channel, result, expires_at")
      .eq("id", input.operationId)
      .in("subject_phone", who.variants)
      .maybeSingle()).data;

  const op = await read();
  if (!op) return fail("not_found", "No encontré esa solicitud.");

  const stored = (o: typeof op, replayed: boolean): OperationOutcome => ({
    ok: o.status === "succeeded",
    operation_id: o.id,
    status: o.status as OperationOutcome["status"],
    replayed,
    result: (o.result as Record<string, unknown>) ?? null,
  });
  if (op.status === "succeeded" || op.status === "failed" || op.status === "expired" || op.status === "executing") {
    return stored(op, true);
  }

  const now = new Date().toISOString();
  if (op.expires_at <= now) {
    await supabase.from("operation_requests").update({ status: "expired" }).eq("id", op.id).eq("status", "pending_confirmation");
    return { ok: false, operation_id: op.id, status: "expired", replayed: false, result: null };
  }

  // Atomic claim: only one caller moves it from pending to executing.
  const { data: claimed } = await supabase
    .from("operation_requests")
    .update({ status: "executing", confirmation_evidence: input.evidence })
    .eq("id", op.id)
    .eq("status", "pending_confirmation")
    .gt("expires_at", now)
    .select("id")
    .maybeSingle();
  if (!claimed) {
    const again = await read();
    return again ? stored(again, true) : fail("not_found", "No encontré esa solicitud.");
  }

  let r: Awaited<ReturnType<typeof applyPatientAction>>;
  try {
    r = await applyPatientAction(supabase, {
      appointmentId: op.appointment_id,
      action: op.action as PatientAction,
      channel: op.channel === "whatsapp_button" ? "whatsapp" : op.channel === "mcp" ? "mcp" : op.channel === "web" ? "web" : "api",
    });
  } catch (err) {
    // Never leave the operation stuck in "executing".
    console.error("[operations] commit threw:", err);
    const result = { code: "internal_error", message_es: "Ocurrió un error al ejecutar la acción." };
    await supabase.from("operation_requests").update({ status: "failed", result }).eq("id", op.id);
    return { ok: false, operation_id: op.id, status: "failed", replayed: false, result };
  }
  const result: Record<string, unknown> = r.ok
    ? { appointment_id: r.appointment_id, previous_status: r.previous_status, new_status: r.new_status, calendar: r.calendar ?? null }
    : { code: r.code, message_es: r.message_es };
  const finalStatus = r.ok ? "succeeded" : "failed";
  await supabase.from("operation_requests").update({ status: finalStatus, result }).eq("id", op.id);
  return { ok: r.ok, operation_id: op.id, status: finalStatus, replayed: false, result };
}

export async function getOperation(
  supabase: SupabaseClient,
  input: { phone: string; operationId: string },
): Promise<{ ok: true; operation_id: string; status: string; action: string; result: Record<string, unknown> | null; expires_at: string } | Fail> {
  const who = phoneOf(input.phone);
  if (!who) return fail("invalid_phone", "No pude identificar el número de este contacto.");
  const { data: op } = await supabase
    .from("operation_requests")
    .select("id, status, action, result, expires_at")
    .eq("id", input.operationId)
    .in("subject_phone", who.variants)
    .maybeSingle();
  if (!op) return fail("not_found", "No encontré esa solicitud.");
  const status = op.status === "pending_confirmation" && op.expires_at <= new Date().toISOString() ? "expired" : op.status;
  return { ok: true, operation_id: op.id, status, action: op.action, result: (op.result as Record<string, unknown>) ?? null, expires_at: op.expires_at };
}
