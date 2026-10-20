// Garantía 20-oct-2026 (G1–G3): WHAAPY contact sync, the titular is never
// renamed by a booking for a relative (appointments.patient_name), and the
// admin "contact" edit (name, phone, who is attended). The migration
// 20261020130000 is replayed on PGlite with the real column guard of
// 20261014160000.
//
//   npm run test:edge

import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.3.15";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { WhaapyClient, WhaapyContactPatch, WhaapyConversation, WhaapyResult } from "../functions/_shared/whaapy-client.ts";
import { createWhaapyClient } from "../functions/_shared/whaapy-client.ts";
import {
  buildContactPatch,
  contactNameIsAutomatic,
  runInBackground,
  syncWhaapyContact,
  WHAAPY_CONTACT_FIELDS,
} from "../functions/_shared/whaapy-contact-sync.ts";
import { attendedName, isPlaceholderName, matchOrCreatePatient } from "../functions/_shared/patient-identity.ts";
import { createReservationSession } from "../functions/_shared/booking-session.ts";
import { loadAppointmentContext } from "../functions/_shared/messaging.ts";
import { handlePatientInsurance } from "../functions/admin-update-patient-insurance/handler.ts";
import { FakeDb, stubFetch } from "./fake-supabase.ts";

Deno.env.set("APP_URL", "https://app.example.test");

const sb = (db: FakeDb) => db as unknown as SupabaseClient;
const ok = <T>(data: T): WhaapyResult<T> => ({ ok: true, status: 200, data });

const PID = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER_PID = "aaaaaaaa-0000-4000-8000-000000000002";
const APPT = "bbbbbbbb-0000-4000-8000-000000000001";
const APPT_KID = "bbbbbbbb-0000-4000-8000-000000000002";
const APPT_OTHER = "bbbbbbbb-0000-4000-8000-000000000003";
const PHONE = "+525512345678";

/** Fake WHAAPY whose contact snapshot each test controls; records PATCH bodies. */
function fakeWhaapy(contact: WhaapyConversation["contact"], over: Partial<WhaapyClient> = {}) {
  const patches: { id: string; patch: WhaapyContactPatch }[] = [];
  const lookups: string[] = [];
  const client = {
    configured: true,
    conversationByPhone: (phone: string) => {
      lookups.push(phone);
      return Promise.resolve(ok<WhaapyConversation | null>({ id: "conv-1", contact_id: "contact-1", ai_enabled: true, contact }));
    },
    updateContact: (id: string, patch: WhaapyContactPatch) => {
      patches.push({ id, patch });
      return Promise.resolve(ok({}));
    },
    ...over,
  } as unknown as WhaapyClient;
  return { client, patches, lookups };
}

const patientRow = (over: Record<string, unknown> = {}) => ({
  id: PID,
  full_name: "María López",
  phone: PHONE,
  has_insurance: true,
  insurer: "GNP",
  policy_number: "AB-123",
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

// --- G1: WHAAPY contact sync ----------------------------------------------------

Deno.test("G1: field keys are the WHAAPY field definitions read on 20-oct", () => {
  assertEquals(WHAAPY_CONTACT_FIELDS, {
    fullName: "findmed_nombre_completo",
    insurer: "findmed_aseguradora",
    policyNumber: "findmed_numero_poliza",
  });
});

Deno.test("G1: an automatic contact name (WhatsApp profile, phone, empty, ours) is replaced; a manual one is kept", () => {
  assert(contactNameIsAutomatic({ name: "Mary ✨", wa_name: "Mary ✨", custom_fields: {} }));
  assert(contactNameIsAutomatic({ name: "+52 55 1234 5678", wa_name: "Mary", custom_fields: {} }));
  assert(contactNameIsAutomatic({ name: "", wa_name: null, custom_fields: {} }));
  assert(contactNameIsAutomatic({ name: "María Lopez", wa_name: "Mary", custom_fields: { findmed_nombre_completo: "maría lopez" } }));
  assertEquals(contactNameIsAutomatic({ name: "Sra. María (mamá de Juanito)", wa_name: "Mary", custom_fields: {} }), false);

  const patient = patientRow();
  const auto = buildContactPatch({ name: "Mary", wa_name: "Mary", custom_fields: {} }, patient);
  assertEquals(auto, {
    name: "María López",
    custom_fields: { findmed_nombre_completo: "María López", findmed_aseguradora: "GNP", findmed_numero_poliza: "AB-123" },
  });
  const manual = buildContactPatch({ name: "Sra. María VIP", wa_name: "Mary", custom_fields: {} }, patient);
  assertEquals(manual?.name, undefined);
  assertEquals(Object.keys(manual?.custom_fields ?? {}).sort(), ["findmed_aseguradora", "findmed_nombre_completo", "findmed_numero_poliza"]);
});

Deno.test("G1: only changed fields are sent; nothing changed → no PATCH; 'Sin seguro' clears the policy", () => {
  const up = { name: "María López", wa_name: "Mary", custom_fields: { findmed_nombre_completo: "María López", findmed_aseguradora: "GNP", findmed_numero_poliza: "AB-123" } };
  assertEquals(buildContactPatch(up, patientRow()), null);
  assertEquals(buildContactPatch(up, patientRow({ has_insurance: false, insurer: null, policy_number: null })), {
    custom_fields: { findmed_aseguradora: "Sin seguro", findmed_numero_poliza: "" },
  });
  // Not captured: insurance fields untouched. Placeholder titular: no name.
  assertEquals(buildContactPatch({ name: "Mary", wa_name: "Mary", custom_fields: {} }, patientRow({ full_name: "Paciente", has_insurance: null })), null);
  // No patient, but open_case gave a name.
  assertEquals(buildContactPatch({ name: "Mary", wa_name: "Mary", custom_fields: {} }, null, "  Juan   Pérez "), {
    name: "Juan Pérez",
    custom_fields: { findmed_nombre_completo: "Juan Pérez" },
  });
});

Deno.test("G1: syncWhaapyContact reads the patient, looks up the contact and patches it", async () => {
  const db = new FakeDb({ patients: [patientRow()] });
  const w = fakeWhaapy({ name: "Mary", wa_name: "Mary", custom_fields: { findmed_ciudad: "CDMX" } });
  const r = await syncWhaapyContact(sb(db), w.client, { patientId: PID });
  assertEquals(r, {
    ok: true,
    status: "updated",
    contact_id: "contact-1",
    name_written: true,
    fields: ["findmed_nombre_completo", "findmed_aseguradora", "findmed_numero_poliza"],
  });
  assertEquals(w.lookups, [PHONE]);
  assertEquals(w.patches[0].id, "contact-1");
  assertEquals(w.patches[0].patch.name, "María López");

  // By phone (any format) when there's no patient id.
  const w2 = fakeWhaapy({ name: "Sra. María VIP", wa_name: "Mary", custom_fields: {} });
  const r2 = await syncWhaapyContact(sb(db), w2.client, { phone: "55 1234 5678" });
  assert(r2.ok && r2.name_written === false);
  assertEquals(w2.patches[0].patch.name, undefined);
});

Deno.test("G1: syncWhaapyContact never throws and skips cleanly", async () => {
  const db = new FakeDb({ patients: [patientRow()] });
  const throwing = fakeWhaapy(null, { conversationByPhone: () => Promise.reject(new Error("boom")) });
  assertEquals(await syncWhaapyContact(sb(db), throwing.client, { patientId: PID }), { ok: false, status: "failed", reason: "Error" });

  const down = fakeWhaapy(null, { conversationByPhone: () => Promise.resolve({ ok: false, status: 503, error: "down" }) });
  assertEquals((await syncWhaapyContact(sb(db), down.client, { patientId: PID })).status, "failed");

  const patchFails = fakeWhaapy({ name: "", wa_name: null, custom_fields: {} }, {
    updateContact: () => Promise.resolve({ ok: false, status: 422, error: "bad" }),
  });
  assertEquals(await syncWhaapyContact(sb(db), patchFails.client, { patientId: PID }), { ok: false, status: "failed", reason: "update_422" });

  const noContact = fakeWhaapy(null, { conversationByPhone: () => Promise.resolve(ok(null)) });
  assertEquals(await syncWhaapyContact(sb(db), noContact.client, { patientId: PID }), { ok: false, status: "skipped", reason: "no_contact" });

  const off = { configured: false } as unknown as WhaapyClient;
  assertEquals((await syncWhaapyContact(sb(db), off, { patientId: PID })).status, "skipped");
  const w = fakeWhaapy(null);
  assertEquals(await syncWhaapyContact(sb(db), w.client, { phone: "+525500000000" }), { ok: false, status: "skipped", reason: "no_patient" });

  const brokenDb = { from: () => { throw new Error("db down"); } } as unknown as SupabaseClient;
  assertEquals((await syncWhaapyContact(brokenDb, w.client, { patientId: PID })).ok, false);
});

Deno.test("G1: the real client maps the contact snapshot and sends name + custom_fields in the PATCH", async () => {
  const f = stubFetch(200, (url) => {
    if (url.includes("/by-phone/")) {
      return { status: 200, body: { data: { id: "c1", contact: { id: "k1", name: "Mary", waName: "Mary", customFields: { findmed_aseguradora: "GNP" } } } } };
    }
  });
  try {
    const client = createWhaapyClient({ apiKey: "wha_test", baseUrl: "https://api.example.test" });
    const db = new FakeDb({ patients: [patientRow()] });
    const r = await syncWhaapyContact(sb(db), client, { patientId: PID });
    assert(r.ok);
    const patch = f.calls.find((c) => c.url.endsWith("/contacts/v1/k1"));
    assertEquals(patch?.body, {
      name: "María López",
      custom_fields: { findmed_nombre_completo: "María López", findmed_numero_poliza: "AB-123" },
    });
    assertEquals(JSON.stringify(f.calls).includes("wha_test"), false);
  } finally {
    f.restore();
  }
});

Deno.test("G1: runInBackground hands the task to EdgeRuntime.waitUntil when present and never rejects", async () => {
  const g = globalThis as { EdgeRuntime?: unknown };
  const waited: Promise<unknown>[] = [];
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => waited.push(p) };
  try {
    await runInBackground(Promise.reject(new Error("x")));
    assertEquals(waited.length, 1);
    await waited[0];
  } finally {
    delete g.EdgeRuntime;
  }
  await runInBackground(Promise.reject(new Error("y"))); // awaited without the runtime, no throw
});

// --- G2: booking for a relative does not rename the titular ------------------------

Deno.test("G2: placeholders and the attended-name fallback", () => {
  assert(isPlaceholderName("Paciente"));
  assert(isPlaceholderName("  "));
  assert(isPlaceholderName("+52 55 1234 5678"));
  assertEquals(isPlaceholderName("Juan"), false);
  assertEquals(attendedName(" Juanito  López ", "María López"), "Juanito López");
  assertEquals(attendedName(null, "María López"), "María López");
  assertEquals(attendedName("", null), null);
});

Deno.test("G2: a booking link for a relative keeps the titular and carries who is attended", async () => {
  const db = new FakeDb({
    doctors: [{ id: "d1", full_name: "Dra. Ana", is_active: true, is_deleted: false }],
    doctor_offices: [{ id: "o1", doctor_id: "d1", name: "Roma", address: "Calle 1", is_active: true, is_deleted: false }],
    patients: [patientRow()],
    reservation_sessions: [],
  });
  const r = await createReservationSession(sb(db), {
    doctorId: "d1",
    officeId: "o1",
    patientName: "Juanito López",
    patientPhone: "+52 1 55 1234 5678",
  });
  assert(r.ok);
  assertEquals(r.patient_id, PID);
  assertEquals(db.rows("patients").length, 1);
  assertEquals(db.rows("patients")[0].full_name, "María López"); // NOT renamed
  assertEquals(db.rows("reservation_sessions")[0].patient_name, "Juanito López");
});

Deno.test("G2: matchOrCreatePatient fills a placeholder name but never renames a real one; creates new patients", async () => {
  const db = new FakeDb({ patients: [patientRow({ full_name: "Paciente" })] });
  const filled = await matchOrCreatePatient(sb(db), { canonicalPhone: PHONE, name: "María López" });
  assert(filled.ok && !filled.created);
  assertEquals(db.rows("patients")[0].full_name, "María López");

  const kid = await matchOrCreatePatient(sb(db), { canonicalPhone: PHONE, name: "Juanito López" });
  assert(kid.ok);
  assertEquals([kid.titularName, db.rows("patients")[0].full_name], ["María López", "María López"]);

  const fresh = await matchOrCreatePatient(sb(db), { canonicalPhone: "+525599990000", name: "Pedro" });
  assert(fresh.ok && fresh.created);
  assertEquals(db.rows("patients").length, 2);
});

Deno.test("G2: WhatsApp templates greet who is attended in that appointment", async () => {
  const db = new FakeDb({
    appointments: [{
      id: APPT_KID, status: "scheduled", cancel_reason: null, start_at: "2026-11-01T16:00:00Z", end_at: "2026-11-01T16:30:00Z",
      doctor_id: "d1", office_id: null, patient_id: PID, patient_name: "Juanito López",
    }, {
      id: APPT, status: "scheduled", cancel_reason: null, start_at: "2026-11-02T16:00:00Z", end_at: "2026-11-02T16:30:00Z",
      doctor_id: "d1", office_id: null, patient_id: PID,
    }],
    patients: [patientRow()],
    doctors: [{ id: "d1", full_name: "Dra. Ana" }],
    doctor_schedule_settings: [],
  });
  const kid = await loadAppointmentContext(sb(db), APPT_KID);
  assertEquals([kid?.patient_name, kid?.patient_phone], ["Juanito López", PHONE]);
  const own = await loadAppointmentContext(sb(db), APPT); // legacy row without patient_name
  assertEquals(own?.patient_name, "María López");
});

// --- G3: admin edits the contact -----------------------------------------------------

function contactDb() {
  return new FakeDb({
    patients: [patientRow(), patientRow({ id: OTHER_PID, full_name: "Otro", phone: "+525511112222" })],
    appointments: [
      { id: APPT, patient_id: PID, patient_name: "María López" },
      { id: APPT_KID, patient_id: PID, patient_name: "Juanito López" },
      { id: APPT_OTHER, patient_id: OTHER_PID, patient_name: "Otro" },
    ],
  });
}

const post = (db: FakeDb, body: unknown, whaapy?: WhaapyClient, authorized = true) =>
  handlePatientInsurance(new Request("https://x", { method: "POST", body: JSON.stringify(body) }), {
    supabase: sb(db),
    authorize: () => Promise.resolve(authorized ? { ok: true as const, userId: "admin-1" } : { ok: false as const, status: 403, error: "Forbidden" }),
    whaapy,
  });

Deno.test("G3: contact edit renames the titular (and only the titular's appointments) and syncs WHAAPY", async () => {
  const db = contactDb();
  const w = fakeWhaapy({ name: "Mary", wa_name: "Mary", custom_fields: {} });
  const res = await post(db, { action: "contact", patient_id: PID, full_name: "  María  López Ruiz ", phone: "55 1234 5678" }, w.client);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).patient, { id: PID, full_name: "María López Ruiz", phone: PHONE });
  assertEquals(db.rows("patients")[0].full_name, "María López Ruiz");
  const names = Object.fromEntries(db.rows("appointments").map((a) => [a.id, a.patient_name]));
  assertEquals(names[APPT], "María López Ruiz"); // was the titular's own
  assertEquals(names[APPT_KID], "Juanito López"); // a relative's appointment keeps its name
  assertEquals(names[APPT_OTHER], "Otro");
  assertEquals(w.patches[0].patch.name, "María López Ruiz");
});

Deno.test("G3: phone already owned by another patient → 409 phone_taken, nothing changes", async () => {
  const db = contactDb();
  const res = await post(db, { action: "contact", patient_id: PID, phone: "+52 1 55 1111 2222" });
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error, "phone_taken");
  assertEquals(db.rows("patients")[0].phone, PHONE);

  assertEquals((await post(db, { action: "contact", patient_id: PID, phone: "123" })).status, 400);
  assertEquals((await post(db, { action: "contact", patient_id: PID, full_name: "J" })).status, 400);
  assertEquals((await post(db, { action: "contact", patient_id: PID })).status, 400);
  assertEquals((await post(db, { action: "contact", patient_id: PID, full_name: "Ok Name" }, undefined, false)).status, 403);
  assertEquals((await post(db, { action: "nope", patient_id: PID })).status, 400);
});

Deno.test("G3: who is attended in an appointment is editable; blank = the titular; another patient's appointment → 404", async () => {
  const db = contactDb();
  const res = await post(db, { action: "contact", patient_id: PID, appointment_id: APPT_KID, appointment_patient_name: "Juan Pablo López" });
  assertEquals(res.status, 200);
  assertEquals((await res.json()).appointment, { id: APPT_KID, patient_name: "Juan Pablo López" });
  assertEquals(db.rows("patients")[0].full_name, "María López");

  const blank = await post(db, { action: "contact", patient_id: PID, appointment_id: APPT_KID, appointment_patient_name: "" });
  assertEquals((await blank.json()).appointment.patient_name, null);

  const foreign = await post(db, { action: "contact", patient_id: PID, appointment_id: APPT_OTHER, appointment_patient_name: "X Y" });
  assertEquals(foreign.status, 404);
  assertEquals(db.rows("appointments")[2].patient_name, "Otro");
});

Deno.test("G1: the insurance action still works and syncs the contact", async () => {
  const db = contactDb();
  const w = fakeWhaapy({ name: "Mary", wa_name: "Mary", custom_fields: { findmed_aseguradora: "GNP", findmed_numero_poliza: "AB-123" } });
  const res = await post(db, { patient_id: PID, has_insurance: false }, w.client);
  assertEquals(res.status, 200);
  assertEquals(w.patches[0].patch.custom_fields, {
    findmed_nombre_completo: "María López",
    findmed_aseguradora: "Sin seguro",
    findmed_numero_poliza: "",
  });
});

// --- Migration 20261020130000 on PGlite ------------------------------------------------

const MIGRATION = await Deno.readTextFile(new URL("../migrations/20261020130000_appointment_patient_name.sql", import.meta.url));
const HARDENING = await Deno.readTextFile(new URL("../migrations/20261014160000_security_hardening.sql", import.meta.url));
// The real column guard for non-admin sessions (section 6 of the hardening migration).
const GUARD = HARDENING.slice(
  HARDENING.indexOf("CREATE OR REPLACE FUNCTION public.guard_client_appointment_update()"),
  HARDENING.indexOf("CREATE OR REPLACE FUNCTION public.guard_client_doctor_update()"),
);

const u = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

async function migratedDb() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE authenticated NOLOGIN;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth, public TO authenticated;
    CREATE TABLE user_roles (user_id uuid, role text);
    CREATE FUNCTION public.is_admin_or_superadmin(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = public AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','superadmin')) $$;
    CREATE TABLE patients (id uuid PRIMARY KEY, full_name text NOT NULL, phone text UNIQUE);
    CREATE TABLE appointments (
      id uuid PRIMARY KEY, patient_id uuid REFERENCES patients(id), status text NOT NULL DEFAULT 'scheduled',
      doctor_notes text, doctor_notes_updated_at timestamptz, updated_at timestamptz);
    CREATE TABLE reservation_sessions (id uuid PRIMARY KEY, patient_id uuid REFERENCES patients(id), token text);
    GRANT SELECT, UPDATE ON appointments, reservation_sessions TO authenticated;
    INSERT INTO user_roles VALUES ('${u(1)}', 'admin');
    INSERT INTO patients VALUES ('${u(41)}', 'María López', '+525512345678'), ('${u(42)}', '  ', '+525500000000');
    INSERT INTO appointments (id, patient_id) VALUES ('${u(31)}', '${u(41)}'), ('${u(32)}', '${u(42)}'), ('${u(33)}', NULL);
  `);
  await db.exec(GUARD);
  await db.exec(MIGRATION);
  return db;
}

async function as(db: PGlite, uid: string, sql: string) {
  await db.exec(`SET ROLE authenticated; SELECT set_config('test.uid', '${uid}', false);`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec("RESET ROLE; SELECT set_config('test.uid', '', false);");
  }
}

Deno.test("migration 20261020130000: backfill, length check, doctor can't change it, admin can, idempotent", async () => {
  const db = await migratedDb();
  const names = async () =>
    Object.fromEntries((await db.query<{ id: string; patient_name: string | null }>("SELECT id, patient_name FROM appointments")).rows.map((r) => [r.id, r.patient_name]));
  assertEquals(await names(), { [u(31)]: "María López", [u(32)]: null, [u(33)]: null });

  await db.exec(MIGRATION); // idempotent
  assertEquals((await names())[u(31)], "María López");

  await assertRejects(() => db.exec(`UPDATE appointments SET patient_name = '   ' WHERE id = '${u(31)}'`));
  await assertRejects(() => db.exec(`UPDATE appointments SET patient_name = repeat('x', 161) WHERE id = '${u(31)}'`));
  await db.exec(`INSERT INTO reservation_sessions (id, patient_id, token, patient_name) VALUES ('${u(51)}', '${u(41)}', 't', 'Juanito')`);
  await assertRejects(() => db.exec(`UPDATE reservation_sessions SET patient_name = '' WHERE id = '${u(51)}'`));

  // A doctor (non-admin authenticated) can't rename who is attended; notes still work.
  const err = await assertRejects(() => as(db, u(2), `UPDATE appointments SET patient_name = 'Otro' WHERE id = '${u(31)}'`)) as { code?: string };
  assertEquals(err.code, "42501");
  await as(db, u(2), `UPDATE appointments SET doctor_notes = 'ok' WHERE id = '${u(31)}'`);
  await as(db, u(1), `UPDATE appointments SET patient_name = 'Juanito López' WHERE id = '${u(31)}'`);
  assertEquals((await names())[u(31)], "Juanito López");
  await db.close();
});
