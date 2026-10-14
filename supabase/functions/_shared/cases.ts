// Patient cases and human handoff — block B6 (M09 open_case, M10 request_handoff,
// M11 get_my_case_status, plus the staff actions behind /admin/casos).
//
// Rules (plan §6.1-D, R31/R32, decision D10):
//  * Persisting the case, pausing the AI and assigning a person are separate
//    operations. Each result is recorded in case_events and projected on the
//    case (ai_state, whaapy_assignment); a provider failure never turns into a
//    claimed success.
//  * `assigned` happens ONLY when a staff member takes the case in FindMed
//    (single owner of assignment). The agent's handoff leaves the case in
//    `awaiting_assignment` and tells the patient exactly that.
//  * The AI is switched off for the conversation (not a timed pause): it stays
//    off until staff resolves the case and chooses to resume it, so it never
//    comes back by itself in the middle of a human conversation.
//  * Identity: patient-facing calls are scoped to the canonical phone; another
//    patient's case is "not_found". Internal notes/events never leave staff.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isValidNormalizedPhone, mxPhoneLookupVariants, normalizeMxPhone } from "./phone.ts";
import { raiseCaseAlert } from "./staff-alerts.ts";
import type { WhaapyClient } from "./whaapy-client.ts";

/** Types the WhatsApp agent may open (open_case tool enum). */
export const REQUEST_TYPES = ["appointment_help", "hospital", "studies", "urgency", "follow_up", "other"] as const;
/** All case types: the agent's plus the ones only staff or the post-consultation routes open (Etapa 2). */
export const CASE_REQUEST_TYPES = [...REQUEST_TYPES, "procedure", "referral", "reimbursement"] as const;
export type RequestType = (typeof CASE_REQUEST_TYPES)[number];
/** Who opened the case (patient_cases.source). */
export type CaseSource = "mcp" | "admin" | "whatsapp" | "post_consultation";
export const PRIORITIES = ["normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const ACTIVE_STATUSES = ["open", "awaiting_assignment", "assigned", "awaiting_patient", "awaiting_provider"] as const;
export type CaseStatus = (typeof ACTIVE_STATUSES)[number] | "resolved" | "closed";

/** WHAAPY tags kept as a projection, with the names the n8n flow used (N065–N067). */
export const HANDOFF_TAG = "apoyo_asesor";
export const URGENCY_TAG = "urgencia";

type Fail = { ok: false; code: string; message_es: string };
const fail = (code: string, message_es: string): Fail => ({ ok: false, code, message_es });

type Actor = "agent" | "staff" | "system" | "whaapy";

export interface CaseRow {
  id: string;
  request_type: RequestType;
  subject_phone: string;
  status: CaseStatus;
  priority: Priority;
  summary: string;
  handoff_requested_at: string | null;
  assigned_user_id: string | null;
  whaapy_conversation_id: string | null;
  whaapy_contact_id: string | null;
  ai_state: string;
  whaapy_assignment: string;
  created_at: string;
  updated_at: string;
}

const PRIORITY_RANK: Record<Priority, number> = { normal: 0, high: 1, urgent: 2 };
const maxPriority = (a: Priority, b: Priority): Priority => (PRIORITY_RANK[a] >= PRIORITY_RANK[b] ? a : b);

function phoneOf(raw: string): { canonical: string; variants: string[] } | null {
  const canonical = normalizeMxPhone(raw);
  if (!isValidNormalizedPhone(canonical)) return null;
  return { canonical, variants: mxPhoneLookupVariants(canonical) };
}

async function logEvent(
  supabase: SupabaseClient,
  caseId: string,
  event_type: string,
  actor: Actor,
  detail: Record<string, unknown> = {},
  actorUserId: string | null = null,
): Promise<void> {
  const { error } = await supabase.from("case_events").insert({
    case_id: caseId,
    event_type,
    actor,
    actor_user_id: actorUserId,
    detail,
    created_at: new Date().toISOString(),
  });
  if (error) console.error("[cases] case_events insert failed", event_type, error.message);
}

async function findActiveCase(
  supabase: SupabaseClient,
  variants: string[],
  type: RequestType,
): Promise<CaseRow | null> {
  const { data } = await supabase
    .from("patient_cases")
    .select("*")
    .in("subject_phone", variants)
    .eq("request_type", type)
    .in("status", [...ACTIVE_STATUSES])
    .limit(1)
    .maybeSingle();
  return (data as CaseRow | null) ?? null;
}

// ---------------------------------------------------------------------------
// M09 — open_case

export interface OpenCaseInput {
  phone: string;
  requestType: RequestType;
  summary: string;
  priority?: Priority;
  contactName?: string | null;
  city?: string | null;
  zone?: string | null;
  // Etapa 2 — optional; the defaults keep the agent's (MCP) behavior.
  source?: CaseSource;
  actor?: Actor;
  actorUserId?: string | null;
  /** Known patient (staff picked it / it comes from the appointment); else looked up by phone. */
  patientId?: string | null;
  appointmentId?: string | null;
  nextAction?: string | null;
  dueAt?: string | null;
  /** Extra context merged into the created / deduplicated case_event (e.g. origin). */
  eventDetail?: Record<string, unknown>;
}

export type OpenCaseResult =
  | { ok: true; case_id: string; status: CaseStatus; priority: Priority; deduplicated: boolean }
  | Fail;

export async function openCase(supabase: SupabaseClient, input: OpenCaseInput): Promise<OpenCaseResult> {
  const who = phoneOf(input.phone);
  if (!who) return fail("invalid_phone", "No pude identificar el número de este contacto.");
  const summary = input.summary.trim().slice(0, 1000);
  if (summary.length < 3) return fail("invalid_summary", "Falta un resumen breve de la solicitud.");
  const priority = input.priority ?? "normal";
  const actor: Actor = input.actor ?? "agent";
  const actorUserId = input.actorUserId ?? null;
  const extra = input.eventDetail ?? {};

  // Repeated request for the same thing → same case (also guarded by the
  // partial unique index patient_cases_one_active against races).
  const reuse = async (existing: CaseRow): Promise<OpenCaseResult> => {
    const merged = maxPriority(existing.priority, priority);
    if (merged !== existing.priority) {
      await supabase.from("patient_cases").update({ priority: merged }).eq("id", existing.id);
    }
    await logEvent(supabase, existing.id, "deduplicated", actor, { summary, priority, ...extra }, actorUserId);
    return { ok: true, case_id: existing.id, status: existing.status, priority: merged, deduplicated: true };
  };

  const existing = await findActiveCase(supabase, who.variants, input.requestType);
  if (existing) return reuse(existing);

  let patientId = input.patientId ?? null;
  if (!patientId) {
    const { data: patient } = await supabase
      .from("patients")
      .select("id")
      .in("phone", who.variants)
      .limit(1)
      .maybeSingle();
    patientId = (patient as { id: string } | null)?.id ?? null;
  }

  const now = new Date().toISOString();
  const { data: created, error } = await supabase
    .from("patient_cases")
    .insert({
      request_type: input.requestType,
      source: input.source ?? "mcp",
      subject_phone: who.canonical,
      patient_id: patientId,
      appointment_id: input.appointmentId ?? null,
      next_action: input.nextAction?.trim().slice(0, 500) || null,
      due_at: input.dueAt ?? null,
      contact_name: input.contactName?.trim().slice(0, 120) || null,
      city: input.city?.trim().slice(0, 80) || null,
      zone: input.zone?.trim().slice(0, 80) || null,
      summary,
      priority,
      status: "open",
      ai_state: "not_requested",
      whaapy_assignment: "none",
      created_at: now,
      updated_at: now,
    })
    .select("id, status, priority")
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      const raced = await findActiveCase(supabase, who.variants, input.requestType);
      if (raced) return reuse(raced);
    }
    console.error("[cases] insert failed", error.message);
    return fail("temporarily_unavailable", "No pude registrar la solicitud en este momento.");
  }
  const row = created as { id: string; status: CaseStatus; priority: Priority };
  await logEvent(supabase, row.id, "created", actor, { request_type: input.requestType, priority, ...extra }, actorUserId);
  // Tell the team right away (panel now, WhatsApp for urgent/high via the
  // worker). Best-effort and idempotent: it never fails the case.
  await raiseCaseAlert(
    supabase,
    { id: row.id, request_type: input.requestType, priority: row.priority, status: row.status, summary, created_at: now },
    "opened",
  );
  return { ok: true, case_id: row.id, status: row.status, priority: row.priority, deduplicated: false };
}

// ---------------------------------------------------------------------------
// WHAAPY side effects (each recorded; none assumed)

/** Finds the WHAAPY conversation for the case's phone and stores its ids. */
async function ensureConversation(
  supabase: SupabaseClient,
  whaapy: WhaapyClient,
  c: CaseRow,
  actor: Actor,
): Promise<{ conversationId: string; contactId: string | null } | null> {
  if (c.whaapy_conversation_id) {
    return { conversationId: c.whaapy_conversation_id, contactId: c.whaapy_contact_id };
  }
  if (!whaapy.configured) {
    await logEvent(supabase, c.id, "whaapy_not_configured", actor);
    return null;
  }
  const r = await whaapy.conversationByPhone(c.subject_phone);
  if (!r.ok) {
    await logEvent(supabase, c.id, "conversation_lookup_failed", actor, { http_status: r.status, error: r.error });
    return null;
  }
  if (!r.data) {
    await logEvent(supabase, c.id, "conversation_not_found", actor);
    return null;
  }
  await supabase
    .from("patient_cases")
    .update({ whaapy_conversation_id: r.data.id, whaapy_contact_id: r.data.contact_id })
    .eq("id", c.id);
  c.whaapy_conversation_id = r.data.id;
  c.whaapy_contact_id = r.data.contact_id;
  return { conversationId: r.data.id, contactId: r.data.contact_id };
}

/** Switches the AI off (pause=true) or back on for the case's conversation. */
async function setCaseAi(
  supabase: SupabaseClient,
  whaapy: WhaapyClient,
  c: CaseRow,
  pause: boolean,
  actor: Actor,
  actorUserId: string | null = null,
): Promise<boolean> {
  const failedState = pause ? "pause_failed" : "resume_failed";
  const conv = await ensureConversation(supabase, whaapy, c, actor);
  if (!conv) {
    await supabase.from("patient_cases").update({ ai_state: failedState }).eq("id", c.id);
    c.ai_state = failedState;
    return false;
  }
  const r = await whaapy.setAiEnabled(conv.conversationId, !pause);
  const state = r.ok ? (pause ? "paused" : "resumed") : failedState;
  await supabase.from("patient_cases").update({ ai_state: state }).eq("id", c.id);
  c.ai_state = state;
  await logEvent(
    supabase,
    c.id,
    r.ok ? (pause ? "ai_paused" : "ai_resumed") : (pause ? "ai_pause_failed" : "ai_resume_failed"),
    actor,
    r.ok ? {} : { http_status: r.status, error: r.error },
    actorUserId,
  );
  return r.ok;
}

async function addTags(supabase: SupabaseClient, whaapy: WhaapyClient, c: CaseRow, tags: string[]): Promise<void> {
  if (!c.whaapy_contact_id) return;
  const r = await whaapy.updateContact(c.whaapy_contact_id, { add_tags: tags });
  await logEvent(supabase, c.id, r.ok ? "tags_added" : "tags_failed", "system", r.ok ? { tags } : { tags, http_status: r.status, error: r.error });
}

// ---------------------------------------------------------------------------
// M10 — request_handoff

export type HandoffResult =
  | {
    ok: true;
    case_id: string;
    status: CaseStatus;
    assignment: "assigned" | "awaiting_assignment";
    ai_paused: boolean;
    replayed: boolean;
  }
  | Fail;

export async function requestHandoff(
  supabase: SupabaseClient,
  whaapy: WhaapyClient,
  input: { phone: string; caseId: string; reason: string; priority?: Priority },
): Promise<HandoffResult> {
  const who = phoneOf(input.phone);
  if (!who) return fail("invalid_phone", "No pude identificar el número de este contacto.");

  const { data } = await supabase.from("patient_cases").select("*").eq("id", input.caseId).maybeSingle();
  const c = data as CaseRow | null;
  if (!c || !who.variants.includes(c.subject_phone)) {
    return fail("not_found", "No encontré esa solicitud para este número.");
  }
  if (c.status === "resolved" || c.status === "closed") {
    return fail("case_closed", "Esa solicitud ya se cerró; abre una nueva si el paciente necesita ayuda.");
  }

  const assignment = (s: CaseStatus) => (s === "open" || s === "awaiting_assignment" ? "awaiting_assignment" : "assigned");

  // Retried call after a successful handoff: report the current state, no new side effects.
  if (c.handoff_requested_at && c.ai_state === "paused") {
    return { ok: true, case_id: c.id, status: c.status, assignment: assignment(c.status), ai_paused: true, replayed: true };
  }

  const priority = maxPriority(c.priority, input.priority ?? c.priority);
  const nextStatus: CaseStatus = c.status === "open" ? "awaiting_assignment" : c.status;
  const firstRequest = !c.handoff_requested_at;
  await supabase
    .from("patient_cases")
    .update({
      status: nextStatus,
      priority,
      handoff_reason: input.reason.trim().slice(0, 500),
      ...(firstRequest ? { handoff_requested_at: new Date().toISOString() } : {}),
    })
    .eq("id", c.id);
  c.status = nextStatus;
  c.priority = priority;
  await logEvent(supabase, c.id, firstRequest ? "handoff_requested" : "handoff_retried", "agent", {
    reason: input.reason.trim().slice(0, 500),
    priority,
  });
  // The team learns about it before any WHAAPY call (panel now, WhatsApp via
  // the worker). One alert per case: a retried call never alerts twice.
  await raiseCaseAlert(supabase, c, "handoff");

  const paused = await setCaseAi(supabase, whaapy, c, true, "agent");
  if (firstRequest) {
    await addTags(supabase, whaapy, c, priority === "urgent" ? [HANDOFF_TAG, URGENCY_TAG] : [HANDOFF_TAG]);
  }

  return { ok: true, case_id: c.id, status: c.status, assignment: assignment(c.status), ai_paused: paused, replayed: false };
}

// ---------------------------------------------------------------------------
// M11 — get_my_case_status

const PATIENT_STATUS_ES: Record<CaseStatus, string> = {
  open: "Recibimos tu solicitud.",
  awaiting_assignment: "Tu solicitud está en espera de que un asesor de FindMed la tome.",
  assigned: "Un asesor de FindMed ya tiene tu solicitud.",
  awaiting_patient: "Estamos esperando información de tu parte.",
  awaiting_provider: "Estamos esperando respuesta del médico, laboratorio u hospital.",
  resolved: "Tu solicitud quedó resuelta.",
  closed: "Tu solicitud se cerró.",
};

export async function getMyCases(
  supabase: SupabaseClient,
  phone: string,
): Promise<{ ok: true; cases: { case_id: string; request_type: string; status: CaseStatus; status_es: string; created_at: string; updated_at: string }[] } | Fail> {
  const who = phoneOf(phone);
  if (!who) return fail("invalid_phone", "No pude identificar el número de este contacto.");
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("patient_cases")
    .select("id, request_type, status, created_at, updated_at")
    .in("subject_phone", who.variants)
    .gt("updated_at", since)
    .order("updated_at", { ascending: false })
    .limit(5);
  if (error) return fail("temporarily_unavailable", "No pude consultar tus solicitudes en este momento.");
  const rows = (data ?? []) as { id: string; request_type: string; status: CaseStatus; created_at: string; updated_at: string }[];
  return {
    ok: true,
    cases: rows.map((r) => ({
      case_id: r.id,
      request_type: r.request_type,
      status: r.status,
      status_es: PATIENT_STATUS_ES[r.status] ?? "",
      created_at: r.created_at,
      updated_at: r.updated_at,
    })),
  };
}

// ---------------------------------------------------------------------------
// Staff actions (case-actions Edge Function, admin JWT)

export type StaffAction =
  | { action: "take"; reassign?: boolean }
  | { action: "update"; status?: "awaiting_assignment" | "assigned" | "awaiting_patient" | "awaiting_provider"; next_action?: string | null; due_at?: string | null; priority?: Priority }
  | { action: "note"; text: string }
  | { action: "retry_pause" }
  | { action: "resolve"; outcome: "resolved" | "closed"; reason: string; resume_ai: boolean };

export interface Staff {
  userId: string;
  email: string | null;
}

export type StaffResult = { ok: true; case: CaseRow; warnings: string[] } | Fail;

async function loadCase(supabase: SupabaseClient, id: string): Promise<CaseRow | null> {
  const { data } = await supabase.from("patient_cases").select("*").eq("id", id).maybeSingle();
  return (data as CaseRow | null) ?? null;
}

/** Assigns the WHAAPY contact to the agent whose email matches the staff member. */
async function assignInWhaapy(supabase: SupabaseClient, whaapy: WhaapyClient, c: CaseRow, staff: Staff): Promise<string | null> {
  if (!whaapy.configured) return "WHAAPY no está configurado; la asignación quedó solo en FindMed.";
  const conv = await ensureConversation(supabase, whaapy, c, "staff");
  if (!conv?.contactId) {
    await supabase.from("patient_cases").update({ whaapy_assignment: "failed" }).eq("id", c.id);
    return "No encontré la conversación en WHAAPY; la asignación quedó solo en FindMed.";
  }
  const agents = await whaapy.listAgents();
  if (!agents.ok) {
    await supabase.from("patient_cases").update({ whaapy_assignment: "failed" }).eq("id", c.id);
    await logEvent(supabase, c.id, "whaapy_assign_failed", "staff", { http_status: agents.status, error: agents.error }, staff.userId);
    return "No pude consultar el equipo de WHAAPY; la asignación quedó solo en FindMed.";
  }
  const email = staff.email?.toLowerCase() ?? "";
  const agent = email ? agents.data.find((a) => a.email?.toLowerCase() === email) : undefined;
  if (!agent) {
    await supabase.from("patient_cases").update({ whaapy_assignment: "no_matching_agent" }).eq("id", c.id);
    await logEvent(supabase, c.id, "whaapy_no_matching_agent", "staff", {}, staff.userId);
    return "Tu correo no corresponde a un agente de WHAAPY; la asignación quedó solo en FindMed.";
  }
  const r = await whaapy.updateContact(conv.contactId, { assigned_agent_id: agent.id });
  await supabase.from("patient_cases").update({ whaapy_assignment: r.ok ? "assigned" : "failed" }).eq("id", c.id);
  await logEvent(
    supabase,
    c.id,
    r.ok ? "whaapy_assigned" : "whaapy_assign_failed",
    "staff",
    r.ok ? { agent_id: agent.id } : { http_status: r.status, error: r.error },
    staff.userId,
  );
  return r.ok ? null : "WHAAPY rechazó la asignación; quedó solo en FindMed.";
}

export async function applyStaffAction(
  supabase: SupabaseClient,
  whaapy: WhaapyClient,
  caseId: string,
  staff: Staff,
  a: StaffAction,
): Promise<StaffResult> {
  const c = await loadCase(supabase, caseId);
  if (!c) return fail("not_found", "No encontré el caso.");
  const closed = c.status === "resolved" || c.status === "closed";
  if (closed) return fail("case_closed", "El caso ya está cerrado.");
  const warnings: string[] = [];

  switch (a.action) {
    case "take": {
      if (c.assigned_user_id && c.assigned_user_id !== staff.userId && !a.reassign) {
        return fail("already_assigned", "Otra persona ya tomó este caso.");
      }
      // Guarded on the status we read so two people taking at once can't both win.
      const { data: won } = await supabase
        .from("patient_cases")
        .update({ status: "assigned", assigned_user_id: staff.userId, assigned_at: new Date().toISOString() })
        .eq("id", c.id)
        .eq("status", c.status)
        .select("id");
      if (!won || (won as unknown[]).length === 0) return fail("concurrent_change", "El caso cambió mientras lo tomabas; recarga.");
      await logEvent(supabase, c.id, "assigned", "staff", { previous_user_id: c.assigned_user_id }, staff.userId);
      Object.assign(c, { status: "assigned", assigned_user_id: staff.userId });
      const w = await assignInWhaapy(supabase, whaapy, c, staff);
      if (w) warnings.push(w);
      if (c.ai_state !== "paused") {
        const ok = await setCaseAi(supabase, whaapy, c, true, "staff", staff.userId);
        if (!ok) warnings.push("No se pudo apagar la IA en WHAAPY: el agente automático podría seguir respondiendo.");
      }
      break;
    }
    case "update": {
      const patch: Record<string, unknown> = {};
      if (a.status && a.status !== c.status) {
        if (a.status === "awaiting_assignment") {
          // Back to the queue: nobody owns it any more, and the SLA restarts
          // now so the team is alerted again if nobody takes it.
          Object.assign(patch, {
            status: a.status,
            assigned_user_id: null,
            assigned_at: null,
            alert_level: 0,
            last_alert_at: new Date().toISOString(),
          });
        } else if (!c.assigned_user_id) {
          // "Asignado" / "Esperando…" without anyone taking it took the case
          // out of the SLA queue (no more alerts) with no owner.
          return fail("take_first", "Primero toma el caso («Tomar caso») para que quede claro quién lo atiende.");
        } else {
          patch.status = a.status;
        }
      } else if (a.status) {
        patch.status = a.status;
      }
      if (a.next_action !== undefined) patch.next_action = a.next_action?.trim().slice(0, 500) || null;
      if (a.due_at !== undefined) {
        if (a.due_at !== null && Number.isNaN(Date.parse(a.due_at))) return fail("invalid_due_at", "Fecha de vencimiento inválida.");
        patch.due_at = a.due_at;
      }
      if (a.priority) patch.priority = a.priority;
      if (Object.keys(patch).length === 0) return fail("nothing_to_update", "No hay cambios.");
      await supabase.from("patient_cases").update(patch).eq("id", c.id);
      await logEvent(supabase, c.id, "updated", "staff", patch, staff.userId);
      break;
    }
    case "note": {
      const text = a.text.trim().slice(0, 2000);
      if (!text) return fail("empty_note", "La nota está vacía.");
      await logEvent(supabase, c.id, "note", "staff", { text }, staff.userId);
      break;
    }
    case "retry_pause": {
      const ok = await setCaseAi(supabase, whaapy, c, true, "staff", staff.userId);
      if (!ok) warnings.push("No se pudo apagar la IA en WHAAPY.");
      break;
    }
    case "resolve": {
      const reason = a.reason.trim().slice(0, 500);
      if (reason.length < 3) return fail("reason_required", "Escribe el motivo de cierre.");
      await supabase
        .from("patient_cases")
        .update({ status: a.outcome, resolution_reason: reason, resolved_at: new Date().toISOString() })
        .eq("id", c.id);
      await logEvent(supabase, c.id, a.outcome, "staff", { reason, resume_ai: a.resume_ai }, staff.userId);
      if (a.resume_ai && (c.ai_state === "paused" || c.ai_state === "resume_failed")) {
        const ok = await setCaseAi(supabase, whaapy, c, false, "staff", staff.userId);
        if (!ok) warnings.push("No se pudo reactivar la IA en WHAAPY; reactívala desde WHAAPY.");
      }
      if (c.whaapy_assignment === "assigned" && c.whaapy_contact_id) {
        const r = await whaapy.updateContact(c.whaapy_contact_id, { assigned_agent_id: null });
        await supabase.from("patient_cases").update({ whaapy_assignment: r.ok ? "released" : "assigned" }).eq("id", c.id);
        await logEvent(supabase, c.id, r.ok ? "whaapy_released" : "whaapy_release_failed", "staff", r.ok ? {} : { http_status: r.status, error: r.error }, staff.userId);
        if (!r.ok) warnings.push("No se pudo quitar la asignación en WHAAPY; las próximas conversaciones del contacto seguirán asignadas.");
      }
      break;
    }
  }

  const fresh = await loadCase(supabase, c.id);
  return { ok: true, case: fresh ?? c, warnings };
}
