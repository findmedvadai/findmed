// B6 — patient cases and human handoff (R31, R32, M09–M11, staff actions).
// FakeDb for the domain flow + a fake WHAAPY client whose answers each test
// controls; the migration itself is replayed on PGlite at the end.
//
//   npm run test:edge

import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.3.15";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyStaffAction, getMyCases, openCase, requestHandoff } from "../functions/_shared/cases.ts";
import type { WhaapyClient, WhaapyResult } from "../functions/_shared/whaapy-client.ts";
import { createWhaapyClient } from "../functions/_shared/whaapy-client.ts";
import { handleCaseActions } from "../functions/case-actions/handler.ts";
import { FakeDb, stubFetch } from "./fake-supabase.ts";

const PHONE = "+525512345678";
const OTHER = "+525599999999";
const STAFF = { userId: "11111111-aaaa-4aaa-8aaa-111111111111", email: "asesor@findmed.test" };

const ok = <T>(data: T): WhaapyResult<T> => ({ ok: true, status: 200, data });
const err = (status: number, error: string): WhaapyResult<never> => ({ ok: false, status, error });

/** Fake WHAAPY with call log; override any method per test. */
function fakeWhaapy(over: Partial<WhaapyClient> = {}) {
  const calls: string[] = [];
  const client: WhaapyClient = {
    configured: true,
    conversationByPhone: (phone) => {
      calls.push(`by-phone ${phone}`);
      return Promise.resolve(ok({ id: "conv-1", contact_id: "contact-1", ai_enabled: true }));
    },
    setAiEnabled: (id, enabled) => {
      calls.push(`ai ${id} ${enabled}`);
      return Promise.resolve(ok({}));
    },
    listAgents: () => {
      calls.push("team");
      return Promise.resolve(ok([{ id: "agent-1", email: "Asesor@FindMed.test", name: "A", role: "agent", is_available: true }]));
    },
    updateContact: (id, patch) => {
      calls.push(`contact ${id} ${JSON.stringify(patch)}`);
      return Promise.resolve(ok({}));
    },
    ...over,
  };
  return { client, calls };
}

const sb = (db: FakeDb) => db as unknown as SupabaseClient;
const newDb = () => new FakeDb({ patients: [{ id: "p1", phone: PHONE, full_name: "Paciente" }], patient_cases: [], case_events: [] });
const events = (db: FakeDb) => db.rows("case_events").map((e) => e.event_type);

async function openedCase(db: FakeDb, type: "hospital" | "urgency" = "hospital") {
  const r = await openCase(sb(db), { phone: "55 1234 5678", requestType: type, summary: "Necesita hospital en Querétaro" });
  if (!r.ok) throw new Error(r.code);
  return r.case_id;
}

Deno.test("M09: open_case creates a case linked to the patient; a repeat is deduplicated", async () => {
  const db = newDb();
  const first = await openCase(sb(db), { phone: "5512345678", requestType: "hospital", summary: "Hospital en QRO" });
  assert(first.ok);
  assertEquals(first.deduplicated, false);
  const row = db.rows("patient_cases")[0];
  assertEquals([row.subject_phone, row.patient_id, row.status], [PHONE, "p1", "open"]);

  const again = await openCase(sb(db), { phone: "+52 1 55 1234 5678", requestType: "hospital", summary: "otra vez", priority: "urgent" });
  assert(again.ok);
  assertEquals([again.case_id, again.deduplicated, again.priority], [first.case_id, true, "urgent"]);
  assertEquals(db.rows("patient_cases").length, 1);
  assertEquals(events(db), ["created", "deduplicated"]);

  const other = await openCase(sb(db), { phone: PHONE, requestType: "studies", summary: "Laboratorio" });
  assert(other.ok && !other.deduplicated); // different request type → new case
});

Deno.test("M09: invalid phone or empty summary creates nothing", async () => {
  const db = newDb();
  const bad = await openCase(sb(db), { phone: "abc", requestType: "other", summary: "Hola" });
  assertEquals(bad.ok ? "" : bad.code, "invalid_phone");
  const empty = await openCase(sb(db), { phone: PHONE, requestType: "other", summary: "  " });
  assertEquals(empty.ok ? "" : empty.code, "invalid_summary");
  assertEquals(db.rows("patient_cases").length, 0);
});

Deno.test("R31: handoff pauses the AI, tags the contact and stays awaiting_assignment (never 'assigned' by itself)", async () => {
  const db = newDb();
  const id = await openedCase(db);
  const w = fakeWhaapy();
  const r = await requestHandoff(sb(db), w.client, { phone: PHONE, caseId: id, reason: "paciente pide asesor" });
  assert(r.ok);
  assertEquals([r.assignment, r.ai_paused, r.replayed, r.status], ["awaiting_assignment", true, false, "awaiting_assignment"]);
  const row = db.rows("patient_cases")[0];
  assertEquals([row.ai_state, row.whaapy_conversation_id, row.whaapy_contact_id], ["paused", "conv-1", "contact-1"]);
  assertEquals(w.calls, [`by-phone ${PHONE}`, "ai conv-1 false", 'contact contact-1 {"add_tags":["apoyo_asesor"]}']);
  assertEquals(events(db), ["created", "handoff_requested", "ai_paused", "tags_added"]);

  // Retried tool call: same answer, no new side effects (no double pause/tag).
  const again = await requestHandoff(sb(db), w.client, { phone: PHONE, caseId: id, reason: "otra vez" });
  assert(again.ok && again.replayed);
  assertEquals(w.calls.length, 3);
});

Deno.test("R32: provider errors are recorded and reported honestly", async () => {
  // Pause rejected by WHAAPY.
  const db = newDb();
  const id = await openedCase(db, "urgency");
  const w = fakeWhaapy({ setAiEnabled: () => Promise.resolve(err(503, "unavailable")) });
  const r = await requestHandoff(sb(db), w.client, { phone: PHONE, caseId: id, reason: "urgencia", priority: "urgent" });
  assert(r.ok);
  assertEquals([r.assignment, r.ai_paused], ["awaiting_assignment", false]);
  assertEquals(db.rows("patient_cases")[0].ai_state, "pause_failed");
  assertEquals(db.rows("patient_cases")[0].priority, "urgent");
  assert(events(db).includes("ai_pause_failed"));
  const failed = db.rows("case_events").find((e) => e.event_type === "ai_pause_failed")!;
  assertEquals((failed.detail as { http_status: number }).http_status, 503);

  // A retry after the failure DOES try again (not treated as a replay).
  const w2 = fakeWhaapy();
  const retry = await requestHandoff(sb(db), w2.client, { phone: PHONE, caseId: id, reason: "urgencia" });
  assert(retry.ok && retry.ai_paused && !retry.replayed);
  assertEquals(db.rows("patient_cases")[0].ai_state, "paused");

  // No conversation in WHAAPY / WHAAPY not configured.
  const db2 = newDb();
  const id2 = await openedCase(db2);
  const none = fakeWhaapy({ conversationByPhone: () => Promise.resolve(ok(null)) });
  const r2 = await requestHandoff(sb(db2), none.client, { phone: PHONE, caseId: id2, reason: "x" + "yz" });
  assert(r2.ok && !r2.ai_paused);
  assert(events(db2).includes("conversation_not_found"));
  const db3 = newDb();
  const id3 = await openedCase(db3);
  const r3 = await requestHandoff(sb(db3), { ...fakeWhaapy().client, configured: false }, { phone: PHONE, caseId: id3, reason: "xyz" });
  assert(r3.ok && !r3.ai_paused);
  assert(events(db3).includes("whaapy_not_configured"));
});

Deno.test("X07: another phone cannot hand off or see someone else's case", async () => {
  const db = newDb();
  const id = await openedCase(db);
  const r = await requestHandoff(sb(db), fakeWhaapy().client, { phone: OTHER, caseId: id, reason: "xyz" });
  assertEquals(r.ok ? "" : r.code, "not_found");
  const mine = await getMyCases(sb(db), "5512345678");
  assert(mine.ok);
  assertEquals(mine.cases.length, 1);
  assertEquals(mine.cases[0].status_es, "Recibimos tu solicitud.");
  assertEquals(Object.keys(mine.cases[0]).includes("summary"), false); // no internal data
  const theirs = await getMyCases(sb(db), OTHER);
  assert(theirs.ok);
  assertEquals(theirs.cases, []);
});

Deno.test("Staff: take assigns in FindMed and in WHAAPY (agent matched by email); two takers can't both win", async () => {
  const db = newDb();
  const id = await openedCase(db);
  const w = fakeWhaapy();
  await requestHandoff(sb(db), w.client, { phone: PHONE, caseId: id, reason: "pide asesor" });
  const r = await applyStaffAction(sb(db), w.client, id, STAFF, { action: "take" });
  assert(r.ok);
  assertEquals([r.case.status, r.case.assigned_user_id, r.case.whaapy_assignment], ["assigned", STAFF.userId, "assigned"]);
  assertEquals(r.warnings, []);
  assert(w.calls.includes('contact contact-1 {"assigned_agent_id":"agent-1"}'));

  const other = await applyStaffAction(sb(db), w.client, id, { userId: "22222222-bbbb-4bbb-8bbb-222222222222", email: null }, { action: "take" });
  assertEquals(other.ok ? "" : other.code, "already_assigned");

  // Concurrent change between read and guarded update.
  const db2 = newDb();
  const id2 = await openedCase(db2);
  db2.beforeUpdate = (t) => {
    if (t === "patient_cases") db2.rows("patient_cases")[0].status = "awaiting_patient";
  };
  const raced = await applyStaffAction(sb(db2), fakeWhaapy().client, id2, STAFF, { action: "take" });
  assertEquals(raced.ok ? "" : raced.code, "concurrent_change");
});

Deno.test("Staff: take without a matching WHAAPY agent warns and keeps the FindMed assignment", async () => {
  const db = newDb();
  const id = await openedCase(db);
  const w = fakeWhaapy();
  const r = await applyStaffAction(sb(db), w.client, id, { ...STAFF, email: "otra@findmed.test" }, { action: "take" });
  assert(r.ok);
  assertEquals([r.case.status, r.case.whaapy_assignment], ["assigned", "no_matching_agent"]);
  assertEquals(r.warnings.length, 1);
  assertEquals(r.case.ai_state, "paused"); // taking a case also stops the AI
});

Deno.test("Staff: resolve needs a reason, resumes the AI and releases the WHAAPY assignment", async () => {
  const db = newDb();
  const id = await openedCase(db);
  const w = fakeWhaapy();
  await requestHandoff(sb(db), w.client, { phone: PHONE, caseId: id, reason: "pide asesor" });
  await applyStaffAction(sb(db), w.client, id, STAFF, { action: "take" });

  const noReason = await applyStaffAction(sb(db), w.client, id, STAFF, { action: "resolve", outcome: "resolved", reason: " ", resume_ai: true });
  assertEquals(noReason.ok ? "" : noReason.code, "reason_required");

  const r = await applyStaffAction(sb(db), w.client, id, STAFF, { action: "resolve", outcome: "resolved", reason: "Se agendó en hospital", resume_ai: true });
  assert(r.ok);
  assertEquals([r.case.status, r.case.ai_state, r.case.whaapy_assignment], ["resolved", "resumed", "released"]);
  assert(w.calls.includes("ai conv-1 true"));
  assert(w.calls.includes('contact contact-1 {"assigned_agent_id":null}'));

  const after = await applyStaffAction(sb(db), w.client, id, STAFF, { action: "note", text: "x" });
  assertEquals(after.ok ? "" : after.code, "case_closed");
  // A new request of the same type can be opened once the old one is closed.
  const fresh = await openCase(sb(db), { phone: PHONE, requestType: "hospital", summary: "Nueva solicitud" });
  assert(fresh.ok && !fresh.deduplicated);
});

Deno.test("Staff: resolve without resuming keeps the AI off", async () => {
  const db = newDb();
  const id = await openedCase(db);
  const w = fakeWhaapy();
  await requestHandoff(sb(db), w.client, { phone: PHONE, caseId: id, reason: "pide asesor" });
  const r = await applyStaffAction(sb(db), w.client, id, STAFF, { action: "resolve", outcome: "closed", reason: "Sin respuesta", resume_ai: false });
  assert(r.ok);
  assertEquals([r.case.status, r.case.ai_state], ["closed", "paused"]);
  assertEquals(w.calls.includes("ai conv-1 true"), false);
});

Deno.test("case-actions: auth, validation and status codes", async () => {
  const db = newDb();
  db.rows("users").push({ id: STAFF.userId, email: STAFF.email });
  const id = await openedCase(db);
  const w = fakeWhaapy();
  const post = (body: unknown, authOk = true) =>
    handleCaseActions(new Request("https://x/functions/v1/case-actions", { method: "POST", body: JSON.stringify(body) }), {
      supabase: sb(db),
      whaapy: w.client,
      authorize: () => Promise.resolve(authOk ? { ok: true as const, userId: STAFF.userId } : { ok: false as const, status: 403, error: "Forbidden" }),
    });

  assertEquals((await post({ case_id: id, action: "take" }, false)).status, 403);
  assertEquals((await post({ case_id: "nope", action: "take" })).status, 400);
  assertEquals((await post({ case_id: id, action: "explode" })).status, 400);
  assertEquals((await post({ case_id: id, action: "update", status: "resolved" })).status, 400); // resolve has its own action
  assertEquals((await post({ case_id: crypto.randomUUID(), action: "take" })).status, 404);

  const took = await post({ case_id: id, action: "take" });
  assertEquals(took.status, 200);
  const body = await took.json();
  assertEquals(body.case.whaapy_assignment, "assigned"); // email from public.users matched the agent
  const upd = await post({ case_id: id, action: "update", status: "awaiting_provider", next_action: "Llamar al hospital", due_at: "2026-10-14T16:00:00Z" });
  assertEquals(upd.status, 200);
  assertEquals((await upd.json()).case.next_action, "Llamar al hospital");
});

Deno.test("whaapy-client: maps by-phone, 404 → null, errors without the key, timeout", async () => {
  const f = stubFetch(200, (url) => {
    if (url.includes("/by-phone/")) {
      return url.includes("0000") ? { status: 404, body: { error: "Not found" } } : { status: 200, body: { data: { id: "c1", contact: { id: "k1" }, settings: { aiEnabled: true } } } };
    }
    if (url.endsWith("/team/v1")) return { status: 401, body: { message: "Invalid API key" } };
  });
  try {
    const c = createWhaapyClient({ apiKey: "wha_secret_value", baseUrl: "https://api.example.test/" });
    assertEquals(await c.conversationByPhone("+525512345678"), { ok: true, status: 200, data: { id: "c1", contact_id: "k1", ai_enabled: true } });
    assertEquals(f.calls[0].url, "https://api.example.test/conversations/v1/by-phone/%2B525512345678");
    assertEquals(await c.conversationByPhone("+525500000000"), { ok: true, status: 404, data: null });
    const team = await c.listAgents();
    assertEquals(team, { ok: false, status: 401, error: "Invalid API key" });
    assertEquals(JSON.stringify(team).includes("wha_secret_value"), false);
    assertEquals((await c.setAiEnabled("c1", false)).ok, true);
    assertEquals(f.calls.at(-1)!.body, { aiEnabled: false });
  } finally {
    f.restore();
  }
  assertEquals(createWhaapyClient({ apiKey: "" }).configured, false);
  assertEquals((await createWhaapyClient({ apiKey: "" }).listAgents()).ok, false);

  const original = globalThis.fetch;
  globalThis.fetch = ((_u: string, init?: RequestInit) =>
    new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(init.signal!.reason)))) as typeof fetch;
  try {
    const slow = createWhaapyClient({ apiKey: "wha_x", timeoutMs: 20 });
    assertEquals(await slow.listAgents(), { ok: false, status: 0, error: "timeout" });
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("patient_cases migration: one active case per phone+type, closing needs a reason, RLS on", async () => {
  const sql = await Deno.readTextFile(new URL("../migrations/20261013130000_patient_cases.sql", import.meta.url));
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
    CREATE FUNCTION public.is_admin_or_superadmin(_user_id uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
    CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS
      $$BEGIN NEW.updated_at = now(); RETURN NEW; END;$$;
    CREATE TABLE public.patients (id uuid PRIMARY KEY);`);
  await db.exec(sql);
  const ins = (type = "hospital") =>
    db.query<{ id: string }>(`INSERT INTO patient_cases (request_type, subject_phone, summary) VALUES ('${type}', '${PHONE}', 'Hospital QRO') RETURNING id`);
  const first = (await ins()).rows[0].id;
  const dup = await assertRejects(() => ins()) as { code?: string };
  assertEquals(dup.code, "23505");
  await ins("studies");

  const noReason = await assertRejects(() => db.exec(`UPDATE patient_cases SET status = 'resolved' WHERE id = '${first}'`)) as { code?: string };
  assertEquals(noReason.code, "23514");
  await db.exec(`UPDATE patient_cases SET status = 'resolved', resolution_reason = 'ok' WHERE id = '${first}'`);
  await ins(); // closed case no longer blocks a new one

  const badType = await assertRejects(() => ins("ambulance")) as { code?: string };
  assertEquals(badType.code, "23514");
  await db.exec(`INSERT INTO case_events (case_id, event_type, actor) VALUES ('${first}', 'note', 'staff')`);
  const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
    "SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('patient_cases', 'case_events') ORDER BY relname",
  );
  assertEquals(rls.rows.map((r) => r.relrowsecurity), [true, true]);
  await db.close();
});
