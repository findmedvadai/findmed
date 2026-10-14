// Etapa 2 — registro estructurado de facturas / reembolsos dentro de un caso.
//
// A reimbursement belongs to a patient case (usually request_type
// "reimbursement") and moves forward only:
//
//   recibido → en_proceso → finalizado | rechazado
//
// finalizado / rechazado are final: the record is locked (corrections go as a
// note in the case). Every write leaves a case_event so the case history shows
// who registered or changed what. Writes come only from case-actions
// (admin JWT, service role); admins read the table through RLS.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const REIMBURSEMENT_STATUSES = ["recibido", "en_proceso", "finalizado", "rechazado"] as const;
export type ReimbursementStatus = (typeof REIMBURSEMENT_STATUSES)[number];

const STAGE: Record<ReimbursementStatus, number> = { recibido: 0, en_proceso: 1, finalizado: 2, rechazado: 2 };
const FINAL: ReimbursementStatus[] = ["finalizado", "rechazado"];
export const STATUS_ES: Record<ReimbursementStatus, string> = {
  recibido: "Recibido",
  en_proceso: "En proceso",
  finalizado: "Finalizado",
  rechazado: "Rechazado",
};

type Fail = { ok: false; code: string; message_es: string };
const fail = (code: string, message_es: string): Fail => ({ ok: false, code, message_es });

export interface ReimbursementFields {
  insurer?: string;
  invoice_number?: string | null;
  amount?: number | null;
  currency?: string;
  status?: ReimbursementStatus;
  notes?: string | null;
}

export interface ReimbursementRow {
  id: string;
  case_id: string;
  patient_id: string | null;
  appointment_id: string | null;
  insurer: string;
  invoice_number: string | null;
  amount: number | null;
  currency: string;
  status: ReimbursementStatus;
  notes: string | null;
  submitted_at: string | null;
  resolved_at: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

const MAX_AMOUNT = 9_999_999_999.99; // numeric(12,2)

/**
 * Validates the editable fields of a request body. On create, insurer is
 * required; on update only the keys present are validated and returned.
 */
export function parseReimbursementFields(
  b: Record<string, unknown>,
  mode: "create" | "update",
): { ok: true; fields: ReimbursementFields } | Fail {
  const fields: ReimbursementFields = {};

  if (b.insurer !== undefined || mode === "create") {
    const insurer = typeof b.insurer === "string" ? b.insurer.trim().replace(/\s+/g, " ") : "";
    if (insurer.length < 2 || insurer.length > 120) return fail("invalid_insurer", "Escribe el nombre de la aseguradora (2 a 120 caracteres).");
    fields.insurer = insurer;
  }
  if (b.invoice_number !== undefined) {
    if (b.invoice_number !== null && typeof b.invoice_number !== "string") return fail("invalid_invoice_number", "Número de factura inválido.");
    const v = (b.invoice_number as string | null)?.trim() ?? "";
    if (v.length > 60) return fail("invalid_invoice_number", "El número de factura admite hasta 60 caracteres.");
    fields.invoice_number = v || null;
  }
  if (b.amount !== undefined) {
    if (b.amount === null || b.amount === "") {
      fields.amount = null;
    } else {
      const raw = typeof b.amount === "string" ? b.amount.trim().replace(/,/g, "") : b.amount;
      const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+(\.\d{1,2})?$/.test(raw) ? Number(raw) : NaN;
      if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) return fail("invalid_amount", "El monto debe ser un número positivo con hasta 2 decimales.");
      fields.amount = Math.round(n * 100) / 100;
    }
  }
  if (b.currency !== undefined) {
    const c = typeof b.currency === "string" ? b.currency.trim().toUpperCase() : "";
    if (!/^[A-Z]{3}$/.test(c)) return fail("invalid_currency", "Moneda inválida (usa un código de 3 letras, p. ej. MXN).");
    fields.currency = c;
  }
  if (b.status !== undefined) {
    if (typeof b.status !== "string" || !(REIMBURSEMENT_STATUSES as readonly string[]).includes(b.status)) {
      return fail("invalid_status", "Estado de reembolso inválido.");
    }
    fields.status = b.status as ReimbursementStatus;
  }
  if (b.notes !== undefined) {
    if (b.notes !== null && typeof b.notes !== "string") return fail("invalid_notes", "Notas inválidas.");
    const v = (b.notes as string | null)?.trim() ?? "";
    if (v.length > 2000) return fail("invalid_notes", "Las notas admiten hasta 2000 caracteres.");
    fields.notes = v || null;
  }
  return { ok: true, fields };
}

const money = (amount: number | null, currency: string) =>
  amount === null ? null : `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

/** One readable line for the case history: "AXA · Factura F-1 · $1,500.00 MXN · Recibido". */
export function describeReimbursement(r: Pick<ReimbursementRow, "insurer" | "invoice_number" | "amount" | "currency" | "status">): string {
  return [r.insurer, r.invoice_number ? `Factura ${r.invoice_number}` : null, money(r.amount, r.currency), STATUS_ES[r.status]]
    .filter(Boolean)
    .join(" · ");
}

async function logEvent(
  supabase: SupabaseClient,
  caseId: string,
  eventType: string,
  userId: string,
  detail: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("case_events").insert({
    case_id: caseId,
    event_type: eventType,
    actor: "staff",
    actor_user_id: userId,
    detail,
    created_at: new Date().toISOString(),
  });
  if (error) console.error("[reimbursements] case_events insert failed", eventType, (error as { message?: string }).message);
}

async function loadOpenCase(supabase: SupabaseClient, caseId: string) {
  const { data } = await supabase
    .from("patient_cases")
    .select("id, status, patient_id, appointment_id")
    .eq("id", caseId)
    .maybeSingle();
  const c = data as { id: string; status: string; patient_id: string | null; appointment_id: string | null } | null;
  if (!c) return fail("not_found", "No encontré el caso.");
  if (c.status === "resolved" || c.status === "closed") return fail("case_closed", "El caso ya está cerrado.");
  return { ok: true as const, case: c };
}

export type ReimbursementResult = { ok: true; reimbursement: ReimbursementRow } | Fail;

export async function createReimbursement(
  supabase: SupabaseClient,
  caseId: string,
  userId: string,
  fields: ReimbursementFields,
  now = new Date(),
): Promise<ReimbursementResult> {
  const c = await loadOpenCase(supabase, caseId);
  if (!c.ok) return c;
  if (!fields.insurer) return fail("invalid_insurer", "Escribe el nombre de la aseguradora.");
  const status = fields.status ?? "recibido";
  const iso = now.toISOString();

  const { data, error } = await supabase
    .from("reimbursements")
    .insert({
      case_id: caseId,
      patient_id: c.case.patient_id,
      appointment_id: c.case.appointment_id,
      insurer: fields.insurer,
      invoice_number: fields.invoice_number ?? null,
      amount: fields.amount ?? null,
      currency: fields.currency ?? "MXN",
      status,
      notes: fields.notes ?? null,
      submitted_at: STAGE[status] >= 1 ? iso : null,
      resolved_at: FINAL.includes(status) ? iso : null,
      created_by_user_id: userId,
      created_at: iso,
      updated_at: iso,
    })
    .select("*")
    .single();
  if (error || !data) {
    console.error("[reimbursements] insert failed", (error as { message?: string } | null)?.message);
    return fail("temporarily_unavailable", "No se pudo registrar el reembolso. Intenta de nuevo.");
  }
  const row = data as ReimbursementRow;
  await logEvent(supabase, caseId, "reimbursement_created", userId, {
    reimbursement_id: row.id,
    status,
    text: describeReimbursement(row),
  });
  return { ok: true, reimbursement: row };
}

const EDITABLE = ["insurer", "invoice_number", "amount", "currency", "notes"] as const;

export async function updateReimbursement(
  supabase: SupabaseClient,
  caseId: string,
  reimbursementId: string,
  userId: string,
  fields: ReimbursementFields,
  now = new Date(),
): Promise<ReimbursementResult> {
  const c = await loadOpenCase(supabase, caseId);
  if (!c.ok) return c;
  const { data } = await supabase.from("reimbursements").select("*").eq("id", reimbursementId).maybeSingle();
  const current = data as ReimbursementRow | null;
  if (!current || current.case_id !== caseId) return fail("reimbursement_not_found", "No encontré ese reembolso en este caso.");
  if (FINAL.includes(current.status)) {
    return fail("reimbursement_locked", `El reembolso ya está ${STATUS_ES[current.status].toLowerCase()}; agrega una nota al caso si hace falta corregir algo.`);
  }

  const patch: Record<string, unknown> = {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of EDITABLE) {
    const v = fields[k];
    if (v !== undefined && v !== current[k]) {
      patch[k] = v;
      changes[k] = { from: current[k], to: v };
    }
  }
  const iso = now.toISOString();
  const statusChanged = fields.status !== undefined && fields.status !== current.status;
  if (statusChanged) {
    const to = fields.status!;
    if (STAGE[to] < STAGE[current.status]) {
      return fail("invalid_transition", `No se puede regresar de "${STATUS_ES[current.status]}" a "${STATUS_ES[to]}".`);
    }
    patch.status = to;
    if (STAGE[to] >= 1 && !current.submitted_at) patch.submitted_at = iso;
    if (FINAL.includes(to)) patch.resolved_at = iso;
  }
  if (Object.keys(patch).length === 0) return fail("nothing_to_update", "No hay cambios.");

  // Guarded on the status we read: two people moving it at once can't both win.
  const { data: updated } = await supabase
    .from("reimbursements")
    .update(patch)
    .eq("id", current.id)
    .eq("status", current.status)
    .select("*");
  const rows = (updated ?? []) as ReimbursementRow[];
  if (rows.length === 0) return fail("concurrent_change", "El reembolso cambió mientras lo editabas; recarga.");
  const row = rows[0];

  if (statusChanged) {
    await logEvent(supabase, caseId, "reimbursement_status", userId, {
      reimbursement_id: row.id,
      from: current.status,
      to: row.status,
      text: `${STATUS_ES[current.status]} → ${STATUS_ES[row.status]} · ${describeReimbursement(row)}`,
    });
  }
  if (Object.keys(changes).length > 0) {
    await logEvent(supabase, caseId, "reimbursement_updated", userId, {
      reimbursement_id: row.id,
      changes,
      text: describeReimbursement(row),
    });
  }
  return { ok: true, reimbursement: row };
}
