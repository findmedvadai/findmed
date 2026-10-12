// R19, R21-like, R28, X06, X07: prepared + idempotent patient actions.
//
//   npm run test:edge

import { assert, assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { commitAction, getOperation, prepareAction } from "../functions/_shared/operations.ts";
import { FakeDb, stubFetch } from "./fake-supabase.ts";

Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ default: "sb_secret_test" }));
Deno.env.set("APP_URL", "https://app.example.test");

const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const PHONE = "55 1234 5678";
const OTHER = "55 9999 0000";

function clinic() {
  const now = Date.now();
  return new FakeDb({
    patients: [
      { id: "p1", full_name: "Paciente", phone: "+525512345678" },
      { id: "p2", full_name: "Otra", phone: "+525599990000" },
    ],
    doctors: [{ id: "d1", full_name: "Dra. Prueba" }],
    doctor_offices: [{ id: "o1", name: "Consultorio Centro", address: "Calle 1" }],
    appointments: [
      { id: "a1", patient_id: "p1", doctor_id: "d1", office_id: "o1", status: "scheduled", start_at: iso(now + 72 * H), end_at: iso(now + 72.5 * H), google_event_id: null, outlook_event_id: null },
      { id: "a2", patient_id: "p2", doctor_id: "d1", office_id: "o1", status: "scheduled", start_at: iso(now + 80 * H), end_at: iso(now + 80.5 * H), google_event_id: null, outlook_event_id: null },
    ],
    appointment_manage_tokens: [{ token: "tok1", appointment_id: "a1", expires_at: iso(now + 100 * H), created_at: iso(now) }],
    operation_requests: [],
    notifications: [],
  });
}
const sb = (db: FakeDb) => db as unknown as SupabaseClient;

Deno.test("prepare: summary + manage_url, nothing changes; preparing again reuses the intent", async () => {
  const db = clinic();
  const a = await prepareAction(sb(db), { phone: PHONE, appointmentId: "a1", action: "cancel", channel: "mcp" });
  assert(a.ok);
  assertEquals(a.summary.office_name, "Consultorio Centro");
  assertEquals(a.manage_url, "https://app.example.test/gestionar?token=tok1");
  assertEquals(db.rows("appointments")[0].status, "scheduled");
  const b = await prepareAction(sb(db), { phone: PHONE, appointmentId: "a1", action: "cancel", channel: "mcp" });
  assert(b.ok);
  assertEquals(b.operation_id, a.operation_id);
  assertEquals(db.rows("operation_requests").length, 1);
});

Deno.test("X07/R28: another patient's appointment looks like not_found", async () => {
  const r = await prepareAction(sb(clinic()), { phone: PHONE, appointmentId: "a2", action: "cancel", channel: "mcp" });
  assertEquals(r.ok === false && r.code, "not_found");
});

Deno.test("X06/R19: commit executes once; a replay returns the stored result", async () => {
  const db = clinic();
  const f = stubFetch();
  try {
    const p = await prepareAction(sb(db), { phone: PHONE, appointmentId: "a1", action: "cancel", channel: "mcp" });
    assert(p.ok);
    const first = await commitAction(sb(db), { phone: PHONE, operationId: p.operation_id, evidence: { type: "chat_confirmation" } });
    assert("operation_id" in first);
    assertEquals([first.status, first.replayed], ["succeeded", false]);
    assertEquals(db.rows("appointments")[0].status, "cancelled");
    const eventsAfterFirst = f.calls.length;

    const replay = await commitAction(sb(db), { phone: PHONE, operationId: p.operation_id, evidence: { type: "chat_confirmation" } });
    assert("operation_id" in replay);
    assertEquals([replay.status, replay.replayed], ["succeeded", true]);
    assertEquals(f.calls.length, eventsAfterFirst); // no second notification/event
    assertEquals(db.rows("notifications").length, 1);
  } finally {
    f.restore();
  }
});

Deno.test("R28: a different phone can't commit or read someone else's operation", async () => {
  const db = clinic();
  const p = await prepareAction(sb(db), { phone: PHONE, appointmentId: "a1", action: "confirm", channel: "mcp" });
  assert(p.ok);
  const c = await commitAction(sb(db), { phone: OTHER, operationId: p.operation_id, evidence: { type: "chat_confirmation" } });
  assertEquals("code" in c && c.code, "not_found");
  const g = await getOperation(sb(db), { phone: OTHER, operationId: p.operation_id });
  assertEquals(g.ok === false && g.code, "not_found");
  assertEquals(db.rows("appointments")[0].status, "scheduled");
});

Deno.test("expired intent can't be committed", async () => {
  const db = clinic();
  const p = await prepareAction(sb(db), { phone: PHONE, appointmentId: "a1", action: "confirm", channel: "mcp" });
  assert(p.ok);
  db.rows("operation_requests")[0].expires_at = iso(Date.now() - 1000);
  const c = await commitAction(sb(db), { phone: PHONE, operationId: p.operation_id, evidence: { type: "chat_confirmation" } });
  assert("operation_id" in c);
  assertEquals(c.status, "expired");
  assertEquals(db.rows("appointments")[0].status, "scheduled");
  const g = await getOperation(sb(db), { phone: PHONE, operationId: p.operation_id });
  assertEquals(g.ok && g.status, "expired");
});

Deno.test("a concurrent claim loses cleanly (no double execution)", async () => {
  const db = clinic();
  const f = stubFetch();
  try {
    const p = await prepareAction(sb(db), { phone: PHONE, appointmentId: "a1", action: "confirm", channel: "mcp" });
    assert(p.ok);
    // Another worker claims it between our read and our claim.
    db.beforeUpdate = (table) => {
      if (table === "operation_requests") {
        db.rows("operation_requests")[0].status = "executing";
        db.beforeUpdate = undefined;
      }
    };
    const c = await commitAction(sb(db), { phone: PHONE, operationId: p.operation_id, evidence: { type: "chat_confirmation" } });
    assert("operation_id" in c);
    assertEquals([c.status, c.replayed], ["executing", true]);
    assertEquals(db.rows("appointments")[0].status, "scheduled"); // we did NOT execute
  } finally {
    f.restore();
  }
});
