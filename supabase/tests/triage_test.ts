// M02 suggest_specialty — ranking equal to the n8n SQL, ties, broadening,
// mapping to FindMed specialties, schema guard and the migration (F10).
// Rows below are synthetic fixtures for the algorithm, not clinical content.
//
//   npm run test:edge

import { assert, assertEquals } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.3.15";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { attempts, rank, suggestSpecialty } from "../functions/_shared/triage.ts";
import { handleMcpRequest } from "../functions/findmed-mcp/server.ts";
import { TOOLS } from "../functions/findmed-mcp/tools.ts";
import { FakeDb } from "./fake-supabase.ts";

const row = (especialidad: string, semaforo: string, keywords: string[], alarm: string | null = null) =>
  ({ id: crypto.randomUUID(), especialidad, semaforo, keywords, si_esto_aparece_subir_a_urgencias: alarm });

function catalog(rows = [
  row("Ortopedia", "AMARILLO", ["rodilla", "dolor", "inflamacion"]),
  row("Ortopedia", "NARANJA", ["rodilla", "dolor", "deformidad", "caida"], "No puede apoyar la pierna"),
  row("Ginecologia", "VERDE", ["pelvis", "dolor", "menstruacion"]),
  row("Cirugia+Gastro+Coloprocto", "AMARILLO", ["abdomen_inferior", "abdomen_derecho", "dolor"], "fiebre, vómito"),
  row("Urologia", "AMARILLO", ["abdomen_inferior", "dolor", "hematuria"]),
  row("Cardiologia", "ROJO", ["pecho", "dolor", "sudoracion"]),
]) {
  return new FakeDb({
    triage_findmed: rows,
    triage_specialty_map: [
      { especialidad: "Ortopedia", patient_label: "Ortopedista", search_specialties: ["Ortopedia"] },
      { especialidad: "Ginecologia", patient_label: "Ginecólogo", search_specialties: ["Ginecología"] },
      { especialidad: "Cirugia+Gastro+Coloprocto", patient_label: "Gastroenterólogo", search_specialties: ["Gastroenterología", "Cirugía General", "Proctología"] },
      { especialidad: "Urologia", patient_label: "Urólogo", search_specialties: ["Urología"] },
      { especialidad: "Cardiologia", patient_label: "Cardiólogo", search_specialties: [] },
    ],
  });
}
const sb = (db: FakeDb) => db as unknown as SupabaseClient;

Deno.test("rank = n8n SQL: match_count desc, then ROJO > NARANJA > AMARILLO > VERDE", () => {
  const r = rank([
    { especialidad: "A", semaforo: "VERDE", si_esto_aparece_subir_a_urgencias: null, keywords: ["dolor", "rodilla"] },
    { especialidad: "B", semaforo: "ROJO", si_esto_aparece_subir_a_urgencias: null, keywords: ["dolor", "rodilla"] },
    { especialidad: "C", semaforo: "ROJO", si_esto_aparece_subir_a_urgencias: null, keywords: ["dolor"] },
  ], ["dolor", "rodilla"]);
  assertEquals(r.map((x) => [x.especialidad, x.match_count]), [["B", 2], ["A", 2], ["C", 1]]);
});

Deno.test("one specialty: label for the patient, FindMed specialties to search, alarm signals", async () => {
  const r = await suggestSpecialty(sb(catalog()), ["rodilla", "dolor", "deformidad", "caida"]);
  assert(r.ok && r.result === "one");
  assertEquals([r.best.patient_label, r.best.semaforo, r.best.alarm_signals], ["Ortopedista", "NARANJA", "No puede apoyar la pierna"]);
  assertEquals(r.best.search_specialties, ["Ortopedia"]);
  assertEquals(r.broadened, false);
});

Deno.test("tie between specialties is reported (agent asks one question)", async () => {
  const r = await suggestSpecialty(sb(catalog()), ["abdomen_inferior", "dolor"]);
  assert(r.ok && r.result === "tie");
  assertEquals(r.candidates.map((c) => c.especialidad).sort(), ["Cirugia+Gastro+Coloprocto", "Urologia"]);
  const after = await suggestSpecialty(sb(catalog()), ["abdomen_inferior", "dolor", "hematuria"]);
  assert(after.ok && after.result === "one");
  assertEquals(after.best.patient_label, "Urólogo");
});

Deno.test("no match → broadens (drop context, then body area); never a dead end without asking", async () => {
  assertEquals(attempts(["rodilla", "dolor", "diabetes"]), [["rodilla", "dolor", "diabetes"], ["dolor", "rodilla"], ["rodilla"], ["dolor"]]);
  const r = await suggestSpecialty(sb(catalog([row("Ortopedia", "AMARILLO", ["rodilla"])])), ["rodilla", "fiebre", "embarazo"]);
  assert(r.ok && r.result === "one");
  assertEquals(r.broadened, false); // "rodilla" already overlaps on the first attempt
  const none = await suggestSpecialty(sb(catalog([row("Ortopedia", "AMARILLO", ["rodilla"])])), ["ojo", "vision_alterada"]);
  assertEquals(none.ok && none.result, "none");
});

Deno.test("specialty FindMed doesn't offer → empty search list (agent hands off)", async () => {
  const r = await suggestSpecialty(sb(catalog()), ["pecho", "dolor", "sudoracion"]);
  assert(r.ok && r.result === "one");
  assertEquals([r.best.patient_label, r.best.search_specialties], ["Cardiólogo", []]);
});

Deno.test("empty catalog → catalog_unavailable; unknown keyword rejected", async () => {
  const empty = await suggestSpecialty(sb(new FakeDb({ triage_findmed: [], triage_specialty_map: [] })), ["dolor"]);
  assertEquals(empty.ok ? "" : empty.code, "catalog_unavailable");
  const bad = await suggestSpecialty(sb(catalog()), ["dolor", "migraña"]);
  assertEquals(bad.ok ? "" : bad.code, "invalid_keywords");
});

Deno.test("MCP: suggest_specialty only accepts catalog keywords (no free SQL, no invented terms)", async () => {
  const deps = { token: "t0k3n-for-tests-123456", supabase: sb(catalog()), tools: TOOLS };
  const call = (args: unknown) =>
    handleMcpRequest(new Request("https://x", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer t0k3n-for-tests-123456" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "suggest_specialty", arguments: args } }),
    }), deps).then((r) => r.json());
  const bad = await call({ keywords: ["SELECT * FROM patients"] });
  assertEquals(bad.error.code, -32602);
  const empty = await call({ keywords: [] });
  assertEquals(empty.error.code, -32602);
  const ok = await call({ keywords: ["rodilla", "dolor", "inflamacion"] });
  const envelope = JSON.parse(ok.result.content[0].text);
  assertEquals([envelope.status, envelope.data.best.patient_label], ["success", "Ortopedista"]);
});

Deno.test("triage migration: columns, GIN overlap query, semaforo check, map seeded, RLS on", async () => {
  const sql = await Deno.readTextFile(new URL("../migrations/20261013160000_triage_catalog.sql", import.meta.url));
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
    CREATE FUNCTION public.is_admin_or_superadmin(_user_id uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';`);
  await db.exec(sql);
  await db.exec(`INSERT INTO triage_findmed (especialidad, semaforo, keywords) VALUES ('Ortopedia', 'AMARILLO', ARRAY['rodilla','dolor'])`);
  const hit = await db.query<{ especialidad: string }>(`SELECT especialidad FROM triage_findmed WHERE keywords && ARRAY['rodilla']`);
  assertEquals(hit.rows[0].especialidad, "Ortopedia");
  let rejected = false;
  try {
    await db.exec(`INSERT INTO triage_findmed (especialidad, semaforo) VALUES ('X', 'AZUL')`);
  } catch { rejected = true; }
  assert(rejected);
  const map = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM triage_specialty_map");
  assertEquals(map.rows[0].n, 13);
  const rls = await db.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE relname IN ('triage_findmed','triage_specialty_map')");
  assertEquals(rls.rows.every((r) => r.relrowsecurity), true);
  await db.close();
});
