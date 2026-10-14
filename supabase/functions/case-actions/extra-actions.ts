// Etapa 2 — acciones del equipo que no operan sobre un caso existente o que
// operan sobre sus reembolsos. Separado de handler.ts para no mezclarlo con
// el flujo de canalización (take/update/note/resolve).
//
//   { action: "create_case", request_type, summary, priority?, patient_id? | phone + contact_name? }
//       → 200 { case, warnings[], deduplicated }
//   { action: "reimbursement_create", case_id, insurer, invoice_number?, amount?, currency?, status?, notes? }
//   { action: "reimbursement_update", case_id, reimbursement_id, ...same fields }
//       → 200 { reimbursement }
//
// Returns null when the action is not one of these (handler.ts goes on).

import { CASE_REQUEST_TYPES, openCase, PRIORITIES, type Priority, type RequestType } from "../_shared/cases.ts";
import { jsonResponse } from "../_shared/cors.ts";
import { createReimbursement, parseReimbursementFields, updateReimbursement } from "../_shared/reimbursements.ts";
import type { CaseActionDeps } from "./handler.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const EXTRA_ACTIONS = ["create_case", "reimbursement_create", "reimbursement_update"] as const;

const STATUS_FOR: Record<string, number> = {
  not_found: 404,
  patient_not_found: 404,
  reimbursement_not_found: 404,
  case_closed: 409,
  reimbursement_locked: 409,
  concurrent_change: 409,
  temporarily_unavailable: 503,
};

const bad = (error: string, message: string) => jsonResponse({ error, message }, 400);
const failed = (code: string, message: string) => jsonResponse({ error: code, message }, STATUS_FOR[code] ?? 400);

async function createCase(body: Record<string, unknown>, deps: CaseActionDeps, userId: string): Promise<Response> {
  const type = body.request_type;
  if (typeof type !== "string" || !(CASE_REQUEST_TYPES as readonly string[]).includes(type)) {
    return bad("invalid_request_type", "Tipo de caso inválido.");
  }
  const priority = body.priority ?? "normal";
  if (typeof priority !== "string" || !(PRIORITIES as readonly string[]).includes(priority)) {
    return bad("invalid_priority", "Prioridad inválida.");
  }
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  if (summary.length < 3 || summary.length > 1000) return bad("invalid_summary", "Escribe un resumen de 3 a 1000 caracteres.");

  // A picked patient wins over whatever phone/name the browser sent.
  let phone: string;
  let contactName: string | null;
  let patientId: string | null = null;
  if (body.patient_id !== undefined && body.patient_id !== null) {
    if (typeof body.patient_id !== "string" || !UUID_RE.test(body.patient_id)) return bad("invalid_patient_id", "Paciente inválido.");
    const { data } = await deps.supabase.from("patients").select("id, full_name, phone").eq("id", body.patient_id).maybeSingle();
    const p = data as { id: string; full_name: string | null; phone: string } | null;
    if (!p) return failed("patient_not_found", "No encontré a ese paciente.");
    phone = p.phone;
    contactName = p.full_name;
    patientId = p.id;
  } else {
    if (typeof body.phone !== "string" || !body.phone.trim()) return bad("invalid_phone", "Elige un paciente o escribe un teléfono.");
    phone = body.phone;
    contactName = typeof body.contact_name === "string" ? body.contact_name : null;
  }

  const r = await openCase(deps.supabase, {
    phone,
    requestType: type as RequestType,
    summary,
    priority: priority as Priority,
    contactName,
    patientId,
    source: "admin",
    actor: "staff",
    actorUserId: userId,
    eventDetail: { origin: "admin" },
  });
  if (!r.ok) return failed(r.code, r.message_es);

  const { data: row } = await deps.supabase.from("patient_cases").select("*").eq("id", r.case_id).maybeSingle();
  const warnings = r.deduplicated
    ? ["Este paciente ya tenía un caso activo de ese tipo: se agregó tu resumen a su historial en lugar de abrir otro."]
    : [];
  return jsonResponse({ case: row, warnings, deduplicated: r.deduplicated });
}

async function reimbursement(body: Record<string, unknown>, deps: CaseActionDeps, userId: string): Promise<Response> {
  if (typeof body.case_id !== "string" || !UUID_RE.test(body.case_id)) return bad("invalid_case_id", "case_id inválido");
  const creating = body.action === "reimbursement_create";
  const parsed = parseReimbursementFields(body, creating ? "create" : "update");
  if (!parsed.ok) return bad(parsed.code, parsed.message_es);

  if (creating) {
    const r = await createReimbursement(deps.supabase, body.case_id, userId, parsed.fields);
    return r.ok ? jsonResponse({ reimbursement: r.reimbursement }) : failed(r.code, r.message_es);
  }
  if (typeof body.reimbursement_id !== "string" || !UUID_RE.test(body.reimbursement_id)) {
    return bad("invalid_reimbursement_id", "reimbursement_id inválido");
  }
  const r = await updateReimbursement(deps.supabase, body.case_id, body.reimbursement_id, userId, parsed.fields);
  return r.ok ? jsonResponse({ reimbursement: r.reimbursement }) : failed(r.code, r.message_es);
}

/** Handles the Etapa 2 actions; null for any other action. Caller already authorized an admin. */
export async function handleExtraAction(
  body: Record<string, unknown>,
  deps: CaseActionDeps,
  userId: string,
): Promise<Response | null> {
  switch (body.action) {
    case "create_case":
      return createCase(body, deps, userId);
    case "reimbursement_create":
    case "reimbursement_update":
      return reimbursement(body, deps, userId);
    default:
      return null;
  }
}
