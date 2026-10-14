// Staff alerts for patient cases (client complaint #1): panel notification on
// open_case / request_handoff, SLA escalation, WhatsApp to on-call numbers,
// idempotency, admin actions and the migration (replayed on PGlite).
//
//   npm run test:edge

import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.3.15";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { openCase, requestHandoff } from "../functions/_shared/cases.ts";
import {
  type AlertRecipient,
  alertTemplateParams,
  checkAlertTemplate,
  DEFAULT_ALERT_SETTINGS,
  escalateOverdueCases,
  formatWait,
  needsWhatsApp,
  nextEscalationAt,
  raiseCaseAlert,
  runStaffAlerts,
  selectRecipients,
  shortSummary,
  slaMinutes,
} from "../functions/_shared/staff-alerts.ts";
import { normalizeTemplate } from "../functions/_shared/template-catalog.ts";
import type { WhaapyClient, WhaapyResult, WhaapySent } from "../functions/_shared/whaapy-client.ts";
import { handleCaseActions } from "../functions/case-actions/handler.ts";
import { parseAlertSettings } from "../functions/case-actions/alerts.ts";
import { handleWorker } from "../functions/findmed-events-worker/handler.ts";
import { FakeDb } from "./fake-supabase.ts";

const MIN = 60_000;
const T0 = Date.parse("2026-10-14T15:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const sb = (db: FakeDb) => db as unknown as SupabaseClient;
const PHONE = "+525512345678";
const S = DEFAULT_ALERT_SETTINGS;

const ok = <T>(data: T): WhaapyResult<T> => ({ ok: true, status: 200, data });

const TEMPLATE_RAW = {
  name: "alerta_caso_findmed",
  category: "UTILITY",
  language: "es_MX",
  status: "APPROVED",
  components: [
    { type: "BODY", text: "Alerta FindMed: caso de {{1}} con prioridad {{2}}. Resumen: {{3}}. Esperando {{4}} min. Ábrelo en el panel." },
    { type: "BUTTONS", buttons: [{ type: "URL", text: "Ver caso", url: "https://app.findmed.com.mx/admin/casos?caso={{1}}" }] },
  ],
};

/** WHAAPY fake: sendMessage answers from a script (default accepted), records bodies. */
function fakeWhaapy(opts: { script?: WhaapyResult<WhaapySent>[]; templates?: Record<string, unknown>[] | null; configured?: boolean } = {}) {
  const sent: Record<string, unknown>[] = [];
  const script = [...(opts.script ?? [])];
  let n = 0;
  const client: WhaapyClient = {
    configured: opts.configured ?? true,
    conversationByPhone: () => Promise.resolve(ok({ id: "conv-1", contact_id: "contact-1", ai_enabled: true })),
    setAiEnabled: () => Promise.resolve(ok({})),
    listAgents: () => Promise.resolve(ok([])),
    updateContact: () => Promise.resolve(ok({})),
    sendMessage: (body) => {
      sent.push(body);
      n++;
      return Promise.resolve(script.shift() ?? ok({ message_id: `msg-${n}`, wamid: `wamid-${n}` }));
    },
    listTemplates: () =>
      Promise.resolve(opts.templates === null ? { ok: false as const, status: 500, error: "down" } : ok(opts.templates ?? [TEMPLATE_RAW])),
    syncTemplates: () => Promise.resolve(ok({})),
  };
  return { client, sent };
}

function recipients(): AlertRecipient[] {
  return [
    { id: "r1", name: "Guardia 1", phone: "+525511111111", receives: "all", is_active: true },
    { id: "r2", name: "Guardia 2", phone: "+525522222222", receives: "all", is_active: true },
    { id: "r3", name: "Jefa", phone: "+525533333333", receives: "urgent_only", is_active: true },
    { id: "r4", name: "De baja", phone: "+525544444444", receives: "all", is_active: false },
  ];
}

function waitingCase(over: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    request_type: "studies",
    subject_phone: PHONE,
    priority: "urgent",
    status: "awaiting_assignment",
    summary: "Paciente busca laboratorio para biometría hemática en Querétaro",
    created_at: iso(T0),
    last_alert_at: iso(T0),
    alert_level: 0,
    ...over,
  };
}

function newDb(seed: Record<string, Record<string, unknown>[]> = {}) {
  const db = new FakeDb({
    patients: [{ id: "p1", phone: PHONE, full_name: "Paciente" }],
    patient_cases: [],
    case_events: [],
    case_alerts: [],
    notifications: [],
    message_deliveries: [],
    staff_alert_recipients: recipients().map((r) => ({ ...r })),
    staff_alert_settings: [{ id: true, ...S }],
    ...seed,
  });
  // claim_case_alerts: pending (and due) rows → processing, attempts + 1.
  db.rpcHandlers.claim_case_alerts = () => {
    const due = db.rows("case_alerts").filter((a) => a.whatsapp_status === "pending");
    for (const a of due) {
      a.whatsapp_status = "processing";
      a.attempts = Number(a.attempts ?? 0) + 1;
    }
    return due.map((a) => ({ ...a }));
  };
  return db;
}

const caseEvents = (db: FakeDb) => db.rows("case_events").map((e) => e.event_type);

// ---------------------------------------------------------------------------
// SLA (pure)

Deno.test("SLA: minutes per priority; next escalation one period after the later of creation and last alert", () => {
  assertEquals([slaMinutes(S, "urgent"), slaMinutes(S, "high"), slaMinutes(S, "normal"), slaMinutes(S, "rara")], [10, 30, 120, 120]);
  const base = { status: "awaiting_assignment", created_at: iso(T0), last_alert_at: null, alert_level: 0 };
  assertEquals(nextEscalationAt({ ...base, priority: "urgent" }, S), T0 + 10 * MIN);
  assertEquals(nextEscalationAt({ ...base, priority: "high" }, S), T0 + 30 * MIN);
  assertEquals(nextEscalationAt({ ...base, priority: "normal", status: "open" }, S), T0 + 120 * MIN);
  // A later alert (handoff, previous escalation) pushes the next one a full period.
  assertEquals(nextEscalationAt({ ...base, priority: "urgent", last_alert_at: iso(T0 + 45 * MIN), alert_level: 1 }, S), T0 + 55 * MIN);
  // Taken / closed / out of escalations → never.
  assertEquals(nextEscalationAt({ ...base, priority: "urgent", status: "assigned" }, S), null);
  assertEquals(nextEscalationAt({ ...base, priority: "urgent", status: "resolved" }, S), null);
  assertEquals(nextEscalationAt({ ...base, priority: "urgent", alert_level: 3 }, S), null);
  assertEquals(nextEscalationAt({ ...base, priority: "urgent" }, { ...S, max_escalations: 0 }), null);
  // Configurable.
  assertEquals(nextEscalationAt({ ...base, priority: "urgent" }, { ...S, sla_urgent_minutes: 5 }), T0 + 5 * MIN);
});

Deno.test("texts: wait format, one-line summary ≤120, WhatsApp only when it matters", () => {
  assertEquals([formatWait(8), formatWait(60), formatWait(125), formatWait(1200), formatWait(1440)], ["8 min", "1 h", "2 h 5 min", "20 h", "1 d"]);
  assertEquals(shortSummary("  Necesita\n\nhospital\t en  QRO "), "Necesita hospital en QRO");
  const long = shortSummary("x".repeat(300));
  assertEquals(long.length, 120);
  assert(long.endsWith("…"));
  assertEquals(shortSummary("   "), "Sin resumen");
  assertEquals([needsWhatsApp("opened", "normal"), needsWhatsApp("opened", "high"), needsWhatsApp("opened", "urgent")], [false, true, true]);
  assertEquals([needsWhatsApp("handoff", "normal"), needsWhatsApp("overdue", "normal")], [true, true]);
  assertEquals(alertTemplateParams({ request_type: "studies", priority: "high", summary: "Lab\nen QRO" }, 42), ["Estudios", "Alta", "Lab en QRO", "42"]);
});

Deno.test("recipients: active only, urgent-only numbers just for urgent cases, one message per phone", () => {
  const rows = [...recipients(), { id: "r5", name: "Duplicado", phone: "+525511111111", receives: "all", is_active: true }];
  assertEquals(selectRecipients(rows, "urgent").map((r) => r.id), ["r1", "r2", "r3"]);
  assertEquals(selectRecipients(rows, "high").map((r) => r.id), ["r1", "r2"]);
  assertEquals(selectRecipients(rows, "normal").map((r) => r.id), ["r1", "r2"]);
  assertEquals(selectRecipients([], "urgent"), []);
});

Deno.test("template check: missing, not approved, wrong variables, no button", () => {
  const t = normalizeTemplate(TEMPLATE_RAW);
  assertEquals(checkAlertTemplate(t, S), { problems: [], language: "es_MX", hasUrlButton: true });
  assert(checkAlertTemplate(undefined, S).problems[0].includes("no existe"));
  assert(checkAlertTemplate({ ...t, status: "PENDING" }, S).problems[0].includes("no está aprobada"));
  assert(checkAlertTemplate({ ...t, body_variables: 3 }, S).problems[0].includes("se necesitan 4"));
  assertEquals(checkAlertTemplate({ ...t, buttons: [] }, S).hasUrlButton, false);
});

// ---------------------------------------------------------------------------
// Panel notification (open_case / request_handoff)

Deno.test("open_case: the team gets a panel notification at once; WhatsApp queued only for urgent/high", async () => {
  const db = newDb();
  const r = await openCase(sb(db), { phone: "5512345678", requestType: "studies", summary: "Laboratorio en QRO" });
  assert(r.ok);
  const [n] = db.rows("notifications");
  assertEquals([n.type, n.recipient_role, n.case_id, n.title], ["case_opened", "admin", r.case_id, "Nuevo caso: estudios"]);
  assertEquals(n.body, "Estudios · prioridad normal\nLaboratorio en QRO");
  const [a] = db.rows("case_alerts");
  assertEquals([a.kind, a.level, a.whatsapp_status, a.whatsapp_detail, a.notification_id], ["opened", 0, "skipped", "not_required", n.id]);
  assertEquals(caseEvents(db), ["created", "staff_alert_sent"]);
  assert(db.rows("patient_cases")[0].last_alert_at);

  // Repeat of the same request → deduplicated case, no second alert.
  const again = await openCase(sb(db), { phone: PHONE, requestType: "studies", summary: "otra vez" });
  assert(again.ok && again.deduplicated);
  assertEquals(db.rows("notifications").length, 1);

  // Urgent case: urgent title and WhatsApp queued for the worker.
  const urgent = await openCase(sb(db), { phone: PHONE, requestType: "urgency", summary: "Dolor de pecho", priority: "urgent" });
  assert(urgent.ok);
  const un = db.rows("notifications").find((x) => x.case_id === urgent.case_id)!;
  assertEquals(un.title, "Urgencia: paciente necesita atención");
  assertEquals(db.rows("case_alerts").find((x) => x.case_id === urgent.case_id)!.whatsapp_status, "pending");
});

Deno.test("request_handoff: one handoff alert per case (retries and races don't duplicate); it supersedes the queued 'opened' WhatsApp", async () => {
  const db = newDb();
  const opened = await openCase(sb(db), { phone: PHONE, requestType: "hospital", summary: "Hospital en QRO", priority: "high" });
  assert(opened.ok);
  assertEquals(db.rows("case_alerts")[0].whatsapp_status, "pending");

  const w = fakeWhaapy();
  const h = await requestHandoff(sb(db), w.client, { phone: PHONE, caseId: opened.case_id, reason: "paciente pide asesor" });
  assert(h.ok);
  const handoff = db.rows("notifications").filter((x) => x.type === "case_handoff");
  assertEquals(handoff.length, 1);
  assertEquals(handoff[0].title, "Paciente pide atención del equipo: hospital");
  const alerts = db.rows("case_alerts");
  assertEquals(alerts.map((x) => [x.kind, x.whatsapp_status]), [["opened", "skipped"], ["handoff", "pending"]]);
  assertEquals(alerts[0].whatsapp_detail, "superseded_by_handoff");

  // The agent retries after a failed AI pause: same alert, nothing new.
  db.rows("patient_cases")[0].ai_state = "pause_failed";
  const retry = await requestHandoff(sb(db), w.client, { phone: PHONE, caseId: opened.case_id, reason: "otra vez" });
  assert(retry.ok && !retry.replayed);
  assertEquals(db.rows("notifications").filter((x) => x.type === "case_handoff").length, 1);
  assertEquals(db.rows("case_alerts").length, 2);

  // Direct replay of the same alert (concurrent call) is a no-op too.
  const dup = await raiseCaseAlert(sb(db), db.rows("patient_cases")[0] as never, "handoff");
  assertEquals(dup, { raised: false, reason: "duplicate" });
});

Deno.test("panel alert is best-effort: a database error never breaks open_case", async () => {
  const db = newDb();
  const broken = new Proxy(db, {
    get(target, prop) {
      if (prop === "from") {
        return (table: string) => {
          if (table === "case_alerts") throw new Error("relation case_alerts does not exist");
          return target.from(table);
        };
      }
      return Reflect.get(target, prop);
    },
  });
  const r = await openCase(broken as unknown as SupabaseClient, { phone: PHONE, requestType: "other", summary: "Hola equipo" });
  assert(r.ok && !r.deduplicated);
  assertEquals(db.rows("patient_cases").length, 1);
});

// ---------------------------------------------------------------------------
// Escalation

Deno.test("escalation: an urgent case nobody takes re-alerts every 10 min, at most 3 times, then stops", async () => {
  const db = newDb({ patient_cases: [waitingCase()] });
  const run = (ms: number) => escalateOverdueCases(sb(db), S, ms);

  assertEquals(await run(T0 + 9 * MIN), 0); // still inside the SLA
  assertEquals(await run(T0 + 10 * MIN), 1);
  const c = db.rows("patient_cases")[0];
  assertEquals([c.alert_level, c.last_alert_at], [1, iso(T0 + 10 * MIN)]);
  const n = db.rows("notifications")[0];
  assertEquals([n.type, n.title], ["case_overdue", "Urgencia sin tomar: 10 min esperando"]);
  assertEquals(n.body, "Estudios · prioridad urgente · aviso 1 de 3\nPaciente busca laboratorio para biometría hemática en Querétaro");
  assertEquals(db.rows("case_alerts")[0].whatsapp_status, "pending");
  assertEquals(caseEvents(db), ["escalated", "staff_alert_sent"]);

  assertEquals(await run(T0 + 11 * MIN), 0); // no spam: one period after the last alert
  assertEquals(await run(T0 + 20 * MIN), 1);
  assertEquals(await run(T0 + 30 * MIN), 1);
  assertEquals(await run(T0 + 40 * MIN), 0); // max_escalations reached
  assertEquals(await run(T0 + 600 * MIN), 0);
  assertEquals(db.rows("case_alerts").map((a) => a.level), [1, 2, 3]);
  assertEquals(db.rows("notifications").length, 3);
});

Deno.test("escalation: SLA per priority, taken cases are left alone, concurrent runs escalate once", async () => {
  const normal = waitingCase({ priority: "normal", status: "open" });
  const high = waitingCase({ priority: "high", request_type: "hospital", subject_phone: "+525500000001" });
  const taken = waitingCase({ status: "assigned", subject_phone: "+525500000002" });
  const db = newDb({ patient_cases: [normal, high, taken] });
  assertEquals(await escalateOverdueCases(sb(db), S, T0 + 30 * MIN), 1); // only the high one
  assertEquals(db.rows("case_alerts").map((a) => a.case_id), [high.id]);
  assertEquals(await escalateOverdueCases(sb(db), S, T0 + 120 * MIN), 2); // normal now, high again (30 min after its alert)

  // A staff member takes the case between the read and the claim → no escalation.
  const db2 = newDb({ patient_cases: [waitingCase()] });
  db2.beforeUpdate = (t) => {
    if (t === "patient_cases") db2.rows("patient_cases")[0].status = "assigned";
  };
  assertEquals(await escalateOverdueCases(sb(db2), S, T0 + 15 * MIN), 0);
  assertEquals(db2.rows("notifications").length, 0);

  // Two overlapping worker runs: the second one finds the level already claimed.
  const db3 = newDb({ patient_cases: [waitingCase()] });
  let racedOnce = false;
  db3.beforeUpdate = (t) => {
    if (t === "patient_cases" && !racedOnce) {
      racedOnce = true;
      db3.rows("patient_cases")[0].alert_level = 1; // the other run won
    }
  };
  assertEquals(await escalateOverdueCases(sb(db3), S, T0 + 15 * MIN), 0);
});

// ---------------------------------------------------------------------------
// WhatsApp to the on-call numbers

Deno.test("WhatsApp: urgent alert goes to every active number (urgent-only included), with the template variables and the case link", async () => {
  const c = waitingCase();
  const db = newDb({ patient_cases: [c] });
  await escalateOverdueCases(sb(db), S, T0 + 25 * MIN);
  const w = fakeWhaapy();
  const out = await runStaffAlerts(sb(db), w.client, { now: () => T0 + 25 * MIN });
  assertEquals(out, { whatsapp_sent: 1 });
  assertEquals(w.sent.map((b) => b.to), ["+525511111111", "+525522222222", "+525533333333"]);
  assertEquals(w.sent[0], {
    to: "+525511111111",
    type: "template",
    template: {
      name: "alerta_caso_findmed",
      language: { policy: "deterministic", code: "es_MX" },
      components: [
        {
          type: "body",
          parameters: ["Estudios", "Urgente", "Paciente busca laboratorio para biometría hemática en Querétaro", "25"].map((text) => ({ type: "text", text })),
        },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: c.id }] },
      ],
    },
  });
  const d = db.rows("message_deliveries");
  assertEquals(d.map((x) => [x.source, x.status, x.case_id, x.staff_recipient_id]), [
    ["staff_alert", "accepted", c.id, "r1"],
    ["staff_alert", "accepted", c.id, "r2"],
    ["staff_alert", "accepted", c.id, "r3"],
  ]);
  assertEquals(d[0].whaapy_message_id, "msg-1"); // receipts match on this id (applyReceipt)
  assertEquals(db.rows("case_alerts")[0].whatsapp_status, "sent");
  assert(caseEvents(db).includes("staff_alert_sent"));

  // Re-processing the same alert never sends again.
  db.rows("case_alerts")[0].whatsapp_status = "pending";
  await runStaffAlerts(sb(db), w.client, { now: () => T0 + 26 * MIN });
  assertEquals(w.sent.length, 3);
});

Deno.test("WhatsApp: high priority skips urgent-only numbers; a case taken meanwhile gets no WhatsApp", async () => {
  const c = waitingCase({ priority: "high" });
  const db = newDb({ patient_cases: [c] });
  await escalateOverdueCases(sb(db), S, T0 + 31 * MIN);
  const w = fakeWhaapy();
  await runStaffAlerts(sb(db), w.client, { now: () => T0 + 31 * MIN });
  assertEquals(w.sent.map((b) => b.to), ["+525511111111", "+525522222222"]);

  const c2 = waitingCase();
  const db2 = newDb({ patient_cases: [c2] });
  await escalateOverdueCases(sb(db2), S, T0 + 11 * MIN);
  db2.rows("patient_cases")[0].status = "assigned"; // someone took it before the worker sent
  const w2 = fakeWhaapy();
  assertEquals(await runStaffAlerts(sb(db2), w2.client, { now: () => T0 + 11 * MIN }), { whatsapp_skipped: 1 });
  assertEquals(w2.sent.length, 0);
  assertEquals(db2.rows("case_alerts")[0].whatsapp_detail, "case_assigned");
});

Deno.test("WhatsApp: no on-call numbers, missing template and WHAAPY down end visibly (never in silence)", async () => {
  // No numbers: skipped + case history entry.
  const db = newDb({ patient_cases: [waitingCase()], staff_alert_recipients: [] });
  await escalateOverdueCases(sb(db), S, T0 + 11 * MIN);
  await runStaffAlerts(sb(db), fakeWhaapy().client, { now: () => T0 + 11 * MIN });
  assertEquals([db.rows("case_alerts")[0].whatsapp_status, db.rows("case_alerts")[0].whatsapp_detail], ["skipped", "no_recipients"]);
  assert(caseEvents(db).includes("staff_alert_skipped"));

  // Template not in WHAAPY: one failed delivery per number with the reason; nothing sent.
  const db2 = newDb({ patient_cases: [waitingCase()] });
  await escalateOverdueCases(sb(db2), S, T0 + 11 * MIN);
  const w2 = fakeWhaapy({ templates: [] });
  await runStaffAlerts(sb(db2), w2.client, { now: () => T0 + 11 * MIN });
  assertEquals(w2.sent.length, 0);
  const failed = db2.rows("message_deliveries");
  assertEquals(failed.length, 3);
  assert(failed.every((d) => d.status === "failed" && d.error_code === "template_invalid"));
  assert(String(failed[0].error_message).includes('La plantilla "alerta_caso_findmed" no existe'));
  assertEquals(db2.rows("case_alerts")[0].whatsapp_status, "failed");
  assert(caseEvents(db2).includes("staff_alert_failed"));
  assertEquals(db2.rows("notifications").length, 1); // the panel alert is there regardless

  // WHAAPY not configured.
  const db3 = newDb({ patient_cases: [waitingCase()] });
  await escalateOverdueCases(sb(db3), S, T0 + 11 * MIN);
  await runStaffAlerts(sb(db3), fakeWhaapy({ configured: false }).client, { now: () => T0 + 11 * MIN });
  assert(db3.rows("message_deliveries").every((d) => d.error_code === "whaapy_not_configured"));
});

Deno.test("WhatsApp: 503 retries later without re-sending accepted numbers; a lost response is uncertain and never re-sent", async () => {
  const db = newDb({ patient_cases: [waitingCase()] });
  await escalateOverdueCases(sb(db), S, T0 + 11 * MIN);
  const w = fakeWhaapy({ script: [ok({ message_id: "a", wamid: null }), { ok: false, status: 503, error: "busy" }, ok({ message_id: "c", wamid: null })] });
  assertEquals(await runStaffAlerts(sb(db), w.client, { now: () => T0 + 11 * MIN }), { whatsapp_retry: 1 });
  const alert = db.rows("case_alerts")[0];
  assertEquals([alert.whatsapp_status, alert.next_attempt_at], ["pending", iso(T0 + 12 * MIN)]);
  await runStaffAlerts(sb(db), w.client, { now: () => T0 + 12 * MIN });
  assertEquals(w.sent.map((b) => b.to), ["+525511111111", "+525522222222", "+525533333333", "+525522222222"]);
  assertEquals(db.rows("case_alerts")[0].whatsapp_status, "sent");

  const db2 = newDb({ patient_cases: [waitingCase()] });
  await escalateOverdueCases(sb(db2), S, T0 + 11 * MIN);
  const w2 = fakeWhaapy({ script: [{ ok: false, status: 0, error: "timeout" }] });
  await runStaffAlerts(sb(db2), w2.client, { now: () => T0 + 11 * MIN });
  assertEquals(db2.rows("message_deliveries").map((d) => d.status), ["uncertain", "accepted", "accepted"]);
  assertEquals(db2.rows("case_alerts")[0].whatsapp_status, "partial");
  db2.rows("case_alerts")[0].whatsapp_status = "pending";
  await runStaffAlerts(sb(db2), w2.client, { now: () => T0 + 12 * MIN });
  assertEquals(w2.sent.length, 3); // the uncertain one waits for a person
});

Deno.test("worker: runs the staff alerts after the outbox and reports them", async () => {
  const db = newDb({ patient_cases: [waitingCase()], domain_outbox: [], whaapy_events: [] });
  db.rpcHandlers.claim_outbox = () => [];
  const w = fakeWhaapy();
  const res = await handleWorker(new Request("https://x", { method: "POST" }), {
    supabase: sb(db),
    whaapy: w.client,
    isAuthorized: () => true,
    now: () => T0 + 15 * MIN,
  });
  assertEquals(await res.json(), { outbox: {}, whaapy_events: 0, case_alerts: { escalated: 1, whatsapp_sent: 1 } });
  assertEquals(w.sent.length, 3);
});

// ---------------------------------------------------------------------------
// Admin actions (case-actions)

Deno.test("case-actions: on-call numbers are normalized, settings validated, test alert sent with the template", async () => {
  const db = newDb({ staff_alert_recipients: [] });
  const w = fakeWhaapy();
  const post = async (body: unknown) => {
    const res = await handleCaseActions(new Request("https://x/functions/v1/case-actions", { method: "POST", body: JSON.stringify(body) }), {
      supabase: sb(db),
      whaapy: w.client,
      authorize: () => Promise.resolve({ ok: true as const, userId: "11111111-aaaa-4aaa-8aaa-111111111111" }),
    });
    return { status: res.status, body: await res.json() };
  };

  const saved = await post({ action: "alert_recipient_save", name: " Guardia noche ", phone: "55 1234 5678", receives: "urgent_only", is_active: true });
  assertEquals(saved.status, 200);
  assertEquals([saved.body.recipient.name, saved.body.recipient.phone, saved.body.recipient.receives], ["Guardia noche", "+525512345678", "urgent_only"]);
  assertEquals((await post({ action: "alert_recipient_save", name: "X", phone: "123", receives: "all" })).status, 400);
  assertEquals((await post({ action: "alert_recipient_save", name: "X", phone: "5512345678", receives: "todo" })).status, 400);

  const settings = await post({
    action: "alert_settings_save",
    template_name: "alerta_caso_findmed",
    sla_urgent_minutes: 5,
    sla_high_minutes: 20,
    sla_normal_minutes: 90,
    max_escalations: 2,
    whatsapp_enabled: true,
  });
  assertEquals(settings.status, 200);
  assertEquals(db.rows("staff_alert_settings")[0].sla_urgent_minutes, 5);

  const test = await post({ action: "alert_test", recipient_id: saved.body.recipient.id });
  assertEquals(test.status, 200);
  const sentBody = w.sent[0] as { to: string; template: { components: { parameters: { text: string }[] }[] } };
  assertEquals(sentBody.to, "+525512345678");
  assertEquals(sentBody.template.components[0].parameters.map((p) => p.text)[0], "Prueba");
  assertEquals(sentBody.template.components[1].parameters[0].text, "prueba");
  assertEquals(db.rows("message_deliveries")[0].source, "staff_alert");

  // Template not approved: clear message, failed delivery recorded, nothing sent.
  const w2 = fakeWhaapy({ templates: [{ ...TEMPLATE_RAW, status: "PENDING" }] });
  const res = await handleCaseActions(
    new Request("https://x", { method: "POST", body: JSON.stringify({ action: "alert_test", recipient_id: saved.body.recipient.id }) }),
    { supabase: sb(db), whaapy: w2.client, authorize: () => Promise.resolve({ ok: true as const, userId: "u" }) },
  );
  assertEquals(res.status, 502);
  assert((await res.json()).message.includes("no está aprobada"));
  assertEquals(w2.sent.length, 0);

  // Unauthorized callers never reach the alert actions.
  const denied = await handleCaseActions(new Request("https://x", { method: "POST", body: JSON.stringify({ action: "alert_test", phone: PHONE }) }), {
    supabase: sb(db),
    whaapy: w.client,
    authorize: () => Promise.resolve({ ok: false as const, status: 403, error: "Forbidden" }),
  });
  assertEquals(denied.status, 403);
});

Deno.test("settings validation: order of SLAs, ranges and template name", () => {
  const good = { template_name: "alerta_caso_findmed", sla_urgent_minutes: 10, sla_high_minutes: 30, sla_normal_minutes: 120, max_escalations: 3, whatsapp_enabled: true };
  assert(parseAlertSettings(good).ok);
  assert(!parseAlertSettings({ ...good, sla_urgent_minutes: 40 }).ok); // urgent > high
  assert(!parseAlertSettings({ ...good, sla_normal_minutes: 0 }).ok);
  assert(!parseAlertSettings({ ...good, max_escalations: 11 }).ok);
  assert(!parseAlertSettings({ ...good, template_name: "Alerta Caso" }).ok);
  assert(!parseAlertSettings({ ...good, whatsapp_enabled: "sí" }).ok);
});

// ---------------------------------------------------------------------------
// Migration (PGlite)

Deno.test("staff alerts migration: enum, settings, recipients, idempotent alerts, exclusive claim, cron wake-up rule", async () => {
  const read = (f: string) => Deno.readTextFile(new URL(`../migrations/${f}`, import.meta.url));
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon;
    CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
    CREATE FUNCTION public.is_admin_or_superadmin(_user_id uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
    CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.updated_at = now(); RETURN NEW; END;$$;
    CREATE FUNCTION public.invoke_edge_function(slug text) RETURNS void LANGUAGE sql AS 'SELECT';
    CREATE TABLE public.patients (id uuid PRIMARY KEY);
    CREATE TABLE public.appointments (id uuid PRIMARY KEY);
    CREATE TABLE public.whaapy_events (id uuid PRIMARY KEY, processed_at timestamptz, received_at timestamptz);
    CREATE TYPE public.notification_type AS ENUM ('appointment_scheduled');
    CREATE TYPE public.app_role AS ENUM ('superadmin', 'admin', 'doctor');
    CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient_role public.app_role NOT NULL,
      title text NOT NULL, body text, type public.notification_type NOT NULL, is_read boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now());
    CREATE SCHEMA cron;
    CREATE TABLE cron.job (jobname text PRIMARY KEY, schedule text, command text);
    CREATE FUNCTION cron.schedule(j text, s text, c text) RETURNS bigint LANGUAGE sql AS
      'INSERT INTO cron.job VALUES (j, s, c) ON CONFLICT (jobname) DO UPDATE SET command = EXCLUDED.command RETURNING 1::bigint';
    CREATE FUNCTION cron.unschedule(j text) RETURNS boolean LANGUAGE sql AS 'DELETE FROM cron.job WHERE jobname = j RETURNING true';`);
  await db.exec(await read("20261013130000_patient_cases.sql"));
  await db.exec(await read("20261013140000_messaging_outbox.sql"));
  const sql = await read("20261014110000_case_staff_alerts.sql");
  await db.exec(sql);
  await db.exec(sql); // idempotent re-run (IF NOT EXISTS / unschedule + schedule)

  const types = await db.query<{ v: string }>("SELECT unnest(enum_range(NULL::public.notification_type))::text AS v");
  assertEquals(types.rows.map((r) => r.v), ["appointment_scheduled", "case_opened", "case_handoff", "case_overdue"]);
  const s = await db.query<{ template_name: string; sla_urgent_minutes: number; max_escalations: number }>("SELECT * FROM staff_alert_settings");
  assertEquals([s.rows.length, s.rows[0].template_name, s.rows[0].sla_urgent_minutes, s.rows[0].max_escalations], [1, "alerta_caso_findmed", 10, 3]);

  // Recipients: canonical phones only, one row per phone.
  await db.exec("INSERT INTO staff_alert_recipients (name, phone) VALUES ('Guardia', '+525511111111')");
  const badPhone = await assertRejects(() => db.exec("INSERT INTO staff_alert_recipients (name, phone) VALUES ('X', '55 1111 1111')")) as { code?: string };
  assertEquals(badPhone.code, "23514");
  const shortMx = await assertRejects(() => db.exec("INSERT INTO staff_alert_recipients (name, phone) VALUES ('X', '+52551111111')")) as { code?: string };
  assertEquals(shortMx.code, "23514");
  const dupPhone = await assertRejects(() => db.exec("INSERT INTO staff_alert_recipients (name, phone) VALUES ('Y', '+525511111111')")) as { code?: string };
  assertEquals(dupPhone.code, "23505");

  // Wake-up rule: an urgent case 11 min old with no alert → work; once at max level → none.
  const work = async () => (await db.query<{ w: boolean }>("SELECT public.staff_alerts_have_work() AS w")).rows[0].w;
  assertEquals(await work(), false);
  const c = (await db.query<{ id: string }>(
    `INSERT INTO patient_cases (request_type, subject_phone, summary, priority, status, created_at)
     VALUES ('urgency', '+525512345678', 'Dolor', 'urgent', 'awaiting_assignment', now() - interval '11 minutes') RETURNING id`,
  )).rows[0].id;
  assertEquals(await work(), true);
  await db.exec(`UPDATE patient_cases SET alert_level = 1, last_alert_at = now() WHERE id = '${c}'`);
  assertEquals(await work(), false); // just alerted: wait a full period
  await db.exec(`UPDATE patient_cases SET last_alert_at = now() - interval '10 minutes' WHERE id = '${c}'`);
  assertEquals(await work(), true);
  await db.exec(`UPDATE patient_cases SET alert_level = 3 WHERE id = '${c}'`);
  assertEquals(await work(), false);
  await db.exec(`UPDATE staff_alert_settings SET max_escalations = 5`);
  assertEquals(await work(), true); // configurable
  await db.exec(`UPDATE staff_alert_settings SET max_escalations = 3`);

  // Alerts: one per (case, kind, level); claim is exclusive; a queued alert wakes the worker.
  const ins = (key: string) =>
    db.query(`INSERT INTO case_alerts (dedupe_key, case_id, kind, level, priority) VALUES ('${key}', '${c}', 'opened', 0, 'urgent')
              ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`);
  assertEquals((await ins(`${c}:opened:0`)).rows.length, 1);
  assertEquals((await ins(`${c}:opened:0`)).rows.length, 0);
  assertEquals(await work(), true);
  const first = await db.query<{ id: string; attempts: number }>("SELECT id, attempts FROM claim_case_alerts(10, 120)");
  assertEquals(first.rows.map((r) => r.attempts), [1]);
  assertEquals((await db.query("SELECT id FROM claim_case_alerts(10, 120)")).rows.length, 0);
  assertEquals(await work(), false);

  // Deliveries to the team: new source, one per (alert, number).
  const alertId = first.rows[0].id;
  const rid = (await db.query<{ id: string }>("SELECT id FROM staff_alert_recipients")).rows[0].id;
  const del = (src = "staff_alert") =>
    db.query(`INSERT INTO message_deliveries (to_phone, template_name, source, case_id, case_alert_id, staff_recipient_id)
              VALUES ('+525511111111', 'alerta_caso_findmed', '${src}', '${c}', '${alertId}', '${rid}') ON CONFLICT DO NOTHING RETURNING id`);
  assertEquals((await del()).rows.length, 1);
  assertEquals((await del()).rows.length, 0);
  const badSource = await assertRejects(() => del("sms")) as { code?: string };
  assertEquals(badSource.code, "23514");

  // Notifications link to the case; deleting the case keeps the notification.
  await db.exec(`INSERT INTO notifications (recipient_role, title, type, case_id) VALUES ('admin', 'x', 'appointment_scheduled', '${c}')`);
  await db.exec(`DELETE FROM case_events WHERE case_id = '${c}'; DELETE FROM message_deliveries WHERE case_id = '${c}'; DELETE FROM patient_cases WHERE id = '${c}'`);
  assertEquals((await db.query<{ case_id: string | null }>("SELECT case_id FROM notifications")).rows[0].case_id, null);

  const job = await db.query<{ command: string }>("SELECT command FROM cron.job WHERE jobname = 'findmed-events-worker'");
  assert(job.rows[0].command.includes("public.staff_alerts_have_work()"));
  assert(job.rows[0].command.includes("public.domain_outbox"));
  const rls = await db.query<{ relrowsecurity: boolean }>(
    "SELECT relrowsecurity FROM pg_class WHERE relname IN ('staff_alert_settings', 'staff_alert_recipients', 'case_alerts')",
  );
  assertEquals(rls.rows.map((r) => r.relrowsecurity), [true, true, true]);
  await db.close();
});
