// Staff alerts for patient cases (client complaint #1: "the system tells the
// patient someone will continue, and nobody on the team is notified").
//
//   openCase / requestHandoff ──▶ raiseCaseAlert ──▶ case_alerts (idempotency gate)
//                                        │              └─▶ notifications (panel, realtime)
//                                        └─▶ case_events 'staff_alert_sent' (channel panel)
//   findmed-events-worker ──▶ runStaffAlerts
//        ├─ escalateOverdueCases: case still unassigned past its SLA → 'escalated'
//        │   + raiseCaseAlert('overdue', level n) every SLA period, up to max_escalations
//        └─ claim_case_alerts ──▶ processCaseAlert ──▶ WHAAPY template per on-call number
//                                       └─▶ message_deliveries (source 'staff_alert'; receipts
//                                           arrive through whaapy-inbound → applyReceipt)
//
// Guarantees:
//  * The panel notification is written synchronously and never depends on
//    WhatsApp/WHAAPY. Every helper here is best-effort: it logs and returns,
//    it never throws into the patient flow (open_case / request_handoff).
//  * Idempotent: one alert per (case, kind, level) — case_alerts.dedupe_key —
//    so replays and concurrent calls create one notification and one WhatsApp.
//  * No spam: a case that was taken in the meantime gets no WhatsApp; re-alerts
//    wait a full SLA period after the previous alert; at most max_escalations.
//  * WhatsApp delivery follows the patient-messaging rules (messaging.ts): a
//    send already accepted is never repeated, a lost response is 'uncertain'
//    and waits for a person, 429/503 are retried with backoff.
//  * The SLA rule lives here (nextEscalationAt) and is mirrored in SQL by
//    public.staff_alerts_have_work() (cron wake-up, migration 20261014110000).
//    Change both together.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isValidNormalizedPhone, normalizeMxPhone } from "./phone.ts";
import { type CatalogTemplate, normalizeTemplate } from "./template-catalog.ts";
import type { WhaapyClient } from "./whaapy-client.ts";

export type AlertKind = "opened" | "handoff" | "overdue";
export type AlertPriority = "normal" | "high" | "urgent";

/** Statuses in which nobody on the team has taken the case yet. */
export const WAITING_STATUSES = ["open", "awaiting_assignment"] as const;

export const NOTIFICATION_TYPE: Record<AlertKind, string> = {
  opened: "case_opened",
  handoff: "case_handoff",
  overdue: "case_overdue",
};

export interface AlertSettings {
  template_name: string;
  template_language: string;
  sla_urgent_minutes: number;
  sla_high_minutes: number;
  sla_normal_minutes: number;
  max_escalations: number;
  whatsapp_enabled: boolean;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  template_name: "alerta_caso_findmed",
  template_language: "es_MX",
  sla_urgent_minutes: 10,
  sla_high_minutes: 30,
  sla_normal_minutes: 120,
  max_escalations: 3,
  whatsapp_enabled: true,
};

/** Body variables of the alert template, in order (see docs/findmed-migration/agente/plantilla-alerta-casos.md). */
export const ALERT_TEMPLATE_VARIABLES = 4;
export const SUMMARY_MAX = 120;

export const TYPE_LABEL_ES: Record<string, string> = {
  appointment_help: "Ayuda con cita",
  hospital: "Hospital",
  studies: "Estudios",
  urgency: "Urgencia",
  follow_up: "Seguimiento",
  other: "Otro",
  procedure: "Procedimiento",
  referral: "Referencia",
  reimbursement: "Reembolso",
};

export const PRIORITY_LABEL_ES: Record<AlertPriority, string> = { urgent: "Urgente", high: "Alta", normal: "Normal" };

const MINUTE = 60_000;
const MAX_ALERT_ATTEMPTS = 5;
const BACKOFF_MINUTES = [1, 5, 15, 60];
const DONE = new Set(["accepted", "sent", "delivered", "read"]);

const iso = (ms: number) => new Date(ms).toISOString();
const typeLabel = (t: string) => TYPE_LABEL_ES[t] ?? "Solicitud";
export const asPriority = (p: unknown): AlertPriority => (p === "urgent" || p === "high" ? p : "normal");

// ---------------------------------------------------------------------------
// Settings

const intIn = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback;

/** Single-row settings; any problem (missing row/table) falls back to the defaults. */
export async function loadAlertSettings(supabase: SupabaseClient): Promise<AlertSettings> {
  try {
    const { data, error } = await supabase.from("staff_alert_settings").select("*").eq("id", true).maybeSingle();
    if (error || !data) return { ...DEFAULT_ALERT_SETTINGS };
    const r = data as Record<string, unknown>;
    const d = DEFAULT_ALERT_SETTINGS;
    return {
      template_name: typeof r.template_name === "string" && r.template_name ? r.template_name : d.template_name,
      template_language: typeof r.template_language === "string" && r.template_language ? r.template_language : d.template_language,
      sla_urgent_minutes: intIn(r.sla_urgent_minutes, 1, 1440, d.sla_urgent_minutes),
      sla_high_minutes: intIn(r.sla_high_minutes, 1, 1440, d.sla_high_minutes),
      sla_normal_minutes: intIn(r.sla_normal_minutes, 1, 10080, d.sla_normal_minutes),
      max_escalations: intIn(r.max_escalations, 0, 10, d.max_escalations),
      whatsapp_enabled: r.whatsapp_enabled !== false,
    };
  } catch {
    return { ...DEFAULT_ALERT_SETTINGS };
  }
}

// ---------------------------------------------------------------------------
// SLA (pure)

export function slaMinutes(s: AlertSettings, priority: unknown): number {
  const p = asPriority(priority);
  return p === "urgent" ? s.sla_urgent_minutes : p === "high" ? s.sla_high_minutes : s.sla_normal_minutes;
}

export interface SlaCase {
  status: string;
  priority: string;
  created_at: string;
  last_alert_at?: string | null;
  alert_level?: number | null;
}

/**
 * When the case should be escalated next (epoch ms), or null when it no longer
 * escalates (taken/closed, or max_escalations reached). One SLA period after
 * the later of creation and the last alert — so a fresh alert (handoff,
 * previous escalation) is never followed by another one before a full period.
 * Mirrored by public.staff_alerts_have_work().
 */
export function nextEscalationAt(c: SlaCase, s: AlertSettings): number | null {
  if (!(WAITING_STATUSES as readonly string[]).includes(c.status)) return null;
  if ((c.alert_level ?? 0) >= s.max_escalations) return null;
  const created = Date.parse(c.created_at);
  const last = c.last_alert_at ? Date.parse(c.last_alert_at) : Number.NEGATIVE_INFINITY;
  return Math.max(created, last) + slaMinutes(s, c.priority) * MINUTE;
}

export function minutesWaiting(createdAt: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(createdAt)) / MINUTE));
}

/** "8 min", "2 h 5 min", "1 d 3 h". */
export function formatWait(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return minutes % 60 ? `${h} h ${minutes % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

/** WhatsApp goes out for urgent/high cases when opened, every handoff and every escalation. */
export function needsWhatsApp(kind: AlertKind, priority: unknown): boolean {
  if (kind !== "opened") return true;
  const p = asPriority(priority);
  return p === "urgent" || p === "high";
}

// ---------------------------------------------------------------------------
// Texts (panel notification + template variables). Only the short summary
// travels: no patient name, phone or other clinical data.

/** One line, no tabs/newlines (WhatsApp rejects them in variables), ≤ max chars. */
export function shortSummary(text: string, max = SUMMARY_MAX): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "Sin resumen";
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

export interface AlertCaseInfo {
  request_type: string;
  priority: string;
  summary: string;
}

export function alertTitle(kind: AlertKind, c: AlertCaseInfo, extra: { minutes?: number } = {}): string {
  const urgent = asPriority(c.priority) === "urgent";
  const type = typeLabel(c.request_type).toLowerCase();
  switch (kind) {
    case "opened":
      return urgent ? "Urgencia: paciente necesita atención" : `Nuevo caso: ${type}`;
    case "handoff":
      return urgent ? "Urgencia: paciente necesita atención" : `Paciente pide atención del equipo: ${type}`;
    case "overdue":
      return `${urgent ? "Urgencia" : "Caso"} sin tomar: ${formatWait(extra.minutes ?? 0)} esperando`;
  }
}

export function alertBody(kind: AlertKind, c: AlertCaseInfo, extra: { level?: number; max?: number } = {}): string {
  const head = [typeLabel(c.request_type), `prioridad ${PRIORITY_LABEL_ES[asPriority(c.priority)].toLowerCase()}`];
  if (kind === "overdue" && extra.level) head.push(`aviso ${extra.level} de ${extra.max ?? extra.level}`);
  return `${head.join(" · ")}\n${shortSummary(c.summary)}`;
}

/** Template body variables in order: tipo, prioridad, resumen corto, minutos esperando. */
export function alertTemplateParams(c: AlertCaseInfo, minutes: number): string[] {
  return [typeLabel(c.request_type), PRIORITY_LABEL_ES[asPriority(c.priority)], shortSummary(c.summary), String(minutes)];
}

export function buildAlertRequest(o: {
  to: string;
  templateName: string;
  language: string;
  params: string[];
  /** Suffix of the "Ver caso" URL button ({{1}} → case id); null = template without the button. */
  buttonParam: string | null;
}): Record<string, unknown> {
  const components: Record<string, unknown>[] = [
    { type: "body", parameters: o.params.map((text) => ({ type: "text", text })) },
  ];
  if (o.buttonParam) {
    components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: o.buttonParam }] });
  }
  return {
    to: o.to,
    type: "template",
    template: { name: o.templateName, language: { policy: "deterministic", code: o.language }, components },
  };
}

// ---------------------------------------------------------------------------
// Template check (Spanish, for the panel). A missing/unapproved template must
// end as a failed delivery with a clear reason, never as silence.

export interface TemplateCheck {
  problems: string[];
  /** Language to send with (the template's own when found). */
  language: string;
  /** Whether the template has the variable "Ver caso" URL button. Unknown catalog → assume yes. */
  hasUrlButton: boolean;
}

export function checkAlertTemplate(t: CatalogTemplate | undefined, s: AlertSettings): TemplateCheck {
  if (!t) {
    return {
      problems: [`La plantilla "${s.template_name}" no existe en WHAAPY: créala y espera la aprobación de Meta.`],
      language: s.template_language,
      hasUrlButton: true,
    };
  }
  const problems: string[] = [];
  if (t.status.toUpperCase() !== "APPROVED") {
    problems.push(`La plantilla "${t.name}" no está aprobada por Meta (estado: ${t.status || "desconocido"}).`);
  }
  if (t.body_variables !== ALERT_TEMPLATE_VARIABLES) {
    problems.push(`La plantilla "${t.name}" tiene ${t.body_variables} variable(s); se necesitan ${ALERT_TEMPLATE_VARIABLES} (tipo, prioridad, resumen y minutos).`);
  }
  const urlIndex = t.buttons.findIndex((b) => b.type === "URL" && /\{\{\s*1\s*\}\}/.test(b.url ?? ""));
  if (urlIndex > 0) problems.push("El botón “Ver caso” debe ser el primer botón de la plantilla.");
  return { problems, language: t.language || s.template_language, hasUrlButton: urlIndex >= 0 };
}

/** Catalog lookup; null when WHAAPY can't list templates (then the send itself decides). */
async function lookupTemplate(whaapy: WhaapyClient, s: AlertSettings): Promise<TemplateCheck | null> {
  const r = await whaapy.listTemplates();
  if (!r.ok) return null;
  const all = r.data.map(normalizeTemplate);
  const t = all.find((x) => x.name === s.template_name && x.language === s.template_language) ??
    all.find((x) => x.name === s.template_name);
  return checkAlertTemplate(t, s);
}

// ---------------------------------------------------------------------------
// Recipients

export interface AlertRecipient {
  id: string;
  name: string;
  phone: string;
  receives: string; // 'all' | 'urgent_only'
  is_active: boolean;
}

/** Active numbers that want this priority, one per phone. */
export function selectRecipients(rows: AlertRecipient[], priority: unknown): AlertRecipient[] {
  const urgent = asPriority(priority) === "urgent";
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (!r.is_active) return false;
    if (r.receives !== "all" && !(r.receives === "urgent_only" && urgent)) return false;
    if (seen.has(r.phone)) return false;
    seen.add(r.phone);
    return true;
  });
}

/** Canonical phone for an on-call number, or null if it isn't a valid number. */
export function normalizeRecipientPhone(raw: string): string | null {
  const canonical = normalizeMxPhone(raw ?? "");
  return isValidNormalizedPhone(canonical) ? canonical : null;
}

// ---------------------------------------------------------------------------
// Case history

async function logCaseEvent(
  supabase: SupabaseClient,
  caseId: string,
  event_type: string,
  detail: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("case_events").insert({
    case_id: caseId,
    event_type,
    actor: "system",
    actor_user_id: null,
    detail,
    created_at: new Date().toISOString(),
  });
  if (error) console.error("[staff-alerts] case_events insert failed", event_type, error.message);
}

// ---------------------------------------------------------------------------
// Raise an alert (panel notification now, WhatsApp queued for the worker)

export interface AlertCase extends AlertCaseInfo {
  id: string;
  status: string;
  created_at: string;
}

export type RaiseResult =
  | { raised: true; alertId: string; notificationId: string | null; whatsapp: "pending" | "skipped" }
  | { raised: false; reason: "duplicate" | "error" };

export async function raiseCaseAlert(
  supabase: SupabaseClient,
  c: AlertCase,
  kind: AlertKind,
  opts: { level?: number; now?: number; settings?: AlertSettings; touchCase?: boolean } = {},
): Promise<RaiseResult> {
  try {
    const now = opts.now ?? Date.now();
    const level = kind === "overdue" ? opts.level ?? 1 : 0;
    const settings = opts.settings ?? (await loadAlertSettings(supabase));
    const priority = asPriority(c.priority);
    const wanted = needsWhatsApp(kind, priority);
    const whatsapp = wanted && settings.whatsapp_enabled ? "pending" : "skipped";

    // Idempotency gate: replays and concurrent calls find the key taken.
    const { data: gate, error } = await supabase
      .from("case_alerts")
      .upsert(
        {
          dedupe_key: `${c.id}:${kind}:${level}`,
          case_id: c.id,
          kind,
          level,
          priority,
          whatsapp_status: whatsapp,
          whatsapp_detail: whatsapp === "pending" ? null : wanted ? "whatsapp_disabled" : "not_required",
          next_attempt_at: iso(now),
          created_at: iso(now),
        },
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      )
      .select("id");
    if (error) {
      console.error("[staff-alerts] case_alerts insert failed", kind, error.message);
      return { raised: false, reason: "error" };
    }
    const rows = (gate ?? []) as { id: string }[];
    if (rows.length === 0) return { raised: false, reason: "duplicate" };
    const alertId = rows[0].id;

    const minutes = minutesWaiting(c.created_at, now);
    const { data: notif, error: nErr } = await supabase
      .from("notifications")
      .insert({
        recipient_role: "admin",
        type: NOTIFICATION_TYPE[kind],
        title: alertTitle(kind, c, { minutes }),
        body: alertBody(kind, c, { level, max: settings.max_escalations }),
        case_id: c.id,
        is_read: false,
      })
      .select("id")
      .single();
    if (nErr) console.error("[staff-alerts] notification insert failed", kind, nErr.message);
    const notificationId = nErr ? null : ((notif as { id: string } | null)?.id ?? null);
    if (notificationId) await supabase.from("case_alerts").update({ notification_id: notificationId }).eq("id", alertId);

    // The handoff alert supersedes an "opened" WhatsApp still waiting in the
    // queue (open_case + request_handoff usually come seconds apart).
    if (kind === "handoff" && whatsapp === "pending") {
      await supabase
        .from("case_alerts")
        .update({ whatsapp_status: "skipped", whatsapp_detail: "superseded_by_handoff" })
        .eq("case_id", c.id)
        .eq("kind", "opened")
        .eq("whatsapp_status", "pending");
    }
    if (opts.touchCase !== false) {
      await supabase.from("patient_cases").update({ last_alert_at: iso(now) }).eq("id", c.id);
    }
    await logCaseEvent(supabase, c.id, "staff_alert_sent", {
      channel: "panel",
      kind,
      level,
      notification_id: notificationId,
      text: notificationId
        ? `Aviso en el panel: ${alertTitle(kind, c, { minutes })}`
        : "No se pudo crear el aviso en el panel",
    });
    return { raised: true, alertId, notificationId, whatsapp };
  } catch (e) {
    console.error("[staff-alerts] raiseCaseAlert failed", kind, e);
    return { raised: false, reason: "error" };
  }
}

// ---------------------------------------------------------------------------
// Escalation (worker)

interface CaseRowForAlerts extends AlertCase, SlaCase {}

export async function escalateOverdueCases(
  supabase: SupabaseClient,
  settings: AlertSettings,
  now: number,
): Promise<number> {
  if (settings.max_escalations <= 0) return 0;
  const { data, error } = await supabase
    .from("patient_cases")
    .select("id, request_type, priority, status, summary, created_at, last_alert_at, alert_level")
    .in("status", [...WAITING_STATUSES])
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) {
    console.error("[staff-alerts] waiting cases query failed", error.message);
    return 0;
  }
  let escalated = 0;
  for (const c of (data ?? []) as CaseRowForAlerts[]) {
    const due = nextEscalationAt(c, settings);
    if (due === null || due > now) continue;
    const previous = c.alert_level ?? 0;
    const level = previous + 1;
    // Claim the level: a concurrent run (or a staff member taking the case)
    // makes this update match nothing, and nothing is sent twice.
    const { data: won } = await supabase
      .from("patient_cases")
      .update({ alert_level: level, last_alert_at: iso(now) })
      .eq("id", c.id)
      .eq("alert_level", previous)
      .in("status", [...WAITING_STATUSES])
      .select("id");
    if (!won || (won as unknown[]).length === 0) continue;
    const minutes = minutesWaiting(c.created_at, now);
    await logCaseEvent(supabase, c.id, "escalated", {
      level,
      max: settings.max_escalations,
      minutes_waiting: minutes,
      sla_minutes: slaMinutes(settings, c.priority),
      text: `Nadie lo ha tomado en ${formatWait(minutes)} (SLA ${slaMinutes(settings, c.priority)} min). Aviso ${level} de ${settings.max_escalations}.`,
    });
    const r = await raiseCaseAlert(supabase, c, "overdue", { level, now, settings, touchCase: false });
    if (r.raised) escalated++;
  }
  return escalated;
}

// ---------------------------------------------------------------------------
// WhatsApp delivery (worker)

export interface CaseAlertRow {
  id: string;
  case_id: string | null;
  kind: AlertKind;
  level: number;
  priority: string;
  attempts: number;
}

export type AlertOutcome = "sent" | "partial" | "failed" | "skipped" | "retry" | "uncertain";

/** WHAAPY answered 429/503: nothing was processed, safe to retry. */
const retryable = (status: number) => status === 429 || status === 503;

async function finishAlert(
  supabase: SupabaseClient,
  row: CaseAlertRow,
  outcome: AlertOutcome,
  detail: string | null,
  now: number,
): Promise<AlertOutcome> {
  if (outcome === "retry") {
    if (row.attempts >= MAX_ALERT_ATTEMPTS) {
      outcome = "failed";
    } else {
      const minutes = BACKOFF_MINUTES[Math.min(Math.max(row.attempts - 1, 0), BACKOFF_MINUTES.length - 1)];
      await supabase.from("case_alerts").update({
        whatsapp_status: "pending",
        whatsapp_detail: detail,
        locked_until: null,
        next_attempt_at: iso(now + minutes * MINUTE),
      }).eq("id", row.id);
      return "retry";
    }
  }
  // Summary of the alert; the per-number truth (and receipts) is in message_deliveries.
  await supabase.from("case_alerts").update({
    whatsapp_status: outcome,
    whatsapp_detail: detail,
    locked_until: null,
    processed_at: iso(now),
  }).eq("id", row.id);
  return outcome;
}

interface Tally {
  accepted: number;
  failed: number;
  uncertain: number;
  retry: number;
  /** Sends attempted / failures recorded in THIS run (0 = a retaken alert with nothing new). */
  fresh: number;
  errors: string[];
}

/** Sends (or records why it can't send) the template to one number. Never sends a step twice. */
async function deliverToRecipient(
  supabase: SupabaseClient,
  whaapy: WhaapyClient,
  alert: CaseAlertRow,
  recipient: AlertRecipient,
  request: Record<string, unknown>,
  templateName: string,
  language: string,
  blocked: { code: string; message: string } | null,
  tally: Tally,
): Promise<void> {
  const { data: existing } = await supabase
    .from("message_deliveries")
    .select("id, status, error_code, attempts")
    .eq("case_alert_id", alert.id)
    .eq("staff_recipient_id", recipient.id)
    .maybeSingle();
  const prev = existing as { id: string; status: string; error_code: string | null; attempts: number } | null;
  if (prev && DONE.has(prev.status)) {
    tally.accepted++;
    return;
  }
  if (prev && (prev.status === "uncertain" || prev.status === "sending")) {
    if (prev.status === "sending") await supabase.from("message_deliveries").update({ status: "uncertain" }).eq("id", prev.id);
    tally.uncertain++;
    return;
  }
  if (prev && prev.status === "failed" && !prev.error_code?.startsWith("retry:")) {
    tally.failed++;
    return;
  }

  const base = {
    request,
    attempts: (prev?.attempts ?? 0) + 1,
    error_code: blocked?.code ?? null,
    error_message: blocked?.message ?? null,
    status: blocked ? "failed" : "sending",
  };
  let deliveryId = prev?.id ?? null;
  if (deliveryId) {
    await supabase.from("message_deliveries").update(base).eq("id", deliveryId);
  } else {
    const { data: ins, error } = await supabase
      .from("message_deliveries")
      .insert({
        case_id: alert.case_id,
        case_alert_id: alert.id,
        staff_recipient_id: recipient.id,
        to_phone: recipient.phone,
        template_name: templateName,
        language,
        source: "staff_alert",
        ...base,
      })
      .select("id")
      .single();
    if (error || !ins) {
      tally.retry++;
      tally.errors.push("delivery_insert_failed");
      return;
    }
    deliveryId = (ins as { id: string }).id;
  }
  tally.fresh++;
  if (blocked) {
    tally.failed++;
    tally.errors.push(blocked.message);
    return;
  }

  const r = await whaapy.sendMessage(request);
  if (r.ok) {
    await supabase.from("message_deliveries").update({
      status: "accepted",
      whaapy_message_id: r.data.message_id,
      wamid: r.data.wamid,
    }).eq("id", deliveryId);
    tally.accepted++;
    return;
  }
  if (r.status === 0 || (r.status >= 500 && !retryable(r.status))) {
    // Timeout / dropped connection / unexpected 5xx: it may have been sent.
    await supabase.from("message_deliveries").update({ status: "uncertain", error_code: String(r.status), error_message: r.error }).eq("id", deliveryId);
    tally.uncertain++;
    tally.errors.push(r.error);
    return;
  }
  if (retryable(r.status)) {
    await supabase.from("message_deliveries").update({ status: "failed", error_code: `retry:${r.status}`, error_message: r.error }).eq("id", deliveryId);
    tally.retry++;
    tally.errors.push(`WHAAPY ${r.status}`);
    return;
  }
  // 4xx: template/parameters/number rejected — retrying won't help.
  await supabase.from("message_deliveries").update({ status: "failed", error_code: String(r.status), error_message: r.error }).eq("id", deliveryId);
  tally.failed++;
  tally.errors.push(`WHAAPY ${r.status}: ${r.error}`);
}

export interface ProcessContext {
  settings: AlertSettings;
  now: number;
  /** Template check cached for the whole worker run (undefined = not looked up yet). */
  template?: TemplateCheck | null;
}

export async function processCaseAlert(
  supabase: SupabaseClient,
  whaapy: WhaapyClient,
  alert: CaseAlertRow,
  ctx: ProcessContext,
): Promise<AlertOutcome> {
  const { settings, now } = ctx;
  if (!alert.case_id) return finishAlert(supabase, alert, "skipped", "no_case", now);
  const { data: caseData } = await supabase
    .from("patient_cases")
    .select("id, request_type, priority, status, summary, created_at")
    .eq("id", alert.case_id)
    .maybeSingle();
  const c = caseData as AlertCase | null;
  if (!c) return finishAlert(supabase, alert, "skipped", "case_not_found", now);
  // Someone took it (or it closed) since the alert was raised: no WhatsApp.
  if (!(WAITING_STATUSES as readonly string[]).includes(c.status)) {
    return finishAlert(supabase, alert, "skipped", `case_${c.status}`, now);
  }
  if (!settings.whatsapp_enabled) return finishAlert(supabase, alert, "skipped", "whatsapp_disabled", now);

  const { data: recipientRows, error: rErr } = await supabase
    .from("staff_alert_recipients")
    .select("id, name, phone, receives, is_active")
    .eq("is_active", true);
  if (rErr) return finishAlert(supabase, alert, "retry", "recipients_unavailable", now);
  // The case's current priority (it may have been raised since the alert).
  const priority = asPriority(c.priority);
  const recipients = selectRecipients((recipientRows ?? []) as AlertRecipient[], priority);
  if (recipients.length === 0) {
    await logCaseEvent(supabase, c.id, "staff_alert_skipped", {
      channel: "whatsapp",
      kind: alert.kind,
      level: alert.level,
      text: "Sin números de guardia activos para esta prioridad: no se envió WhatsApp.",
    });
    return finishAlert(supabase, alert, "skipped", "no_recipients", now);
  }

  let blocked: { code: string; message: string } | null = null;
  let template: TemplateCheck | null = null;
  if (!whaapy.configured) {
    blocked = { code: "whaapy_not_configured", message: "WHAAPY no está configurado (falta WHAAPY_API_KEY)." };
  } else {
    if (ctx.template === undefined) ctx.template = await lookupTemplate(whaapy, settings);
    template = ctx.template;
    if (template?.problems.length) blocked = { code: "template_invalid", message: template.problems.join(" ") };
  }
  const language = template?.language ?? settings.template_language;
  const params = alertTemplateParams(c, minutesWaiting(c.created_at, now));
  const buttonParam = template && !template.hasUrlButton ? null : c.id;

  const tally: Tally = { accepted: 0, failed: 0, uncertain: 0, retry: 0, fresh: 0, errors: [] };
  for (const r of recipients) {
    const request = buildAlertRequest({ to: r.phone, templateName: settings.template_name, language, params, buttonParam });
    await deliverToRecipient(supabase, whaapy, alert, r, request, settings.template_name, language, blocked, tally);
  }

  const total = recipients.length;
  const detail = tally.errors.length ? [...new Set(tally.errors)].join(" | ").slice(0, 500) : null;
  // 429/503 for some number: try again later (numbers already accepted are
  // not re-sent). Once out of attempts those numbers count as failed.
  if (tally.retry > 0 && alert.attempts < MAX_ALERT_ATTEMPTS) {
    return finishAlert(supabase, alert, "retry", detail, now);
  }
  tally.failed += tally.retry;
  const outcome: AlertOutcome = tally.accepted === total
    ? "sent"
    : tally.accepted > 0
    ? "partial"
    : tally.uncertain > 0
    ? "uncertain"
    : "failed";
  // A retaken alert (expired lease) with nothing new is already in the history.
  if (tally.fresh > 0 && tally.accepted > 0) {
    await logCaseEvent(supabase, c.id, "staff_alert_sent", {
      channel: "whatsapp",
      kind: alert.kind,
      level: alert.level,
      sent: tally.accepted,
      total,
      text: tally.accepted === total
        ? `WhatsApp enviado a ${total === 1 ? "1 número" : `${total} números`} de guardia.`
        : `WhatsApp enviado a ${tally.accepted} de ${total} números de guardia.${detail ? ` Fallas: ${detail}` : ""}`,
    });
  } else if (tally.fresh > 0) {
    await logCaseEvent(supabase, c.id, "staff_alert_failed", {
      channel: "whatsapp",
      kind: alert.kind,
      level: alert.level,
      total,
      text: outcome === "uncertain"
        ? "No se confirmó el envío del WhatsApp al equipo (respuesta perdida de WHAAPY)."
        : `No se pudo avisar por WhatsApp: ${detail ?? "error desconocido"}`,
    });
  }
  return finishAlert(supabase, alert, outcome, detail, now);
}

// ---------------------------------------------------------------------------
// Worker entry point

export const ALERT_BATCH = 20;
export const ALERT_LEASE_SECONDS = 120;

/** One worker pass: escalate overdue cases, then send queued WhatsApp alerts. Counts only what happened. */
export async function runStaffAlerts(
  supabase: SupabaseClient,
  whaapy: WhaapyClient,
  opts: { now?: () => number; deadline?: number } = {},
): Promise<Record<string, number>> {
  const clock = opts.now ?? Date.now;
  const deadline = opts.deadline ?? Number.POSITIVE_INFINITY;
  const out: Record<string, number> = {};
  const settings = await loadAlertSettings(supabase);

  const escalated = await escalateOverdueCases(supabase, settings, clock());
  if (escalated) out.escalated = escalated;

  const { data: claimed, error } = await supabase.rpc("claim_case_alerts", { p_limit: ALERT_BATCH, p_lease_seconds: ALERT_LEASE_SECONDS });
  if (error) {
    console.error("[staff-alerts] claim failed", error.message);
    return out;
  }
  const ctx: ProcessContext = { settings, now: clock() };
  for (const row of (claimed ?? []) as CaseAlertRow[]) {
    if (clock() > deadline) break; // lease expires → next run retakes it
    ctx.now = clock();
    try {
      const o = await processCaseAlert(supabase, whaapy, row, ctx);
      out[`whatsapp_${o}`] = (out[`whatsapp_${o}`] ?? 0) + 1;
    } catch (e) {
      console.error("[staff-alerts] alert failed", row.id, e);
      out.whatsapp_error = (out.whatsapp_error ?? 0) + 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Test alert (Configuración → Alertas, admin only)

export type TestAlertResult =
  | { ok: true; delivery_id: string | null; status: "accepted" | "uncertain"; message_es: string }
  | { ok: false; code: string; message_es: string; delivery_id?: string | null };

export async function sendTestAlert(
  supabase: SupabaseClient,
  whaapy: WhaapyClient,
  input: { recipientId?: string | null; phone?: string | null; userId: string },
): Promise<TestAlertResult> {
  let phone: string | null = null;
  let recipientId: string | null = null;
  if (input.recipientId) {
    const { data } = await supabase.from("staff_alert_recipients").select("id, phone").eq("id", input.recipientId).maybeSingle();
    const r = data as { id: string; phone: string } | null;
    if (!r) return { ok: false, code: "not_found", message_es: "No encontré ese número de guardia." };
    phone = r.phone;
    recipientId = r.id;
  } else if (input.phone) {
    phone = normalizeRecipientPhone(input.phone);
  }
  if (!phone) return { ok: false, code: "invalid_phone", message_es: "Número inválido. Usa 10 dígitos o formato +52…" };
  if (!whaapy.configured) return { ok: false, code: "whaapy_unavailable", message_es: "WHAAPY no está configurado (falta WHAAPY_API_KEY)." };

  const settings = await loadAlertSettings(supabase);
  const template = await lookupTemplate(whaapy, settings);
  const language = template?.language ?? settings.template_language;
  const sample: AlertCaseInfo = {
    request_type: "other",
    priority: "normal",
    summary: "Mensaje de prueba de las alertas de FindMed. No requiere ninguna acción.",
  };
  const params = ["Prueba", PRIORITY_LABEL_ES.normal, shortSummary(sample.summary), "0"];
  const request = buildAlertRequest({
    to: phone,
    templateName: settings.template_name,
    language,
    params,
    buttonParam: template && !template.hasUrlButton ? null : "prueba",
  });
  const blocked = template?.problems.length ? template.problems.join(" ") : null;

  const { data: ins } = await supabase
    .from("message_deliveries")
    .insert({
      to_phone: phone,
      template_name: settings.template_name,
      language,
      request,
      status: blocked ? "failed" : "sending",
      error_code: blocked ? "template_invalid" : null,
      error_message: blocked,
      attempts: 1,
      source: "staff_alert",
      staff_recipient_id: recipientId,
      sent_by: input.userId,
    })
    .select("id")
    .single();
  const deliveryId = (ins as { id: string } | null)?.id ?? null;
  if (blocked) return { ok: false, code: "template_invalid", message_es: blocked, delivery_id: deliveryId };

  const r = await whaapy.sendMessage(request);
  const patch = r.ok
    ? { status: "accepted", whaapy_message_id: r.data.message_id, wamid: r.data.wamid }
    : { status: r.status === 0 ? "uncertain" : "failed", error_code: String(r.status), error_message: r.error };
  if (deliveryId) await supabase.from("message_deliveries").update(patch).eq("id", deliveryId);
  if (r.ok) {
    return { ok: true, delivery_id: deliveryId, status: "accepted", message_es: "WHAAPY aceptó el mensaje de prueba. Debe llegar en unos segundos." };
  }
  if (r.status === 0) {
    return { ok: true, delivery_id: deliveryId, status: "uncertain", message_es: "WHAAPY no respondió a tiempo: el mensaje pudo haber salido. Revisa el teléfono antes de reintentar." };
  }
  return { ok: false, code: "send_failed", message_es: `WHAAPY rechazó el envío (${r.status}): ${r.error}`, delivery_id: deliveryId };
}
