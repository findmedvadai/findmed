// triage-admin — catalog editing from Catálogos → Triaje: auth, vocabulary
// validation, validation stamps, change log, concurrency guard, mapping rules,
// the "Probar triaje" panel and inactive conditions ignored by the engine.
// Rows are synthetic fixtures, not clinical content.
//
//   npm run test:edge

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.3.15";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { suggestSpecialty } from "../functions/_shared/triage.ts";
import { handleTriageAdmin, validateCondition } from "../functions/triage-admin/handler.ts";
import { FakeDb } from "./fake-supabase.ts";

const ADMIN = "11111111-aaaa-4aaa-8aaa-111111111111";
const T0 = "2026-10-14T10:00:00.000Z";

const cond = (id: number, over: Record<string, unknown> = {}) => ({
  id, especialidad: "Ortopedia", padecimiento: `Condición ${id}`, semaforo: "AMARILLO", primera_parada: "consulta",
  keywords: ["rodilla", "dolor"], requiere_todos: [], requiere_alguno: [], si_esto_aparece_subir_a_urgencias: null,
  pregunta_diferencial: null, accion_operativa: null, origen: "n8n_v1", notas: null, validado: false,
  validated_by: null, validated_by_email: null, validated_at: null, is_active: true, updated_at: T0, updated_by: null, ...over,
});

function setup(conditions: Record<string, unknown>[] = [cond(1)]) {
  const db = new FakeDb({
    users: [{ id: ADMIN, email: "medico@findmed.mx" }],
    triage_findmed: conditions,
    triage_specialty_map: [
      { especialidad: "Ortopedia", patient_label: "Ortopedista", search_specialties: ["Ortopedia"], notes: null },
      { especialidad: "Cardiologia", patient_label: "Cardiólogo", search_specialties: [], notes: null },
    ],
    triage_changes: [],
    specialties: [
      { id: "s1", name: "Ortopedia", is_active: true },
      { id: "s2", name: "Cardiología", is_active: false },
      { id: "s3", name: "Urología", is_active: true },
    ],
    doctor_specialties: [{ doctor_id: "d1", specialty_id: "s1" }, { doctor_id: "d2", specialty_id: "s3" }],
    doctors: [{ id: "d1", is_active: true, is_deleted: false }, { id: "d2", is_active: false, is_deleted: false }],
    doctor_offices: [{ doctor_id: "d1", is_active: true, is_deleted: false }, { doctor_id: "d2", is_active: true, is_deleted: false }],
  });
  let allowed: "admin" | "anon" | "doctor" = "admin";
  const call = async (body: Record<string, unknown>) => {
    const res = await handleTriageAdmin(
      new Request("https://x", { method: "POST", body: JSON.stringify(body) }),
      {
        supabase: db as unknown as SupabaseClient,
        authorize: () =>
          Promise.resolve(
            allowed === "admin" ? { ok: true as const, userId: ADMIN }
            : allowed === "doctor" ? { ok: false as const, status: 403, error: "Forbidden" }
            : { ok: false as const, status: 401, error: "Unauthorized" },
          ),
        now: () => new Date("2026-10-14T12:00:00.000Z"),
      },
    );
    return { status: res.status, json: await res.json() };
  };
  return { db, call, as: (who: typeof allowed) => (allowed = who) };
}

const valid = (over: Record<string, unknown> = {}) => ({
  especialidad: "Ortopedia", padecimiento: "Esguince", semaforo: "amarillo", primera_parada: "consulta_mismo_dia",
  keywords: ["tobillo", "dolor", "caida"], requiere_todos: [], requiere_alguno: [], validado: false, ...over,
});

Deno.test("triage-admin: only admins (401 without session, 403 for doctors)", async () => {
  const t = setup();
  t.as("anon");
  assertEquals((await t.call({ action: "vocabulary" })).status, 401);
  t.as("doctor");
  assertEquals((await t.call({ action: "condition_delete", id: 1 })).status, 403);
  assertEquals(t.db.rows("triage_findmed").length, 1);
});

Deno.test("vocabulary comes from the engine (one source of truth)", async () => {
  const { json } = await setup().call({ action: "vocabulary" });
  assert(json.keywords.zona_cuerpo.includes("rodilla"));
  assert(json.half_weight.includes("dolor"));
  assertEquals(json.routings, ["urgencias_inmediato", "urgencias_hoy", "consulta_mismo_dia", "consulta"]);
});

Deno.test("validateCondition: unknown keywords rejected with a clear message; unknown specialty too", () => {
  const known = new Set(["Ortopedia"]);
  const r = validateCondition(valid({ keywords: ["rodilla", "migraña"], requiere_alguno: ["Subito", "xyz"] }), known);
  assert(!r.ok);
  assertStringIncludes(r.problems.join(" "), "«migraña» no está en el vocabulario del motor");
  assertStringIncludes(r.problems.join(" "), "«xyz»");
  const r2 = validateCondition(valid({ especialidad: "Dermatologia", keywords: [] }), known);
  assert(!r2.ok);
  assertEquals(r2.problems.length, 2);
  const ok = validateCondition(valid({ keywords: [" Rodilla ", "rodilla", "DOLOR"] }), known);
  assert(ok.ok);
  assertEquals([ok.value.keywords, ok.value.semaforo], [["rodilla", "dolor"], "AMARILLO"]);
});

Deno.test("create: validated condition stamps who and when, logs the change", async () => {
  const t = setup();
  const bad = await t.call({ action: "condition_create", condition: valid({ keywords: ["torcedura"] }) });
  assertEquals([bad.status, bad.json.error], [400, "invalid_condition"]);
  assertEquals(t.db.rows("triage_findmed").length, 1);

  const { status, json } = await t.call({ action: "condition_create", condition: valid({ validado: true }) });
  assertEquals(status, 200);
  assertEquals([json.condition.validated_by, json.condition.validated_by_email, json.condition.validated_at],
    [ADMIN, "medico@findmed.mx", "2026-10-14T12:00:00.000Z"]);
  assertEquals([json.condition.origen, json.condition.is_active, json.condition.source], ["nuevo", true, "findmed_admin"]);
  const log = t.db.rows("triage_changes");
  assertEquals([log.length, log[0].action, log[0].actor_email], [1, "create", "medico@findmed.mx"]);
});

Deno.test("update: concurrency guard, re-stamp validation on clinical change, before/after in the log", async () => {
  const t = setup([cond(1, { validado: true, validated_by: "someone-else", validated_by_email: "otro@findmed.mx", validated_at: T0 })]);
  const stale = await t.call({ action: "condition_update", id: 1, expected_updated_at: "2026-10-13T00:00:00Z", condition: valid({ validado: true }) });
  assertEquals([stale.status, stale.json.error], [409, "concurrent_change"]);

  // Notes only: validation stays with whoever validated.
  const notes = await t.call({ action: "condition_update", id: 1, expected_updated_at: T0, condition: { ...cond(1), validado: true, notas: "revisar" } });
  assertEquals(notes.status, 200);
  assertEquals(notes.json.condition.validated_by_email, "otro@findmed.mx");

  // Clinical change with the switch on: the current admin vouches for it.
  const clinical = await t.call({ action: "condition_update", id: 1, condition: { ...notes.json.condition, keywords: ["rodilla", "dolor", "caida"] } });
  assertEquals(clinical.json.condition.validated_by_email, "medico@findmed.mx");
  const log = t.db.rows("triage_changes");
  assertEquals(log.map((l) => l.action), ["update", "update"]);
  assertEquals((log[1].before as Record<string, unknown>).keywords, ["rodilla", "dolor"]);
  assertEquals((log[1].after as Record<string, unknown>).keywords, ["rodilla", "dolor", "caida"]);

  // No changes → no log entry.
  const same = await t.call({ action: "condition_update", id: 1, condition: clinical.json.condition });
  assertEquals(same.json.unchanged, true);
  assertEquals(t.db.rows("triage_changes").length, 2);
});

Deno.test("duplicate starts inactive and unvalidated; activate/validate/delete are logged", async () => {
  const t = setup([cond(1, { validado: true })]);
  const dup = await t.call({ action: "condition_duplicate", id: 1 });
  assertEquals([dup.json.condition.is_active, dup.json.condition.validado, dup.json.condition.padecimiento], [false, false, "Condición 1 (copia)"]);

  const off = await t.call({ action: "condition_set_active", id: 1, is_active: false });
  assertEquals(off.json.condition.is_active, false);
  const val = await t.call({ action: "condition_set_validated", id: 1, validado: false });
  assertEquals([val.json.condition.validado, val.json.condition.validated_by], [false, null]);
  const del = await t.call({ action: "condition_delete", id: 1 });
  assertEquals(del.status, 200);
  assertEquals(t.db.rows("triage_findmed").length, 1);
  const log = t.db.rows("triage_changes");
  assertEquals(log.map((l) => l.action), ["duplicate", "deactivate", "unvalidate", "delete"]);
  assertEquals((log[3].before as Record<string, unknown>).padecimiento, "Condición 1");
});

Deno.test("mapping: search specialties must exist and be active; delete refused while in use", async () => {
  const t = setup();
  const missing = await t.call({ action: "map_create", mapping: { especialidad: "Dermatologia", patient_label: "Dermatólogo", search_specialties: ["Dermatología"] } });
  assertEquals(missing.status, 400);
  assertStringIncludes(missing.json.message, "No existen en Especialidades: Dermatología");
  const inactive = await t.call({ action: "map_update", mapping: { especialidad: "Cardiologia", patient_label: "Cardiólogo", search_specialties: ["Cardiología"] } });
  assertStringIncludes(inactive.json.message, "Están inactivas: Cardiología");
  const badKey = await t.call({ action: "map_create", mapping: { especialidad: "Derma tología", patient_label: "x", search_specialties: [] } });
  assertEquals(badKey.json.error, "invalid_mapping");

  const ok = await t.call({ action: "map_create", mapping: { especialidad: "Urologia", patient_label: "Urólogo", search_specialties: ["Urología"] } });
  assertEquals(ok.status, 200);
  const dupe = await t.call({ action: "map_create", mapping: { especialidad: "Urologia", patient_label: "Urólogo", search_specialties: [] } });
  assertEquals(dupe.status, 409);

  const inUse = await t.call({ action: "map_delete", especialidad: "Ortopedia" });
  assertEquals([inUse.status, inUse.json.error], [409, "map_in_use"]);
  const gone = await t.call({ action: "map_delete", especialidad: "Cardiologia" });
  assertEquals(gone.status, 200);
  assertEquals(t.db.rows("triage_changes").map((l) => l.action), ["map_create", "map_delete"]);
});

Deno.test("coverage counts active doctors with an active office per specialty", async () => {
  const { json } = await setup().call({ action: "coverage" });
  assertEquals(json.specialties.map((s: { name: string; active_doctors: number }) => [s.name, s.active_doctors]),
    [["Cardiología", 0], ["Ortopedia", 1], ["Urología", 0]]);
});

Deno.test("Probar triaje runs the real engine; inactive conditions are ignored (no redeploy needed)", async () => {
  const t = setup([
    cond(1, { keywords: ["rodilla", "dolor"], padecimiento: "Gonalgia" }),
    cond(2, { keywords: ["rodilla", "dolor", "deformidad"], semaforo: "NARANJA", primera_parada: "urgencias_hoy", is_active: false }),
  ]);
  const before = await t.call({ action: "test", keywords: ["rodilla", "dolor", "deformidad"] });
  assertEquals([before.json.result.result, before.json.result.best.catalog_id, before.json.conditions[0].padecimiento], ["one", 1, "Gonalgia"]);

  await t.call({ action: "condition_set_active", id: 2, is_active: true });
  const after = await t.call({ action: "test", keywords: ["rodilla", "dolor", "deformidad"] });
  assertEquals([after.json.result.best.catalog_id, after.json.result.best.routing], [2, "urgencias_hoy"]);

  const unknown = await t.call({ action: "test", keywords: ["migraña"] });
  assertEquals([unknown.status, unknown.json.error], [400, "invalid_keywords"]);
});

Deno.test("engine: catalog with only inactive conditions is unavailable", async () => {
  const db = new FakeDb({ triage_findmed: [cond(1, { is_active: false })], triage_specialty_map: [] });
  const r = await suggestSpecialty(db as unknown as SupabaseClient, ["rodilla"]);
  assertEquals(r.ok ? "" : r.code, "catalog_unavailable");
});

Deno.test("migration 20261014150000: is_active default, change log append-only shape, RLS on", async () => {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
    CREATE FUNCTION public.is_admin_or_superadmin(_user_id uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';`);
  for (const f of ["20261013160000_triage_catalog.sql", "20261013170000_triage_catalog_v2.sql"]) {
    await db.exec(await Deno.readTextFile(new URL(`../migrations/${f}`, import.meta.url)));
  }
  await db.exec(`INSERT INTO triage_findmed (especialidad, semaforo, keywords) VALUES ('Ortopedia', 'AMARILLO', ARRAY['rodilla'])`);
  await db.exec(await Deno.readTextFile(new URL("../migrations/20261014150000_triage_admin.sql", import.meta.url)));
  const row = await db.query<{ is_active: boolean; validated_at: string | null }>("SELECT is_active, validated_at FROM triage_findmed");
  assertEquals([row.rows[0].is_active, row.rows[0].validated_at], [true, null]);
  await db.exec(`INSERT INTO triage_changes (entity, action, condition_id, after) VALUES ('condition', 'create', 1, '{}'::jsonb)`);
  let rejected = false;
  try {
    await db.exec(`INSERT INTO triage_changes (entity, action) VALUES ('condition', 'rename')`);
  } catch { rejected = true; }
  assert(rejected);
  const rls = await db.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE relname = 'triage_changes'");
  assertEquals(rls.rows[0].relrowsecurity, true);
  await db.close();
});
