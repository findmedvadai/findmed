// B7 — outbox, worker, templates, receipts and WhatsApp buttons (R33–R38, N30, F14).
// FakeDb + a scripted WHAAPY client; the migration is replayed on PGlite.
//
//   npm run test:edge

import { assert, assertEquals } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.3.15";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  applyReceipt,
  buildTemplateRequest,
  enqueueEvent,
  formatMxDateTime,
  isRescheduleEvent,
  type OutboxRow,
  processOutboxRow,
  type RouteStep,
  staleReason,
} from "../functions/_shared/messaging.ts";
import { parseButtonPress, processWhaapyEvent } from "../functions/_shared/whaapy-events.ts";
import type { WhaapyClient, WhaapyResult, WhaapySent } from "../functions/_shared/whaapy-client.ts";
import { handleWorker } from "../functions/findmed-events-worker/handler.ts";
import { FakeDb, stubFetch } from "./fake-supabase.ts";

Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ default: "sb_secret_test" }));
Deno.env.set("APP_URL", "https://app.example.test");

const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const APPT = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const OTHER_APPT = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const sb = (db: FakeDb) => db as unknown as SupabaseClient;

// Seed steps = the migration's mapping for the events used here.
function step(event_type: string, position: number, template_name: string, extra: Partial<RouteStep> = {}) {
  return {
    id: crypto.randomUUID(), event_type, position, template_name, language: "es_MX", body_params: [],
    url_button_param: null, quick_reply_action: null, when_status: null, when_cancel_reason: null, enabled: true, ...extra,
  };
}

function clinic(owner: "n8n" | "findmed" = "findmed", status = "confirmed") {
  const now = Date.now();
  return new FakeDb({
    message_routes: [
      { event_type: "appointment.status_changed", owner },
      { event_type: "appointment.reminder_48h", owner },
      { event_type: "appointment.rescheduled_by_staff", owner },
    ],
    message_route_steps: [
      step("appointment.status_changed", 1, "confirmada_estado_cita", { when_status: "confirmed", body_params: ["patient_name"], url_button_param: "manage_token" }),
      step("appointment.status_changed", 2, "boton_cancelar_cita", { when_status: "confirmed", quick_reply_action: "cancel" }),
      step("appointment.status_changed", 1, "cancelada_paciente", { when_status: "cancelled", when_cancel_reason: "patient" }),
      step("appointment.reminder_48h", 1, "dosdias_pre_confirmacion", {
        body_params: ["patient_name", "start_local", "doctor_name", "office_address", "min_confirm_hours"],
        url_button_param: "manage_token",
      }),
    ],
    patients: [
      { id: "p1", full_name: "Paciente Prueba", phone: "+525512345678" },
      { id: "p2", full_name: "Otra", phone: "+525599990000" },
    ],
    doctors: [{ id: "d1", full_name: "Dra. Prueba" }],
    doctor_offices: [{ id: "o1", name: "Centro", address: "Calle 1, CDMX" }],
    doctor_schedule_settings: [{ doctor_id: "d1", min_confirm_hours_before: 24 }],
    appointments: [
      { id: APPT, patient_id: "p1", doctor_id: "d1", office_id: "o1", status, cancel_reason: null, start_at: iso(now + 72 * H), end_at: iso(now + 72.5 * H), google_event_id: null, outlook_event_id: null },
      { id: OTHER_APPT, patient_id: "p2", doctor_id: "d1", office_id: "o1", status: "scheduled", cancel_reason: null, start_at: iso(now + 80 * H), end_at: iso(now + 80.5 * H), google_event_id: null, outlook_event_id: null },
    ],
    appointment_manage_tokens: [{ token: "tok1", appointment_id: APPT, expires_at: iso(now + 100 * H), created_at: iso(now) }],
    domain_outbox: [],
    message_deliveries: [],
    operation_requests: [],
    notifications: [],
    whaapy_events: [],
  });
}

/** WHAAPY whose sendMessage answers from a script (default: accepted). */
function scriptedWhaapy(script: WhaapyResult<WhaapySent>[] = []) {
  const sent: Record<string, unknown>[] = [];
  let n = 0;
  const client: WhaapyClient = {
    configured: true,
    conversationByPhone: () => Promise.resolve({ ok: true, status: 200, data: null }),
    setAiEnabled: () => Promise.resolve({ ok: true, status: 200, data: {} }),
    listAgents: () => Promise.resolve({ ok: true, status: 200, data: [] }),
    updateContact: () => Promise.resolve({ ok: true, status: 200, data: {} }),
    listTemplates: () => Promise.resolve({ ok: true, status: 200, data: [] }),
    syncTemplates: () => Promise.resolve({ ok: true, status: 200, data: {} }),
    sendMessage: (body) => {
      sent.push(body);
      const r = script[n++] ?? { ok: true, status: 200, data: { message_id: `msg-${n}`, wamid: `wamid-${n}` } };
      return Promise.resolve(r);
    },
  };
  return { client, sent };
}

async function queued(db: FakeDb, eventType: string, payload: Record<string, unknown>): Promise<OutboxRow> {
  await enqueueEvent(sb(db), eventType, payload);
  const row = db.rows("domain_outbox").at(-1)!;
  row.attempts = 1; // as claim_outbox would leave it
  return row as unknown as OutboxRow;
}

Deno.test("formatMxDateTime matches the n8n text in CDMX time", () => {
  assertEquals(formatMxDateTime("2026-10-12T21:05:00Z"), "12 de Octubre, 3:05 pm");
  assertEquals(formatMxDateTime("2026-01-01T06:30:00Z"), "1 de Enero, 12:30 am");
});

Deno.test("N30: template parameters go as an array in template order (commas in dates are safe)", () => {
  const ctx = {
    id: APPT, status: "scheduled", cancel_reason: null, start_at: "2026-10-20T16:00:00Z", end_at: "2026-10-20T16:30:00Z",
    patient_name: "Ana", patient_phone: "+525512345678", doctor_name: "Dra. Prueba", office_address: "Calle 1, CDMX", min_confirm_hours: 24,
  };
  const r = buildTemplateRequest(
    step("appointment.rescheduled_by_staff", 1, "cita_reagendada_staff", {
      body_params: ["patient_name", "previous_start_local", "start_local", "doctor_name", "office_address"],
      url_button_param: "manage_token",
    }) as RouteStep,
    ctx,
    { manageToken: "tok1", previousStartAt: "2026-10-18T16:00:00Z" },
  );
  assert("body" in r);
  const t = r.body.template as { name: string; components: { type: string; parameters: { text?: string; payload?: string }[] }[] };
  assertEquals(t.components[0].parameters.map((p) => p.text), ["Ana", "18 de Octubre, 10:00 am", "20 de Octubre, 10:00 am", "Dra. Prueba", "Calle 1, CDMX"]);
  assertEquals(t.components[1].parameters[0].text, "tok1");
  assertEquals("allowButtonIdOverride" in r.body, false);

  const q = buildTemplateRequest(step("x", 2, "boton_cancelar_cita", { quick_reply_action: "cancel" }) as RouteStep, ctx, { manageToken: null, previousStartAt: null });
  assert("body" in q);
  assertEquals(q.body.allowButtonIdOverride, true);
  const qt = q.body.template as { components: { parameters: { payload?: string }[] }[] };
  assertEquals(qt.components[0].parameters[0].payload, `cancelar_cita:${APPT}`);

  const missing = buildTemplateRequest(step("x", 1, "t", { body_params: ["previous_start_local"] }) as RouteStep, ctx, { manageToken: null, previousStartAt: null });
  assertEquals(missing, { error: "missing_value_previous_start_local" });
});

Deno.test("R33: stale events are not sent", () => {
  const base = { id: APPT, cancel_reason: null, start_at: iso(Date.now() + 48 * H), end_at: iso(Date.now() + 49 * H), patient_name: "A", patient_phone: "+52", doctor_name: "D", office_address: "X", min_confirm_hours: 24 };
  assertEquals(staleReason("appointment.reminder_48h", {}, { ...base, status: "cancelled" }), "status_now_cancelled");
  assertEquals(staleReason("appointment.reminder_48h", {}, { ...base, status: "scheduled" }), null);
  assertEquals(staleReason("appointment.status_changed", { new_status: "confirmed" }, { ...base, status: "cancelled" }), "status_now_cancelled");
  assertEquals(staleReason("appointment.rescheduled_by_staff", { start_at: iso(Date.now() + 10 * H) }, { ...base, status: "scheduled" }), "superseded_by_newer_schedule");
  assertEquals(staleReason("appointment.reminder_day_of", {}, { ...base, status: "confirmed", start_at: iso(Date.now() - H) }), "appointment_in_past");
});

Deno.test("worker: confirmed → template with name + manage link, then the cancel button bound to the appointment", async () => {
  const db = clinic();
  const w = scriptedWhaapy();
  const row = await queued(db, "appointment.status_changed", { appointment_id: APPT, new_status: "confirmed", patient_phone: "+520000000000" });
  assertEquals(await processOutboxRow(sb(db), w.client, row), "sent");
  assertEquals(w.sent.length, 2);
  assertEquals(w.sent[0].to, "+525512345678"); // phone from the DB, never from the payload
  const d = db.rows("message_deliveries");
  assertEquals(d.map((x) => [x.template_name, x.status, x.whaapy_message_id]), [
    ["confirmada_estado_cita", "accepted", "msg-1"],
    ["boton_cancelar_cita", "accepted", "msg-2"],
  ]);
  assertEquals(db.rows("domain_outbox")[0].status, "sent");

  // Re-processing the same row (e.g. lease expired after success) sends nothing new.
  row.attempts = 2;
  assertEquals(await processOutboxRow(sb(db), w.client, row), "sent");
  assertEquals(w.sent.length, 2);
});

Deno.test("R38: an event still owned by n8n is never sent by FindMed", async () => {
  const db = clinic("n8n");
  const w = scriptedWhaapy();
  const row = await queued(db, "appointment.status_changed", { appointment_id: APPT, new_status: "confirmed" });
  assertEquals(await processOutboxRow(sb(db), w.client, row), "skipped");
  assertEquals(w.sent.length, 0);
});

Deno.test("EV01: a doctor's cancellation does not send 'cancelada_paciente' (no double message)", async () => {
  const db = clinic("findmed", "cancelled");
  db.rows("appointments")[0].cancel_reason = "doctor";
  const w = scriptedWhaapy();
  const row = await queued(db, "appointment.status_changed", { appointment_id: APPT, new_status: "cancelled" });
  assertEquals(await processOutboxRow(sb(db), w.client, row), "skipped");
  assertEquals(db.rows("domain_outbox")[0].last_error, "no_template_for_event");
  assertEquals(w.sent.length, 0);
});

Deno.test("R33: a 48 h reminder for an appointment cancelled meanwhile is skipped", async () => {
  const db = clinic("findmed", "cancelled");
  const w = scriptedWhaapy();
  const row = await queued(db, "appointment.reminder_48h", { appointment_id: APPT });
  assertEquals(await processOutboxRow(sb(db), w.client, row), "skipped");
  assertEquals(w.sent.length, 0);
});

Deno.test("R34: 429 retries with backoff and resends only the missing step", async () => {
  const db = clinic();
  const w = scriptedWhaapy([
    { ok: true, status: 200, data: { message_id: "m-ok", wamid: null } },
    { ok: false, status: 429, error: "rate limited" },
  ]);
  const row = await queued(db, "appointment.status_changed", { appointment_id: APPT, new_status: "confirmed" });
  assertEquals(await processOutboxRow(sb(db), w.client, row), "retry");
  const ob = db.rows("domain_outbox")[0];
  assertEquals(ob.status, "pending");
  assert(Date.parse(String(ob.next_attempt_at)) > Date.now());
  row.attempts = 2;
  assertEquals(await processOutboxRow(sb(db), w.client, row), "sent");
  assertEquals(w.sent.map((b) => (b.template as { name: string }).name), ["confirmada_estado_cita", "boton_cancelar_cita", "boton_cancelar_cita"]);
  assertEquals(db.rows("message_deliveries").length, 2); // the retried step reused its row
});

Deno.test("R34/N23: a lost response is 'uncertain' and is never re-sent automatically", async () => {
  const db = clinic();
  const w = scriptedWhaapy([{ ok: false, status: 0, error: "timeout" }]);
  const row = await queued(db, "appointment.status_changed", { appointment_id: APPT, new_status: "confirmed" });
  assertEquals(await processOutboxRow(sb(db), w.client, row), "uncertain");
  row.attempts = 2;
  assertEquals(await processOutboxRow(sb(db), w.client, row), "uncertain");
  assertEquals(w.sent.length, 1);
  assertEquals(db.rows("message_deliveries")[0].status, "uncertain");
});

Deno.test("R34: a 4xx (bad template/params) fails without retrying; max attempts → failed", async () => {
  const db = clinic();
  const w = scriptedWhaapy([{ ok: false, status: 400, error: "invalid_template_parameters" }]);
  const row = await queued(db, "appointment.status_changed", { appointment_id: APPT, new_status: "confirmed" });
  assertEquals(await processOutboxRow(sb(db), w.client, row), "failed");
  assertEquals(db.rows("message_deliveries")[0].error_code, "400");

  const db2 = clinic();
  const w2 = scriptedWhaapy([{ ok: false, status: 503, error: "down" }]);
  const row2 = await queued(db2, "appointment.status_changed", { appointment_id: APPT, new_status: "confirmed" });
  row2.attempts = 5;
  assertEquals(await processOutboxRow(sb(db2), w2.client, row2), "failed");
});

Deno.test("R33: the same event emitted twice is queued once", async () => {
  const db = clinic();
  const p = { appointment_id: APPT, new_status: "confirmed", start_at: "2026-10-20T16:00:00Z" };
  assertEquals((await enqueueEvent(sb(db), "appointment.status_changed", p)).duplicate, false);
  assertEquals((await enqueueEvent(sb(db), "appointment.status_changed", { ...p, timestamp: "later" })).duplicate, true);
  assertEquals(db.rows("domain_outbox").length, 1);
});

Deno.test("receipts move forward only (sent → delivered → read; late 'sent' or 'failed' after delivery ignored)", async () => {
  const db = clinic();
  db.rows("message_deliveries").push({ id: "d1", status: "accepted", whaapy_message_id: "msg-9" });
  assertEquals(await applyReceipt(sb(db), "message.delivered", { message_id: "msg-9" }), "updated");
  assertEquals(await applyReceipt(sb(db), "message.sent", { message_id: "msg-9" }), "ignored");
  assertEquals(await applyReceipt(sb(db), "message.failed", { message_id: "msg-9", error: { code: "131047" } }), "ignored");
  assertEquals(await applyReceipt(sb(db), "message.read", { message_id: "msg-9" }), "updated");
  assertEquals(db.rows("message_deliveries")[0].status, "read");
  assertEquals(await applyReceipt(sb(db), "message.read", { message_id: "unknown" }), "unknown_message");

  db.rows("message_deliveries").push({ id: "d2", status: "accepted", whaapy_message_id: "msg-10" });
  await applyReceipt(sb(db), "message.failed", { message_id: "msg-10", error: { code: "131047", message: "ventana expirada" } });
  assertEquals([db.rows("message_deliveries")[1].status, db.rows("message_deliveries")[1].error_code], ["failed", "131047"]);
});

const buttonEvent = (payload: string, from = "5215512345678") => ({
  id: crypto.randomUUID(),
  event_type: "message.received",
  payload: { data: { message: { from, id: "wamid.btn", type: "button", button: { payload, text: "Confirmar cita" } } } },
});

Deno.test("F14/A6: parseButtonPress only takes FindMed payloads with an appointment id", () => {
  assertEquals(parseButtonPress(buttonEvent(`confirmar_cita:${APPT}`).payload.data), { action: "confirm", appointmentId: APPT, phone: "5215512345678", wamid: "wamid.btn" });
  assertEquals(parseButtonPress(buttonEvent("confirmar_cita").payload.data), null); // n8n's button: left to n8n
  assertEquals(parseButtonPress({ message: { from: "52155", interactive: { button_reply: { id: `cancelar_cita:${APPT}` } } } })?.action, "cancel");
  assertEquals(parseButtonPress({ message: { from: "52155", text: { body: `confirmar_cita:${APPT}` } } }), null); // typed text is not a button
});

Deno.test("F14/A6: a confirm button confirms THAT appointment; a repeat answers 'ya estaba confirmada'", async () => {
  const db = clinic("findmed", "scheduled");
  const w = scriptedWhaapy();
  const f = stubFetch();
  try {
    const r = await processWhaapyEvent(sb(db), w.client, buttonEvent(`confirmar_cita:${APPT}`));
    assertEquals(r.outcome, "button_confirm_succeeded");
    assertEquals(db.rows("appointments")[0].status, "confirmed");
    assertEquals(db.rows("appointments")[1].status, "scheduled"); // the other patient's appointment untouched
    const op = db.rows("operation_requests")[0];
    assertEquals([op.channel, (op.confirmation_evidence as { type: string }).type], ["whatsapp_button", "whatsapp_button"]);
    assertEquals(w.sent.length, 0); // the confirmation message comes from status_changed

    const again = await processWhaapyEvent(sb(db), w.client, buttonEvent(`confirmar_cita:${APPT}`));
    assertEquals(again.outcome, "button_confirm_already_confirmed");
    assertEquals(w.sent[0], { to: "5215512345678", content: "Tu cita ya estaba confirmada 👍" });
  } finally {
    f.restore();
  }
});

Deno.test("X07: a button for someone else's appointment does nothing to it", async () => {
  const db = clinic("findmed", "scheduled");
  const w = scriptedWhaapy();
  const r = await processWhaapyEvent(sb(db), w.client, buttonEvent(`cancelar_cita:${OTHER_APPT}`));
  assertEquals(r.outcome, "button_cancel_not_found");
  assertEquals(db.rows("appointments")[1].status, "scheduled");
});

Deno.test("worker: auth, claims via RPC, processes outbox and leftover webhook events", async () => {
  const db = clinic();
  const w = scriptedWhaapy();
  const row = await queued(db, "appointment.status_changed", { appointment_id: APPT, new_status: "confirmed" });
  db.rpcHandlers.claim_outbox = () => [row];
  db.rows("message_deliveries").push({ id: "d9", status: "accepted", whaapy_message_id: "msg-77" });
  db.rows("whaapy_events").push({ id: "e1", event_type: "message.delivered", payload: { data: { message_id: "msg-77" } }, processed_at: null, received_at: iso(Date.now() - 5 * 60_000) });
  const call = (ok: boolean) => handleWorker(new Request("https://x", { method: "POST" }), { supabase: sb(db), whaapy: w.client, isAuthorized: () => ok });

  assertEquals((await call(false)).status, 401);
  const res = await call(true);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { outbox: { sent: 1 }, whaapy_events: 1 });
  assertEquals(db.rows("message_deliveries").find((d) => d.id === "d9")!.status, "delivered");
  assert(db.rows("whaapy_events")[0].processed_at);
});

Deno.test("messaging migration: seed is all-n8n, claim is exclusive, dedupe and one delivery per step", async () => {
  const sql = await Deno.readTextFile(new URL("../migrations/20261013140000_messaging_outbox.sql", import.meta.url));
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon;
    CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
    CREATE FUNCTION public.is_admin_or_superadmin(_user_id uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
    CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.updated_at = now(); RETURN NEW; END;$$;
    CREATE FUNCTION public.invoke_edge_function(slug text) RETURNS void LANGUAGE sql AS 'SELECT';
    CREATE TABLE public.appointments (id uuid PRIMARY KEY);
    CREATE TABLE public.whaapy_events (id uuid PRIMARY KEY, processed_at timestamptz, received_at timestamptz);
    CREATE SCHEMA cron;
    CREATE TABLE cron.job (jobname text PRIMARY KEY, schedule text, command text);
    CREATE FUNCTION cron.schedule(j text, s text, c text) RETURNS bigint LANGUAGE sql AS
      'INSERT INTO cron.job VALUES (j, s, c) ON CONFLICT (jobname) DO UPDATE SET command = EXCLUDED.command RETURNING 1::bigint';`);
  await db.exec(sql);

  const owners = await db.query<{ owner: string }>("SELECT DISTINCT owner FROM message_routes");
  assertEquals(owners.rows.map((r) => r.owner), ["n8n"]);
  const steps = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM message_route_steps");
  assertEquals(steps.rows[0].n, 14);
  const jobs = await db.query<{ jobname: string }>("SELECT jobname FROM cron.job ORDER BY jobname");
  assertEquals(jobs.rows.map((r) => r.jobname), ["findmed-events-worker", "purge-domain-outbox"]);

  await db.exec(`INSERT INTO domain_outbox (event_type, payload, dedupe_key) VALUES ('appointment.status_changed', '{}', 'k1'), ('appointment.reminder_48h', '{}', 'k2')`);
  const dup = await db.query("INSERT INTO domain_outbox (event_type, payload, dedupe_key) VALUES ('x', '{}', 'k1') ON CONFLICT (dedupe_key) DO NOTHING RETURNING id");
  assertEquals(dup.rows.length, 0);

  const first = await db.query<{ id: string; status: string; attempts: number }>("SELECT id, status, attempts FROM claim_outbox(10, 120)");
  assertEquals(first.rows.length, 2);
  assertEquals(first.rows.every((r) => r.status === "processing" && r.attempts === 1), true);
  const second = await db.query("SELECT id FROM claim_outbox(10, 120)");
  assertEquals(second.rows.length, 0); // leased: not claimable again
  await db.exec("UPDATE domain_outbox SET locked_until = now() - interval '1 second'");
  const retaken = await db.query<{ attempts: number }>("SELECT attempts FROM claim_outbox(10, 120)");
  assertEquals(retaken.rows.map((r) => r.attempts), [2, 2]); // expired lease is taken over

  const ob = first.rows[0].id;
  await db.exec(`INSERT INTO message_deliveries (outbox_id, step_position, to_phone, template_name) VALUES ('${ob}', 1, '+52', 't')`);
  const again = await db.query(`INSERT INTO message_deliveries (outbox_id, step_position, to_phone, template_name) VALUES ('${ob}', 1, '+52', 't') ON CONFLICT DO NOTHING RETURNING id`);
  assertEquals(again.rows.length, 0);
  await db.close();
});

// ---------------------------------------------------------------------------
// "Pedir documentos" only with the original booking (skip_on_reschedule)

function bookingClinic() {
  const db = clinic("findmed", "scheduled");
  db.rows("message_route_steps").push(
    step("appointment.status_changed", 1, "reservada_estado_cita", { when_status: "scheduled", url_button_param: "manage_token" }),
    step("appointment.status_changed", 2, "pedir_documentos", { when_status: "scheduled", skip_on_reschedule: true }),
  );
  return db;
}
const sentNames = (w: ReturnType<typeof scriptedWhaapy>) => w.sent.map((b) => (b.template as { name: string }).name);

Deno.test("isRescheduleEvent: reschedule event types and the rescheduled_from marker", () => {
  assertEquals(isRescheduleEvent("appointment.status_changed", { new_status: "scheduled" }), false);
  assertEquals(isRescheduleEvent("appointment.status_changed", { new_status: "scheduled", rescheduled_from: OTHER_APPT }), true);
  assertEquals(isRescheduleEvent("appointment.status_changed", { rescheduled_from: "" }), false);
  assertEquals(isRescheduleEvent("appointment.status_changed", { rescheduled_from: 42 }), false);
  assertEquals(isRescheduleEvent("appointment.rescheduled_by_staff", {}), true);
  assertEquals(isRescheduleEvent("appointment.rescheduled", {}), true);
});

Deno.test("first booking: 'reservada' + 'pedir_documentos' are both sent", async () => {
  const db = bookingClinic();
  const w = scriptedWhaapy();
  const row = await queued(db, "appointment.status_changed", { appointment_id: APPT, new_status: "scheduled" });
  assertEquals(await processOutboxRow(sb(db), w.client, row), "sent");
  assertEquals(sentNames(w), ["reservada_estado_cita", "pedir_documentos"]);
});

Deno.test("patient reschedule (manage-reschedule, rescheduled_from): documents are NOT requested again", async () => {
  const db = bookingClinic();
  const w = scriptedWhaapy();
  const row = await queued(db, "appointment.status_changed", { appointment_id: APPT, new_status: "scheduled", rescheduled_from: OTHER_APPT });
  assertEquals(await processOutboxRow(sb(db), w.client, row), "sent");
  assertEquals(sentNames(w), ["reservada_estado_cita"]); // new date + link, no póliza/INE
  assertEquals(db.rows("message_deliveries").map((d) => d.step_position), [1]);
});

Deno.test("reschedule where the only matching step is first-booking-only → skipped with its own reason", async () => {
  const db = bookingClinic();
  db.tables.message_route_steps = db.rows("message_route_steps").filter((s) => s.template_name !== "reservada_estado_cita");
  const w = scriptedWhaapy();
  const row = await queued(db, "appointment.status_changed", { appointment_id: APPT, new_status: "scheduled", rescheduled_from: OTHER_APPT });
  assertEquals(await processOutboxRow(sb(db), w.client, row), "skipped");
  assertEquals(db.rows("domain_outbox")[0].last_error, "only_first_booking_steps");
  assertEquals(w.sent.length, 0);
});

Deno.test("staff reschedule event never sends a first-booking-only step (defensive)", async () => {
  const db = clinic("findmed", "scheduled");
  db.rows("message_route_steps").push(
    step("appointment.rescheduled_by_staff", 1, "cita_reagendada_staff", {
      body_params: ["patient_name", "previous_start_local", "start_local", "doctor_name", "office_address"],
      url_button_param: "manage_token",
    }),
    step("appointment.rescheduled_by_staff", 2, "pedir_documentos", { skip_on_reschedule: true }),
  );
  const startAt = db.rows("appointments")[0].start_at as string;
  const w = scriptedWhaapy();
  const row = await queued(db, "appointment.rescheduled_by_staff", { appointment_id: APPT, start_at: startAt, previous_start_at: iso(Date.now() + 24 * H) });
  assertEquals(await processOutboxRow(sb(db), w.client, row), "sent");
  assertEquals(sentNames(w), ["cita_reagendada_staff"]);
});

Deno.test("steps without the flag (or rows from before the migration) keep being sent on reschedule", async () => {
  const db = bookingClinic();
  for (const s of db.rows("message_route_steps")) delete s.skip_on_reschedule; // column not there yet
  const w = scriptedWhaapy();
  const row = await queued(db, "appointment.status_changed", { appointment_id: APPT, new_status: "scheduled", rescheduled_from: OTHER_APPT });
  assertEquals(await processOutboxRow(sb(db), w.client, row), "sent");
  assertEquals(sentNames(w), ["reservada_estado_cita", "pedir_documentos"]);
});

Deno.test("migration 20261014100000: skip_on_reschedule defaults false and is on only for pedir_documentos", async () => {
  const outbox = await Deno.readTextFile(new URL("../migrations/20261013140000_messaging_outbox.sql", import.meta.url));
  const flag = await Deno.readTextFile(new URL("../migrations/20261014100000_skip_on_reschedule_steps.sql", import.meta.url));
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon;
    CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
    CREATE FUNCTION public.is_admin_or_superadmin(_user_id uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
    CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.updated_at = now(); RETURN NEW; END;$$;
    CREATE FUNCTION public.invoke_edge_function(slug text) RETURNS void LANGUAGE sql AS 'SELECT';
    CREATE TABLE public.appointments (id uuid PRIMARY KEY);
    CREATE TABLE public.whaapy_events (id uuid PRIMARY KEY, processed_at timestamptz, received_at timestamptz);
    CREATE SCHEMA cron;
    CREATE TABLE cron.job (jobname text PRIMARY KEY, schedule text, command text);
    CREATE FUNCTION cron.schedule(j text, s text, c text) RETURNS bigint LANGUAGE sql AS
      'INSERT INTO cron.job VALUES (j, s, c) ON CONFLICT (jobname) DO UPDATE SET command = EXCLUDED.command RETURNING 1::bigint';`);
  await db.exec(outbox);
  await db.exec(flag);
  await db.exec(flag); // re-runnable

  const flagged = await db.query<{ template_name: string; when_status: string }>(
    "SELECT template_name, when_status FROM message_route_steps WHERE skip_on_reschedule ORDER BY template_name",
  );
  assertEquals(flagged.rows, [{ template_name: "pedir_documentos", when_status: "scheduled" }]);
  const others = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM message_route_steps WHERE NOT skip_on_reschedule");
  assertEquals(others.rows[0].n, 13);
  await db.exec(`INSERT INTO message_route_steps (event_type, position, template_name) VALUES ('appointment.reminder_48h', 9, 'x')`);
  const added = await db.query<{ skip_on_reschedule: boolean }>("SELECT skip_on_reschedule FROM message_route_steps WHERE template_name = 'x'");
  assertEquals(added.rows[0].skip_on_reschedule, false);
  await db.close();
});
