// Business-logic / data-integrity audit (14-oct-2026). One test per risk found;
// see ERRORES.md entries of the same date.
//
//   npm run test:edge

import { assert, assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildTemplateRequest,
  enqueueEvent,
  type OutboxRow,
  processOutboxRow,
  type RouteStep,
  templateText,
} from "../functions/_shared/messaging.ts";
import { type BusyInterval, withoutFindMedEvents } from "../functions/_shared/calendar-busy.ts";
import { computeDaySlots } from "../functions/_shared/day-slots.ts";
import { validateSlotAvailable } from "../functions/_shared/slot-validation.ts";
import { isMovable, moveAppointment } from "../functions/_shared/staff-reschedule.ts";
import { repointManageTokens } from "../functions/_shared/manage-token.ts";
import { releaseReminderClaim } from "../functions/_shared/reminders.ts";
import { applyStaffAction } from "../functions/_shared/cases.ts";
import { mxLocalToMs } from "../functions/_shared/mx-time.ts";
import type { WhaapyClient, WhaapyResult, WhaapySent } from "../functions/_shared/whaapy-client.ts";
import { FakeDb, stubFetch } from "./fake-supabase.ts";

Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ default: "sb_secret_test" }));
Deno.env.set("APP_URL", "https://app.example.test");
Deno.env.set("GOOGLE_CLIENT_ID", "test-client");
Deno.env.set("GOOGLE_CLIENT_SECRET", "test-secret");

const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const sb = (db: FakeDb) => db as unknown as SupabaseClient;
const APPT = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

function whaapy() {
  const sent: Record<string, unknown>[] = [];
  const ok = <T>(data: T): Promise<WhaapyResult<T>> => Promise.resolve({ ok: true, status: 200, data });
  const client: WhaapyClient = {
    configured: true,
    conversationByPhone: () => ok(null),
    setAiEnabled: () => ok({}),
    listAgents: () => ok([]),
    updateContact: () => ok({}),
    listTemplates: () => ok([]),
    syncTemplates: () => ok({}),
    sendMessage: (body) => {
      sent.push(body);
      return ok<WhaapySent>({ message_id: `m${sent.length}`, wamid: `w${sent.length}` });
    },
  };
  return { client, sent };
}

// ---------------------------------------------------------------------------
// Messaging: WhatsApp-safe variables, address fallback, "no avisar al paciente"

Deno.test("template variables: newlines/tabs/multiple spaces collapse; blank counts as missing", () => {
  assertEquals(templateText("Av. Reforma 222,\r\nCol. Juárez\t\tPiso 3"), "Av. Reforma 222, Col. Juárez Piso 3");
  assertEquals(templateText("Ana      López"), "Ana López");
  assertEquals(templateText("   \n "), null);
  assertEquals(templateText(null), null);

  const ctx = {
    id: APPT, status: "scheduled", cancel_reason: null, start_at: "2026-10-20T16:00:00Z", end_at: "2026-10-20T16:30:00Z",
    patient_name: "Ana\nLópez", patient_phone: "+525512345678", doctor_name: "Dra. Prueba", office_address: "Calle 1\n\nCDMX", min_confirm_hours: 24,
  };
  const step = { position: 1, template_name: "t", language: "es_MX", body_params: ["patient_name", "office_address"], url_button_param: null, quick_reply_action: null, when_status: null, when_cancel_reason: null } as RouteStep;
  const r = buildTemplateRequest(step, ctx, { manageToken: null, previousStartAt: null });
  assert("body" in r);
  const t = r.body.template as { components: { parameters: { text: string }[] }[] };
  assertEquals(t.components[0].parameters.map((p) => p.text), ["Ana López", "Calle 1 CDMX"]);

  const blank = buildTemplateRequest(step, { ...ctx, office_address: "  \t " }, { manageToken: null, previousStartAt: null });
  assertEquals(blank, { error: "missing_value_office_address" });
});

function clinic(officeAddress: string | null) {
  const now = Date.now();
  return new FakeDb({
    message_routes: [
      { event_type: "appointment.reminder_48h", owner: "findmed" },
      { event_type: "appointment.status_changed", owner: "findmed" },
    ],
    message_route_steps: [
      {
        id: "s1", event_type: "appointment.reminder_48h", position: 1, template_name: "dosdias_pre_confirmacion", language: "es_MX",
        body_params: ["patient_name", "office_address"], url_button_param: null, quick_reply_action: null, when_status: null, when_cancel_reason: null, enabled: true,
      },
      {
        id: "s2", event_type: "appointment.status_changed", position: 1, template_name: "confirmada_estado_cita", language: "es_MX",
        body_params: ["patient_name"], url_button_param: null, quick_reply_action: null, when_status: "confirmed", when_cancel_reason: null, enabled: true,
      },
    ],
    patients: [{ id: "p1", full_name: "Paciente Prueba", phone: "+525512345678" }],
    doctors: [{ id: "d1", full_name: "Dra. Prueba" }],
    doctor_offices: [{ id: "o1", name: "Consultorio Roma", address: officeAddress }],
    doctor_schedule_settings: [{ doctor_id: "d1", min_confirm_hours_before: 24 }],
    appointments: [{
      id: APPT, patient_id: "p1", doctor_id: "d1", office_id: "o1", status: "scheduled", cancel_reason: null,
      start_at: iso(now + 48 * H), end_at: iso(now + 48.5 * H),
    }],
    appointment_manage_tokens: [],
    domain_outbox: [],
    message_deliveries: [],
  });
}

async function queued(db: FakeDb, eventType: string, payload: Record<string, unknown>): Promise<OutboxRow> {
  await enqueueEvent(sb(db), eventType, payload);
  const row = db.rows("domain_outbox").at(-1)!;
  row.attempts = 1;
  return row as unknown as OutboxRow;
}

Deno.test("48 h reminder of an office without address goes out with the office name (9 offices in prod had none)", async () => {
  const db = clinic(null);
  const w = whaapy();
  const row = await queued(db, "appointment.reminder_48h", { appointment_id: APPT, start_at: "x" });
  assertEquals(await processOutboxRow(sb(db), w.client, row), "sent");
  const t = w.sent[0].template as { components: { parameters: { text: string }[] }[] };
  assertEquals(t.components[0].parameters.map((p) => p.text), ["Paciente Prueba", "Consultorio Roma"]);
});

Deno.test("staff created the appointment with 'Avisar al paciente' off → the confirmation is not sent", async () => {
  const db = clinic("Calle 1");
  db.rows("appointments")[0].status = "confirmed";
  const w = whaapy();
  const off = await queued(db, "appointment.status_changed", { appointment_id: APPT, new_status: "confirmed", start_at: "a", notify_patient: false });
  assertEquals(await processOutboxRow(sb(db), w.client, off), "skipped");
  assertEquals(w.sent.length, 0);
  assertEquals(db.rows("domain_outbox").at(-1)!.last_error, "patient_notification_disabled");

  // With the box ticked (or any event without the flag) it goes out as before.
  const on = await queued(db, "appointment.status_changed", { appointment_id: APPT, new_status: "confirmed", start_at: "b", notify_patient: true });
  assertEquals(await processOutboxRow(sb(db), w.client, on), "sent");
  assertEquals(w.sent.length, 1);
});

// ---------------------------------------------------------------------------
// External calendar: FindMed's own events are not "busy"

const busy = (eventId: string | null, source: "google" | "outlook" = "google"): BusyInterval => ({
  startMs: 0, endMs: 1, source, allDay: false, summary: "Cita: X", eventId,
});

Deno.test("withoutFindMedEvents drops appointment events (any status) and keeps the doctor's own events", async () => {
  const db = new FakeDb({
    appointments: [
      { id: "a1", status: "cancelled", google_event_id: "g-ghost", outlook_event_id: null },
      { id: "a2", status: "confirmed", google_event_id: null, outlook_event_id: "o-live" },
    ],
  });
  const out = await withoutFindMedEvents(sb(db), [busy("g-ghost"), busy("g-personal"), busy(null), busy("o-live", "outlook"), busy("g-ghost", "outlook")]);
  assertEquals(out.map((b) => `${b.source}:${b.eventId}`), ["google:g-personal", "google:null", "outlook:g-ghost"]);
});

Deno.test("withoutFindMedEvents keeps everything if the lookup fails (blocking beats double-booking)", async () => {
  const failing = { from: () => ({ select: () => ({ in: () => Promise.resolve({ data: null, error: { message: "down" } }) }) }) };
  const all = [busy("g1"), busy("g2")];
  assertEquals(await withoutFindMedEvents(failing as unknown as SupabaseClient, all), all);
});

const DATE = "2027-03-01"; // a Monday far in the future
const at = (hm: string) => new Date(mxLocalToMs(DATE, hm)).toISOString();

function googleDb(appts: Record<string, unknown>[], doctor: Record<string, unknown> = { id: "d1", is_active: true, is_deleted: false }) {
  return new FakeDb({
    doctors: [doctor],
    doctor_offices: [{
      id: "o1", doctor_id: "d1", appointment_duration_minutes: 60, is_active: true, is_deleted: false,
      google_calendar_connected: true, google_calendar_id: "cal@example.com", google_refresh_token_ref: "refresh",
      outlook_calendar_connected: false, outlook_calendar_id: null, outlook_refresh_token_ref: null,
    }],
    doctor_schedule_settings: [{ doctor_id: "d1", min_confirm_hours_before: 24 }],
    doctor_weekly_availability: [{ office_id: "o1", weekday: 1, is_enabled: true, start_time: "09:00:00", end_time: "12:00:00" }],
    doctor_date_overrides: [],
    appointments: appts,
  });
}

function googleWith(items: unknown[]) {
  return stubFetch(200, (url) => {
    if (url.includes("oauth2.googleapis.com")) return { status: 200, body: { access_token: "at", expires_in: 3600 } };
    if (url.includes("googleapis.com/calendar")) return { status: 200, body: { items } };
  });
}

Deno.test("a cancelled appointment whose Google event was left behind no longer blocks that slot for patients", async () => {
  const appts = [{ id: "a1", doctor_id: "d1", office_id: "o1", status: "cancelled", start_at: at("10:00"), end_at: at("11:00"), google_event_id: "ev-a1" }];
  const f = googleWith([
    { id: "ev-a1", summary: "Cita: Paciente", start: { dateTime: at("10:00") }, end: { dateTime: at("11:00") } },
    { id: "ev-own", summary: "Junta", start: { dateTime: at("11:00") }, end: { dateTime: at("12:00") } },
  ]);
  try {
    const r = await computeDaySlots(sb(googleDb(appts)), "o1", DATE);
    assertEquals(r.ok && r.value.slots, ["09:00", "10:00"]); // 11:00 still blocked by the doctor's own event
  } finally {
    f.restore();
  }
});

Deno.test("moving an appointment 30 min later doesn't collide with its own Google event", async () => {
  const appts = [{ id: "a1", doctor_id: "d1", office_id: "o1", status: "confirmed", start_at: at("10:00"), end_at: at("11:00"), google_event_id: "ev-a1" }];
  const f = googleWith([{ id: "ev-a1", summary: "Cita: Paciente", start: { dateTime: at("10:00") }, end: { dateTime: at("11:00") } }]);
  try {
    const r = await validateSlotAvailable({
      supabase: sb(googleDb(appts)), doctorId: "d1", officeId: "o1", startAt: at("10:30"), endAt: at("11:30"), excludeAppointmentId: "a1",
    });
    assertEquals(r.available, true);
    assertEquals(r.external_calendar, "verified");
  } finally {
    f.restore();
  }
});

Deno.test("offices of a deactivated doctor are not offered (2 active offices of inactive doctors in prod)", async () => {
  const r = await computeDaySlots(sb(googleDb([], { id: "d1", is_active: false, is_deleted: false })), "o1", DATE);
  assertEquals(r.ok && r.value.availability_status, "office_unavailable");
});

// ---------------------------------------------------------------------------
// Staff reschedule (admin / doctor)

function moveDb(status: string, startInH: number) {
  const now = Date.now();
  return new FakeDb({
    appointments: [{
      id: APPT, status, start_at: iso(now + startInH * H), end_at: iso(now + (startInH + 0.5) * H),
      reminder_48h_sent_at: iso(now - H), reminder_day_of_sent_at: null,
    }],
    appointment_manage_tokens: [
      { id: "t-live", appointment_id: APPT, token: "live", expires_at: iso(now + (startInH + 0.5) * H) },
      { id: "t-old", appointment_id: APPT, token: "old", expires_at: iso(now - 24 * H) },
    ],
  });
}

Deno.test("cancelled and completed appointments can't be moved back into the agenda", async () => {
  assertEquals(isMovable("completed"), false);
  assertEquals(isMovable("cancelled"), false);
  for (const status of ["completed", "cancelled"]) {
    const db = moveDb(status, 72);
    const r = await moveAppointment(sb(db), { id: APPT, status }, iso(Date.now() + 100 * H), iso(Date.now() + 100.5 * H));
    assertEquals(r.ok ? "ok" : r.code, "not_movable");
    assertEquals(db.rows("appointments")[0].status, status);
  }
});

Deno.test("staff move: markers cleared, links follow the new end, scheduled inside 48 h becomes confirmed", async () => {
  const db = moveDb("scheduled", 72);
  const now = Date.now();
  const newStart = iso(now + 20 * H); // inside the doctor's 24 h confirmation window
  const newEnd = iso(now + 20.5 * H);
  const r = await moveAppointment(sb(db), { id: APPT, status: "scheduled" }, newStart, newEnd, now);
  assertEquals(r, { ok: true, status: "confirmed", auto_confirmed: true });
  const a = db.rows("appointments")[0];
  assertEquals([a.start_at, a.end_at, a.status], [newStart, newEnd, "confirmed"]);
  assertEquals([a.reminder_48h_sent_at, a.reminder_day_of_sent_at], [null, null]);
  const tokens = Object.fromEntries(db.rows("appointment_manage_tokens").map((t) => [t.id, t.expires_at]));
  assertEquals(tokens["t-live"], newEnd);
  assert(String(tokens["t-old"]) < iso(now)); // an expired link is not revived

  // Far away: stays scheduled (the 48 h reminder will ask the patient to confirm).
  const far = moveDb("scheduled", 72);
  const r2 = await moveAppointment(sb(far), { id: APPT, status: "scheduled" }, iso(now + 200 * H), iso(now + 200.5 * H), now);
  assertEquals(r2.ok && r2.status, "scheduled");
});

Deno.test("staff move loses against a concurrent cancellation instead of overwriting it", async () => {
  const db = moveDb("confirmed", 72);
  db.beforeUpdate = (table) => {
    if (table === "appointments") db.rows("appointments")[0].status = "cancelled"; // patient cancelled meanwhile
  };
  const r = await moveAppointment(sb(db), { id: APPT, status: "confirmed" }, iso(Date.now() + 100 * H), iso(Date.now() + 100.5 * H));
  assertEquals(r.ok ? "ok" : r.code, "concurrent_change");
  assertEquals(db.rows("appointments")[0].status, "cancelled");
});

// ---------------------------------------------------------------------------
// Patient reschedule claim (manage-reschedule)

Deno.test("reschedule claim: all links move to the new appointment once; a second concurrent reschedule gets 0", async () => {
  const db = new FakeDb({
    appointment_manage_tokens: [
      { id: "t1", appointment_id: "old", token: "booking-link", expires_at: "2026-10-20T00:00:00Z" },
      { id: "t2", appointment_id: "old", token: "auto-cancel-link", expires_at: "2026-10-16T00:00:00Z" },
      { id: "t3", appointment_id: "other", token: "x", expires_at: "2026-10-20T00:00:00Z" },
    ],
  });
  assertEquals(await repointManageTokens(sb(db), "old", "new-a", "2026-10-30T16:30:00Z"), 2);
  assertEquals(await repointManageTokens(sb(db), "old", "new-b", "2026-10-31T16:30:00Z"), 0); // loser rolls back
  const byId = Object.fromEntries(db.rows("appointment_manage_tokens").map((t) => [t.id, [t.appointment_id, t.expires_at]]));
  assertEquals(byId.t1, ["new-a", "2026-10-30T16:30:00Z"]);
  assertEquals(byId.t2, ["new-a", "2026-10-30T16:30:00Z"]);
  assertEquals(byId.t3, ["other", "2026-10-20T00:00:00Z"]);
});

// ---------------------------------------------------------------------------
// Reminder crons

Deno.test("a failed reminder dispatch releases only its own claim", async () => {
  const db = new FakeDb({
    appointments: [
      { id: "a1", reminder_48h_sent_at: "2026-10-14T10:05:00.000Z" },
      { id: "a2", reminder_48h_sent_at: "2026-10-14T11:05:00.000Z" }, // claimed by a later run
    ],
  });
  assertEquals(await releaseReminderClaim(sb(db), "a1", "reminder_48h_sent_at", "2026-10-14T10:05:00.000Z"), true);
  assertEquals(await releaseReminderClaim(sb(db), "a2", "reminder_48h_sent_at", "2026-10-14T10:05:00.000Z"), false);
  assertEquals(db.rows("appointments").map((a) => a.reminder_48h_sent_at), [null, "2026-10-14T11:05:00.000Z"]);
});

// ---------------------------------------------------------------------------
// Patient cases: a status change never leaves a case without owner and out of the SLA

function caseDb(extra: Record<string, unknown> = {}) {
  return new FakeDb({
    patient_cases: [{
      id: "c1", request_type: "studies", subject_phone: "+525512345678", status: "awaiting_assignment", priority: "urgent",
      summary: "Estudios", assigned_user_id: null, assigned_at: null, ai_state: "paused", whaapy_assignment: "none",
      whaapy_conversation_id: null, whaapy_contact_id: null, alert_level: 3, last_alert_at: "2026-10-14T10:00:00Z",
      created_at: "2026-10-14T09:00:00Z", updated_at: "2026-10-14T09:00:00Z", ...extra,
    }],
    case_events: [],
  });
}
const staff = { userId: "u1", email: "ana@example.com" };

Deno.test("'Asignado'/'Esperando…' without taking the case is refused (it silently left the SLA queue)", async () => {
  const db = caseDb();
  for (const status of ["assigned", "awaiting_patient", "awaiting_provider"] as const) {
    const r = await applyStaffAction(sb(db), whaapy().client, "c1", staff, { action: "update", status });
    assertEquals(r.ok ? "ok" : r.code, "take_first");
  }
  assertEquals(db.rows("patient_cases")[0].status, "awaiting_assignment");
});

Deno.test("back to 'Sin asignar' releases the owner and restarts the SLA alerts", async () => {
  const db = caseDb({ status: "awaiting_provider", assigned_user_id: "u9", assigned_at: "2026-10-14T09:30:00Z" });
  const before = Date.now();
  const r = await applyStaffAction(sb(db), whaapy().client, "c1", staff, { action: "update", status: "awaiting_assignment" });
  assert(r.ok);
  const c = db.rows("patient_cases")[0];
  assertEquals([c.status, c.assigned_user_id, c.assigned_at, c.alert_level], ["awaiting_assignment", null, null, 0]);
  assert(Date.parse(String(c.last_alert_at)) >= before - 1000);

  // With an owner, moving between working states is still allowed.
  const owned = caseDb({ status: "assigned", assigned_user_id: "u1" });
  const ok = await applyStaffAction(sb(owned), whaapy().client, "c1", staff, { action: "update", status: "awaiting_patient" });
  assert(ok.ok);
  assertEquals(owned.rows("patient_cases")[0].status, "awaiting_patient");
});
