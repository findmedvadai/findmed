// R26, R27, R28-adjacent, R35: patient confirm/cancel through the shared domain.
//
//   npm run test:edge

import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyPatientAction, findUpcomingAppointmentsByPhone } from "../functions/_shared/appointment-actions.ts";
import { FakeDb, stubFetch } from "./fake-supabase.ts";

Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ default: "sb_secret_test" }));
Deno.env.set("APP_URL", "https://app.example.test");

const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

function seed(extra: Record<string, unknown> = {}) {
  const now = Date.now();
  return new FakeDb({
    patients: [{ id: "p1", full_name: "Paciente Prueba", phone: "+525512345678" }],
    appointments: [{
      id: "a1",
      status: "scheduled",
      doctor_id: "d1",
      office_id: null,
      patient_id: "p1",
      start_at: iso(now + 72 * H),
      end_at: iso(now + 72.5 * H),
      google_event_id: null,
      outlook_event_id: null,
      ...extra,
    }],
    appointment_manage_tokens: [{ token: "tok1", appointment_id: "a1", expires_at: iso(now + 100 * H), created_at: iso(now) }],
    notifications: [],
  });
}
const sb = (db: FakeDb) => db as unknown as SupabaseClient;

Deno.test("confirm: scheduled → confirmed, notifies doctor and emits both events", async () => {
  const db = seed();
  const f = stubFetch();
  try {
    const r = await applyPatientAction(sb(db), { appointmentId: "a1", action: "confirm", channel: "whatsapp" });
    assertEquals(r.ok, true);
    assertEquals(db.rows("appointments")[0].status, "confirmed");
    assertEquals(db.rows("notifications").length, 1);
    const events = f.calls.map((c) => (c.body as { event_type: string }).event_type).sort();
    assertEquals(events, ["appointment.confirmed", "appointment.status_changed"]);
    const payload = (f.calls[0].body as { payload: Record<string, unknown> }).payload;
    assertEquals(payload.manage_url, "https://app.example.test/gestionar?token=tok1");
    assertEquals(payload.patient_phone, "+525512345678");
  } finally {
    f.restore();
  }
});

Deno.test("cancel: sets reason=patient and is idempotent-safe on repeat", async () => {
  const db = seed({ status: "confirmed" });
  const f = stubFetch();
  try {
    const r = await applyPatientAction(sb(db), { appointmentId: "a1", action: "cancel", channel: "web" });
    assertEquals(r.ok, true);
    assertEquals(db.rows("appointments")[0].status, "cancelled");
    assertEquals(db.rows("appointments")[0].cancel_reason, "patient");
    const again = await applyPatientAction(sb(db), { appointmentId: "a1", action: "cancel", channel: "web" });
    assertEquals(again.ok === false && again.code, "already_cancelled");
  } finally {
    f.restore();
  }
});

Deno.test("guards: already confirmed, past, completed, unknown id", async () => {
  const f = stubFetch();
  try {
    let r = await applyPatientAction(sb(seed({ status: "confirmed" })), { appointmentId: "a1", action: "confirm", channel: "web" });
    assertEquals(r.ok === false && r.code, "already_confirmed");
    r = await applyPatientAction(sb(seed({ start_at: iso(Date.now() - H) })), { appointmentId: "a1", action: "cancel", channel: "web" });
    assertEquals(r.ok === false && r.code, "in_past");
    r = await applyPatientAction(sb(seed({ status: "completed" })), { appointmentId: "a1", action: "cancel", channel: "web" });
    assertEquals(r.ok === false && r.code, "invalid_state");
    r = await applyPatientAction(sb(seed()), { appointmentId: "nope", action: "cancel", channel: "web" });
    assertEquals(r.ok === false && r.code, "not_found");
    assertEquals(f.calls.length, 0); // no events for rejected actions
  } finally {
    f.restore();
  }
});

Deno.test("R35: a concurrent transition is not overwritten (guarded update)", async () => {
  const db = seed();
  // Simulate auto-cancel landing between our read and our write.
  db.beforeUpdate = () => {
    db.rows("appointments")[0].status = "cancelled";
    db.beforeUpdate = undefined;
  };
  const f = stubFetch();
  try {
    const r = await applyPatientAction(sb(db), { appointmentId: "a1", action: "confirm", channel: "whatsapp" });
    assertEquals(r.ok === false && r.code, "concurrent_change");
    assertEquals(db.rows("appointments")[0].status, "cancelled");
    assertEquals(f.calls.length, 0);
  } finally {
    f.restore();
  }
});

Deno.test("R26: phone lookup returns every upcoming appointment across duplicate patient rows", async () => {
  const now = Date.now();
  const db = new FakeDb({
    patients: [
      { id: "p1", phone: "+525512345678" },
      { id: "p2", phone: "+5215512345678" }, // legacy duplicate row, same handset
    ],
    appointments: [
      { id: "a1", patient_id: "p1", status: "scheduled", start_at: iso(now + 10 * H), end_at: iso(now + 11 * H), doctor_id: "d1", office_id: "o1" },
      { id: "a2", patient_id: "p2", status: "confirmed", start_at: iso(now + 20 * H), end_at: iso(now + 21 * H), doctor_id: "d2", office_id: "o2" },
      { id: "a3", patient_id: "p1", status: "cancelled", start_at: iso(now + 30 * H), end_at: iso(now + 31 * H), doctor_id: "d1", office_id: "o1" },
      { id: "a4", patient_id: "p1", status: "scheduled", start_at: iso(now - 5 * H), end_at: iso(now - 4 * H), doctor_id: "d1", office_id: "o1" },
    ],
  });
  const r = await findUpcomingAppointmentsByPhone(sb(db), ["+525512345678", "+5215512345678"]);
  assertEquals(r.ok && r.appointments.map((a) => a.appointment_id), ["a1", "a2"]);
});
