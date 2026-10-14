// Etapa 2 — clasificación del tipo de manejo, disparadores post-consulta,
// "Nuevo caso" y reembolsos (case-actions), y la migración 20261014120000
// reproducida en PGlite sobre la de casos.
//
//   npm run test:edge

import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.3.15";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { openCase } from "../functions/_shared/cases.ts";
import {
  effectiveManagementType,
  mxShortDateTime,
  planRoutes,
  routePostConsultation,
  suggestManagementType,
} from "../functions/_shared/postconsult-routes.ts";
import { describeReimbursement, parseReimbursementFields } from "../functions/_shared/reimbursements.ts";
import type { WhaapyClient } from "../functions/_shared/whaapy-client.ts";
import { handleCaseActions } from "../functions/case-actions/handler.ts";
import { FakeDb, stubFetch } from "./fake-supabase.ts";

const PHONE = "+525512345678";
const APPT = "aaaaaaaa-0000-4000-8000-000000000001";
const PATIENT = "bbbbbbbb-0000-4000-8000-000000000001";
const DOCTOR = "cccccccc-0000-4000-8000-000000000001";
const STAFF = "11111111-aaaa-4aaa-8aaa-111111111111";
const NOW = Date.parse("2026-10-14T18:00:00Z");

const sb = (db: FakeDb) => db as unknown as SupabaseClient;

function newDb(form: Record<string, unknown> = {}) {
  return new FakeDb({
    patients: [{ id: PATIENT, phone: PHONE, full_name: "Ana Pérez" }],
    doctors: [{ id: DOCTOR, full_name: "Dra. Laura Gómez" }],
    appointments: [{ id: APPT, doctor_id: DOCTOR, patient_id: PATIENT, start_at: "2026-10-12T16:30:00Z" }],
    post_consultation_forms: [{ id: "form-1", appointment_id: APPT, doctor_id: DOCTOR, created_at: "2026-10-12T18:00:00Z", ...form }],
    patient_cases: [],
    case_events: [],
    post_consultation_case_links: [],
    users: [{ id: STAFF, email: "asesor@findmed.test" }],
  });
}
const cases = (db: FakeDb) => db.rows("patient_cases");
const byType = (db: FakeDb, t: string) => cases(db).find((c) => c.request_type === t)!;

// ---------------------------------------------------------------------------
// Clasificación

Deno.test("suggestion: hospitalization → procedimiento; studies or lab → estudios; nothing → conservador", () => {
  assertEquals(suggestManagementType({ hospitalization: "Hospital Ángeles", lab_tests: "BH" }), "procedimiento");
  assertEquals(suggestManagementType({ imaging_studies: "RX tórax" }), "estudios");
  assertEquals(suggestManagementType({ lab_tests: "Química sanguínea" }), "estudios");
  assertEquals(suggestManagementType({ prescribed_medications: "Paracetamol", specialist_referral: "Cardiología" }), "conservador");
  assertEquals(suggestManagementType({ imaging_studies: "   " }), "conservador"); // blank = not captured
  // The doctor's choice wins; legacy forms (no choice) fall back to the suggestion.
  assertEquals(effectiveManagementType({ management_type: "urgente", lab_tests: "BH" }), "urgente");
  assertEquals(effectiveManagementType({ management_type: null, hospitalization: "x" }), "procedimiento");
  assertEquals(effectiveManagementType({ management_type: "otro", lab_tests: "BH" }), "estudios");
});

Deno.test("planRoutes: one case per route, most urgent first", () => {
  const ctx = { doctorName: "Dra. Laura Gómez", when: "12/10/2026 10:30" };
  const types = (f: Parameters<typeof planRoutes>[0]) => planRoutes(f, ctx).map((r) => `${r.requestType}:${r.priority}`);

  assertEquals(types({ management_type: "conservador" }), ["follow_up:normal"]);
  assertEquals(types({ management_type: "estudios", lab_tests: "BH" }), ["studies:normal"]);
  assertEquals(types({ management_type: "procedimiento" }), ["procedure:high"]);
  assertEquals(types({ management_type: "urgente" }), ["urgency:urgent"]);
  assertEquals(
    types({ management_type: "urgente", hospitalization: "Urgencias HGZ", imaging_studies: "TAC", specialist_referral: "Neurología" }),
    ["urgency:urgent", "procedure:high", "studies:normal", "referral:normal"],
  );
  // Conservative management with labs requested anyway → follow-up AND studies.
  assertEquals(types({ management_type: "conservador", lab_tests: "BH" }), ["studies:normal", "follow_up:normal"]);

  const follow = planRoutes({ management_type: "conservador", prescribed_medications: "Ibuprofeno 400 mg c/8h" }, ctx)[0];
  assertEquals([follow.nextAction, follow.dueInDays], ["Llamar al paciente para seguimiento", 7]);
  assertEquals(follow.summary, "Post-consulta con Dra. Laura Gómez (12/10/2026 10:30). Manejo conservador: dar seguimiento al paciente. Medicamentos: Ibuprofeno 400 mg c/8h.");
  const studies = planRoutes({ management_type: "estudios", imaging_studies: "RX de tórax.", lab_tests: "BH" }, ctx)[0];
  assertEquals(studies.summary, "Post-consulta con Dra. Laura Gómez (12/10/2026 10:30). Requiere estudios. Imagen: RX de tórax. Laboratorio: BH.");
  // Long texts stay within the 1000-char summary limit.
  const long = planRoutes({ management_type: "urgente", observations: "x".repeat(5000) }, ctx)[0];
  assert(long.summary.length <= 1000);
});

Deno.test("mxShortDateTime renders CDMX wall clock", () => {
  assertEquals(mxShortDateTime("2026-10-12T16:30:00Z"), "12/10/2026 10:30");
  assertEquals(mxShortDateTime("2026-10-13T03:15:00Z"), "12/10/2026 21:15"); // still the 12th in CDMX
});

// ---------------------------------------------------------------------------
// Disparadores

Deno.test("routes: each route opens a case linked to the appointment and patient, from the DB", async () => {
  const db = newDb({ management_type: "procedimiento", hospitalization: "Hospital Ángeles", lab_tests: "BH, QS" });
  const f = stubFetch();
  try {
    const r = await routePostConsultation(sb(db), APPT, NOW);
    assert(r.ok);
    assertEquals(r.management_type, "procedimiento");
    assertEquals(r.routes.map((x) => `${x.request_type}:${x.outcome}`), ["procedure:created", "studies:created"]);
    // No message to the patient from this flow.
    assertEquals(f.calls.filter((c) => c.url.includes("/messages")).length, 0);
  } finally {
    f.restore();
  }
  const proc = byType(db, "procedure");
  assertEquals(
    [proc.subject_phone, proc.patient_id, proc.appointment_id, proc.source, proc.priority, proc.status, proc.contact_name],
    [PHONE, PATIENT, APPT, "post_consultation", "high", "open", "Ana Pérez"],
  );
  assertEquals(byType(db, "studies").priority, "normal");
  assert(String(byType(db, "studies").summary).includes("Laboratorio: BH, QS."));
  const created = db.rows("case_events").filter((e) => e.event_type === "created");
  assertEquals(created.length, 2);
  for (const e of created) {
    assertEquals(e.actor, "system");
    const d = e.detail as Record<string, unknown>;
    assertEquals([d.origin, d.post_consultation_form_id, d.appointment_id, d.management_type], ["post_consultation", "form-1", APPT, "procedimiento"]);
  }
  assertEquals(db.rows("post_consultation_case_links").map((l) => `${l.request_type}:${l.outcome}`), ["procedure:created", "studies:created"]);
});

Deno.test("routes: conservador → follow-up due in 7 days with the call as next action", async () => {
  const db = newDb({ management_type: "conservador" });
  const r = await routePostConsultation(sb(db), APPT, NOW);
  assert(r.ok);
  const c = byType(db, "follow_up");
  assertEquals([c.priority, c.next_action, c.due_at], ["normal", "Llamar al paciente para seguimiento", "2026-10-21T18:00:00.000Z"]);
});

Deno.test("routes: urgente opens an urgent 'urgency' case", async () => {
  const db = newDb({ management_type: "urgente", observations: "Dolor torácico" });
  const r = await routePostConsultation(sb(db), APPT, NOW);
  assert(r.ok);
  assertEquals(cases(db).map((c) => `${c.request_type}:${c.priority}`), ["urgency:urgent"]);
});

Deno.test("routes: re-sending the same form never duplicates cases nor events", async () => {
  const db = newDb({ management_type: "estudios", imaging_studies: "USG", specialist_referral: "Cardiología" });
  const first = await routePostConsultation(sb(db), APPT, NOW);
  assert(first.ok);
  const eventsBefore = db.rows("case_events").length;

  const again = await routePostConsultation(sb(db), APPT, NOW);
  assert(again.ok);
  assertEquals(again.routes.map((x) => x.outcome), ["already", "already"]);
  assertEquals(again.routes.map((x) => x.case_id), first.routes.map((x) => x.case_id));
  assertEquals(cases(db).length, 2);
  assertEquals(db.rows("case_events").length, eventsBefore);
  assertEquals(db.rows("post_consultation_case_links").length, 2);
});

Deno.test("routes: an active case of the same type only gets an event (one active case per phone + type)", async () => {
  const db = newDb({ management_type: "estudios", lab_tests: "Perfil tiroideo" });
  // The WhatsApp agent had already opened a studies case for this patient.
  const prior = await openCase(sb(db), { phone: PHONE, requestType: "studies", summary: "Quiere precios de laboratorio" });
  assert(prior.ok);

  const r = await routePostConsultation(sb(db), APPT, NOW);
  assert(r.ok);
  assertEquals(r.routes, [{ request_type: "studies", outcome: "appended", case_id: prior.case_id }]);
  assertEquals(cases(db).length, 1);
  const appended = db.rows("case_events").find((e) => e.event_type === "deduplicated")!;
  assertEquals((appended.detail as Record<string, unknown>).origin, "post_consultation");
  assert(String((appended.detail as Record<string, unknown>).summary).includes("Perfil tiroideo"));
  assertEquals(db.rows("post_consultation_case_links")[0].outcome, "appended");

  // A second form for the same appointment also lands in the same active case.
  db.rows("post_consultation_forms").push({ id: "form-2", appointment_id: APPT, doctor_id: DOCTOR, created_at: "2026-10-13T09:00:00Z", management_type: "estudios", lab_tests: "BH" });
  const second = await routePostConsultation(sb(db), APPT, NOW);
  assert(second.ok);
  assertEquals(second.form_id, "form-2");
  assertEquals(second.routes[0].outcome, "appended");
  assertEquals(cases(db).length, 1);
});

Deno.test("routes: missing form / patient and invalid phone are reported, nothing invented", async () => {
  const empty = newDb();
  empty.tables.post_consultation_forms = [];
  assertEquals(await routePostConsultation(sb(empty), APPT, NOW), { ok: false, code: "form_not_found" });

  const noPatient = newDb({ management_type: "conservador" });
  noPatient.tables.patients = [];
  assertEquals(await routePostConsultation(sb(noPatient), APPT, NOW), { ok: false, code: "patient_not_found" });

  const badPhone = newDb({ management_type: "conservador" });
  badPhone.rows("patients")[0].phone = "123";
  const r = await routePostConsultation(sb(badPhone), APPT, NOW);
  assert(r.ok);
  assertEquals(r.routes, [{ request_type: "follow_up", outcome: "failed", case_id: null, code: "invalid_phone" }]);
  assertEquals(badPhone.rows("post_consultation_case_links").length, 0); // a retry can still open it
});

// ---------------------------------------------------------------------------
// case-actions: Nuevo caso y reembolsos

const noWhaapy = { configured: false } as unknown as WhaapyClient;
function poster(db: FakeDb) {
  return async (body: unknown) => {
    const res = await handleCaseActions(new Request("https://x/functions/v1/case-actions", { method: "POST", body: JSON.stringify(body) }), {
      supabase: sb(db),
      whaapy: noWhaapy,
      authorize: () => Promise.resolve({ ok: true as const, userId: STAFF }),
    });
    return { status: res.status, body: await res.json() };
  };
}

Deno.test("create_case: staff opens a case for a picked patient; validation; repeat goes to the active case", async () => {
  const db = newDb();
  const post = poster(db);

  assertEquals((await post({ action: "create_case", request_type: "ambulance", summary: "Hola mundo" })).status, 400);
  assertEquals((await post({ action: "create_case", request_type: "reimbursement", summary: "x" })).status, 400);
  assertEquals((await post({ action: "create_case", request_type: "reimbursement", summary: "Reembolso AXA", priority: "max" })).status, 400);
  assertEquals((await post({ action: "create_case", request_type: "reimbursement", summary: "Reembolso AXA" })).body.error, "invalid_phone");
  assertEquals((await post({ action: "create_case", request_type: "reimbursement", summary: "Reembolso AXA", patient_id: crypto.randomUUID() })).status, 404);

  // The picked patient's phone wins over whatever the browser sent.
  const made = await post({ action: "create_case", request_type: "reimbursement", summary: "Reembolso de consulta AXA", patient_id: PATIENT, phone: "5599999999" });
  assertEquals(made.status, 200);
  assertEquals(
    [made.body.case.request_type, made.body.case.subject_phone, made.body.case.patient_id, made.body.case.source, made.body.deduplicated],
    ["reimbursement", PHONE, PATIENT, "admin", false],
  );
  const ev = db.rows("case_events").find((e) => e.event_type === "created")!;
  assertEquals([ev.actor, ev.actor_user_id], ["staff", STAFF]);

  const repeat = await post({ action: "create_case", request_type: "reimbursement", summary: "Otra factura", patient_id: PATIENT });
  assertEquals([repeat.status, repeat.body.deduplicated, repeat.body.case.id, repeat.body.warnings.length], [200, true, made.body.case.id, 1]);

  // A contact that is not a registered patient: by phone.
  const byPhone = await post({ action: "create_case", request_type: "other", summary: "Duda de facturación", phone: "55 8888 7777", contact_name: "Luis" });
  assertEquals([byPhone.status, byPhone.body.case.subject_phone, byPhone.body.case.patient_id], [200, "+525588887777", null]);
});

Deno.test("reimbursements: register, move forward only, lock when final, history in case_events", async () => {
  const db = newDb();
  const post = poster(db);
  const caseId = (await post({ action: "create_case", request_type: "reimbursement", summary: "Reembolso AXA", patient_id: PATIENT })).body.case.id;

  assertEquals((await post({ action: "reimbursement_create", case_id: caseId })).body.error, "invalid_insurer");
  assertEquals((await post({ action: "reimbursement_create", case_id: caseId, insurer: "AXA", amount: -5 })).body.error, "invalid_amount");
  assertEquals((await post({ action: "reimbursement_create", case_id: caseId, insurer: "AXA", currency: "pesos" })).body.error, "invalid_currency");
  assertEquals((await post({ action: "reimbursement_create", case_id: caseId, insurer: "AXA", status: "pagado" })).body.error, "invalid_status");

  const made = await post({ action: "reimbursement_create", case_id: caseId, insurer: " AXA  Seguros ", invoice_number: "F-1024", amount: "1,500.50", notes: "Factura original" });
  assertEquals(made.status, 200);
  const r = made.body.reimbursement;
  assertEquals(
    [r.insurer, r.invoice_number, r.amount, r.currency, r.status, r.patient_id, r.submitted_at, r.resolved_at, r.created_by_user_id],
    ["AXA Seguros", "F-1024", 1500.5, "MXN", "recibido", PATIENT, null, null, STAFF],
  );

  const toProcess = await post({ action: "reimbursement_update", case_id: caseId, reimbursement_id: r.id, status: "en_proceso" });
  assertEquals([toProcess.status, toProcess.body.reimbursement.status], [200, "en_proceso"]);
  assert(toProcess.body.reimbursement.submitted_at);

  const back = await post({ action: "reimbursement_update", case_id: caseId, reimbursement_id: r.id, status: "recibido" });
  assertEquals([back.status, back.body.error], [400, "invalid_transition"]);
  assertEquals((await post({ action: "reimbursement_update", case_id: caseId, reimbursement_id: r.id })).body.error, "nothing_to_update");
  assertEquals((await post({ action: "reimbursement_update", case_id: caseId, reimbursement_id: crypto.randomUUID(), status: "finalizado" })).status, 404);

  const edit = await post({ action: "reimbursement_update", case_id: caseId, reimbursement_id: r.id, amount: 1800, currency: "usd" });
  assertEquals([edit.body.reimbursement.amount, edit.body.reimbursement.currency], [1800, "USD"]);

  const done = await post({ action: "reimbursement_update", case_id: caseId, reimbursement_id: r.id, status: "finalizado" });
  assertEquals(done.body.reimbursement.status, "finalizado");
  assert(done.body.reimbursement.resolved_at);
  const locked = await post({ action: "reimbursement_update", case_id: caseId, reimbursement_id: r.id, notes: "corrección" });
  assertEquals([locked.status, locked.body.error], [409, "reimbursement_locked"]);

  const history = db.rows("case_events").filter((e) => String(e.event_type).startsWith("reimbursement_")).map((e) => e.event_type);
  assertEquals(history, ["reimbursement_created", "reimbursement_status", "reimbursement_updated", "reimbursement_status"]);
  const first = db.rows("case_events").find((e) => e.event_type === "reimbursement_created")!;
  assertEquals((first.detail as { text: string }).text, "AXA Seguros · Factura F-1024 · $1,500.50 MXN · Recibido");

  // Closed case: no more reimbursement writes.
  db.rows("patient_cases").find((c) => c.id === caseId)!.status = "resolved";
  assertEquals((await post({ action: "reimbursement_create", case_id: caseId, insurer: "GNP" })).status, 409);
});

Deno.test("reimbursement fields parser: optional fields on update, cleans values", () => {
  const p = parseReimbursementFields({ invoice_number: "  ", notes: null }, "update");
  assert(p.ok);
  assertEquals(p.fields, { invoice_number: null, notes: null });
  const amount = parseReimbursementFields({ insurer: "GNP", amount: "10.999" }, "create");
  assertEquals(amount.ok ? "" : amount.code, "invalid_amount");
  assertEquals(describeReimbursement({ insurer: "GNP", invoice_number: null, amount: null, currency: "MXN", status: "en_proceso" }), "GNP · En proceso");
});

// ---------------------------------------------------------------------------
// Migración

Deno.test("migration 20261014120000 applies over patient_cases and enforces its rules", async () => {
  const casesSql = await Deno.readTextFile(new URL("../migrations/20261013130000_patient_cases.sql", import.meta.url));
  const sql = await Deno.readTextFile(new URL("../migrations/20261014120000_postconsult_routes_reimbursements.sql", import.meta.url));
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
    CREATE FUNCTION public.is_admin_or_superadmin(_user_id uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
    CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS
      $$BEGIN NEW.updated_at = now(); RETURN NEW; END;$$;
    CREATE TABLE public.patients (id uuid PRIMARY KEY);
    CREATE TABLE public.appointments (id uuid PRIMARY KEY);
    CREATE TABLE public.post_consultation_forms (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), appointment_id uuid NOT NULL);
    INSERT INTO public.appointments VALUES ('${APPT}');
    INSERT INTO public.patients VALUES ('${PATIENT}');`);
  await db.exec(casesSql);
  // A case that exists before the migration must survive it.
  await db.exec(`INSERT INTO patient_cases (request_type, subject_phone, summary) VALUES ('hospital', '${PHONE}', 'Hospital QRO')`);
  await db.exec(sql);

  const code = async (q: string) => ((await assertRejects(() => db.exec(q))) as { code?: string }).code;

  // management_type
  await db.exec(`INSERT INTO post_consultation_forms (appointment_id, management_type) VALUES ('${APPT}', 'estudios')`);
  await db.exec(`INSERT INTO post_consultation_forms (appointment_id) VALUES ('${APPT}')`); // legacy: null is fine
  assertEquals(await code(`INSERT INTO post_consultation_forms (appointment_id, management_type) VALUES ('${APPT}', 'cirugia')`), "23514");

  // new types and origin; unknown ones still rejected
  const insCase = (type: string, source = "post_consultation") =>
    db.query<{ id: string }>(
      `INSERT INTO patient_cases (request_type, source, subject_phone, summary, appointment_id) VALUES ('${type}', '${source}', '${PHONE}', 'Post-consulta', '${APPT}') RETURNING id`,
    );
  const proc = (await insCase("procedure")).rows[0].id;
  await insCase("referral");
  await insCase("reimbursement", "admin");
  assertEquals(await code(`INSERT INTO patient_cases (request_type, subject_phone, summary) VALUES ('ambulance', '${PHONE}', 'x y z')`), "23514");
  assertEquals(await code(`INSERT INTO patient_cases (request_type, source, subject_phone, summary) VALUES ('other', 'email', '${PHONE}', 'x y z')`), "23514");
  assertEquals(await code(`INSERT INTO patient_cases (request_type, subject_phone, summary) VALUES ('procedure', '${PHONE}', 'dup')`), "23505"); // still one active per type

  // links: one per (form, route)
  const form = (await db.query<{ id: string }>(`SELECT id FROM post_consultation_forms WHERE management_type = 'estudios'`)).rows[0].id;
  await db.exec(`INSERT INTO post_consultation_case_links (form_id, request_type, case_id, outcome) VALUES ('${form}', 'procedure', '${proc}', 'created')`);
  assertEquals(await code(`INSERT INTO post_consultation_case_links (form_id, request_type, case_id, outcome) VALUES ('${form}', 'procedure', '${proc}', 'appended')`), "23505");

  // reimbursements
  const insR = (cols: string, vals: string) => `INSERT INTO reimbursements (case_id, insurer${cols}) VALUES ('${proc}', 'AXA'${vals})`;
  await db.exec(insR(", amount, invoice_number", ", 1500.50, 'F-1'"));
  const row = (await db.query<{ currency: string; status: string; amount: string }>("SELECT currency, status, amount::text FROM reimbursements")).rows[0];
  assertEquals([row.currency, row.status, row.amount], ["MXN", "recibido", "1500.50"]);
  assertEquals(await code(insR(", status", ", 'pagado'")), "23514");
  assertEquals(await code(insR(", status", ", 'finalizado'")), "23514"); // final needs resolved_at
  await db.exec(insR(", status, resolved_at", ", 'rechazado', now()"));
  assertEquals(await code(insR(", amount", ", -1")), "23514");
  assertEquals(await code(insR(", currency", ", 'pesos'")), "23514");
  assertEquals(await code(`INSERT INTO reimbursements (case_id, insurer) VALUES ('${proc}', 'A')`), "23514");

  const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
    "SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('post_consultation_case_links', 'reimbursements') ORDER BY relname",
  );
  assertEquals(rls.rows.map((r) => [r.relname, r.relrowsecurity]), [["post_consultation_case_links", true], ["reimbursements", true]]);
  await db.close();
});
