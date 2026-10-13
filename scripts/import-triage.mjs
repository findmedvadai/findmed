#!/usr/bin/env node
// Builds a SQL file that replaces public.triage_findmed in FindMed, in one
// transaction. It does NOT touch the database: run the output with
//   bash scripts/sb.sh db query --file <salida.sql>
//
// Usage:
//   node scripts/import-triage.mjs <catalogo.json|export.csv> <salida.sql> [--solo-validados]
//
// Accepted input:
//   * Catalog v2 (one object per condition): id, padecimiento, especialidad,
//     semaforo, primera_parada, keywords, requiere_todos, requiere_alguno,
//     alarma, pregunta_diferencial, accion_operativa, origen, validado.
//   * The n8n export of VADAI's triage_findmed (JSON array, n8n output
//     [{ json }], or CSV). Its rows repeat each condition with synthetic
//     phrases; they are collapsed to one row per especialidad +
//     posible_padecimiento and up to 3 phrases are kept in `extra`.
//
// The script validates and reports (unknown keywords, specialties without a
// FindMed mapping, gates that can never match); clinical content is never
// invented here. The catalog contains FindMed's clinical content: keep inputs
// and the generated SQL out of the repo (the repo is public).

import fs from "node:fs";

const [input, output, ...flags] = process.argv.slice(2);
if (!input || !output) {
  console.error("Uso: node scripts/import-triage.mjs <catalogo.json|export.csv> <salida.sql> [--solo-validados]");
  process.exit(1);
}
const onlyValidated = flags.includes("--solo-validados");

// Same vocabulary as supabase/functions/_shared/triage.ts.
const triageSrc = fs.readFileSync(new URL("../supabase/functions/_shared/triage.ts", import.meta.url), "utf8");
const vocabBlock = triageSrc.slice(triageSrc.indexOf("export const KEYWORDS"), triageSrc.indexOf("} as const;"));
const CATALOG = new Set([...vocabBlock.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));

const MAPPED = new Set(["Cirugia+Gastro+Coloprocto", "CirugiaGeneral", "Gastroenterologia", "Coloproctologia", "Oftalmologia",
  "CirugiaPlastica", "Ortopedia", "Urologia", "Ginecologia", "Otorrino", "MedicinaInterna", "Cardiologia", "Neurologia",
  "Neurocirugia", "Oncologia", "Neumologia", "Nefrologia", "Vascular"]);
const LIGHTS = ["ROJO", "NARANJA", "AMARILLO", "VERDE"];
const ROUTINGS = ["urgencias_inmediato", "urgencias_hoy", "consulta_mismo_dia", "consulta"];
const LEGACY_STOP = { "urgencias inmediato": "urgencias_inmediato", "urgencias hoy": "urgencias_hoy",
  "consulta el mismo dia": "consulta_mismo_dia", "consulta (primero)": "consulta" };

function parseCsv(text) {
  const rows = [];
  let field = "", row = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [header, ...data] = rows;
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ""])));
}

function load(path) {
  const text = fs.readFileSync(path, "utf8").replace(/^﻿/, "");
  if (path.toLowerCase().endsWith(".csv")) return parseCsv(text);
  const json = JSON.parse(text);
  const arr = Array.isArray(json) ? json : json.data ?? json.rows ?? [];
  return arr.map((r) => (r && typeof r === "object" && "json" in r ? r.json : r));
}

function list(v) {
  if (Array.isArray(v)) return v.map((k) => String(k).trim().toLowerCase()).filter(Boolean);
  const s = String(v ?? "").trim();
  if (!s) return [];
  const inner = s.startsWith("{") && s.endsWith("}") ? s.slice(1, -1) : s.startsWith("[") ? JSON.parse(s).join(",") : s;
  return inner.split(",").map((k) => k.trim().replace(/^"|"$/g, "").toLowerCase()).filter(Boolean);
}

// Normalize either input format to catalog v2 objects.
function toConditions(rows) {
  if (rows.length && "padecimiento" in rows[0]) return rows;
  const byKey = new Map();
  for (const r of rows) {
    const key = `${r.especialidad}|${r.posible_padecimiento ?? r.id}`;
    const c = byKey.get(key);
    if (c) {
      if (c.extra.frases_ejemplo.length < 3 && r.frase_colloquial) c.extra.frases_ejemplo.push(r.frase_colloquial);
      continue;
    }
    byKey.set(key, {
      id: null,
      padecimiento: r.posible_padecimiento ?? null,
      especialidad: r.especialidad,
      semaforo: r.semaforo,
      primera_parada: LEGACY_STOP[String(r.primera_parada ?? "").trim().toLowerCase()] ?? null,
      keywords: list(r.keywords),
      requiere_todos: [],
      requiere_alguno: [],
      alarma: r.si_esto_aparece_subir_a_urgencias,
      pregunta_diferencial: null,
      accion_operativa: r.accion_operativa ?? null,
      origen: "n8n_v1",
      validado: false,
      extra: { frases_ejemplo: r.frase_colloquial ? [r.frase_colloquial] : [], fuente_ids: [] },
    });
  }
  for (const r of rows) byKey.get(`${r.especialidad}|${r.posible_padecimiento ?? r.id}`).extra.fuente_ids.push(r.id);
  return [...byKey.values()];
}

const lit = (v) => (v === null || v === undefined || v === "" ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const arr = (a) => `ARRAY[${a.map(lit).join(",")}]::text[]`;

const raw = load(input);
if (raw.length === 0) throw new Error("El archivo no trae filas.");
let conditions = toConditions(raw);
if (onlyValidated) conditions = conditions.filter((c) => c.validado === true);

const problems = [];
const unknownKw = new Map();
const unmapped = new Set();
const values = [];
for (const [i, c] of conditions.entries()) {
  const label = c.id ?? c.padecimiento ?? `fila ${i + 1}`;
  if (!c.especialidad) problems.push(`${label}: sin especialidad`);
  const light = c.semaforo ? String(c.semaforo).trim().toUpperCase() : null;
  if (light && !LIGHTS.includes(light)) problems.push(`${label}: semáforo inválido ${c.semaforo}`);
  if (c.primera_parada && !ROUTINGS.includes(c.primera_parada)) problems.push(`${label}: primera_parada inválida ${c.primera_parada}`);
  const kws = list(c.keywords), todos = list(c.requiere_todos), alguno = list(c.requiere_alguno);
  for (const k of [...kws, ...todos, ...alguno]) if (!CATALOG.has(k)) unknownKw.set(k, (unknownKw.get(k) ?? 0) + 1);
  if (!kws.length) problems.push(`${label}: sin keywords`);
  if (!MAPPED.has(c.especialidad)) unmapped.add(c.especialidad);
  const extra = { ...(c.extra ?? {}), ...(c.id ? { catalog_key: c.id } : {}) };
  values.push(`(${[lit(c.especialidad), lit(light), lit(c.primera_parada), lit(c.alarma), arr(kws), lit(c.padecimiento),
    arr(todos), arr(alguno), lit(c.pregunta_diferencial), lit(c.accion_operativa), lit(c.origen),
    c.validado === true ? "true" : "false", `'${JSON.stringify(extra).replace(/'/g, "''")}'::jsonb`].join(", ")})`);
}
if (problems.length) throw new Error(`Catálogo con errores:\n  ${problems.join("\n  ")}`);
if (unknownKw.size) throw new Error(`Keywords fuera del vocabulario de triage.ts: ${[...unknownKw].map(([k, n]) => `${k}×${n}`).join(", ")}`);

const sql = [
  "-- Generado por scripts/import-triage.mjs — reemplaza el catálogo completo.",
  "BEGIN;",
  "DELETE FROM public.triage_findmed;",
  "INSERT INTO public.triage_findmed (especialidad, semaforo, primera_parada, si_esto_aparece_subir_a_urgencias, keywords,",
  "  padecimiento, requiere_todos, requiere_alguno, pregunta_diferencial, accion_operativa, origen, validado, extra) VALUES",
  values.join(",\n") + ";",
  "COMMIT;",
  "",
].join("\n");
fs.writeFileSync(output, sql);

const count = (f) => conditions.reduce((m, c) => m.set(f(c), (m.get(f(c)) ?? 0) + 1), new Map());
console.log(`Filas de entrada: ${raw.length} → condiciones: ${conditions.length} → ${output}`);
console.log(`Por semáforo: ${[...count((c) => String(c.semaforo).toUpperCase())].map(([k, n]) => `${k} ${n}`).join(" · ")}`);
console.log(`Por origen: ${[...count((c) => c.origen ?? "?")].map(([k, n]) => `${k} ${n}`).join(" · ")}`);
console.log(`Validadas por el equipo médico: ${conditions.filter((c) => c.validado === true).length}/${conditions.length}`);
if (unmapped.size) console.log(`⚠ Especialidades sin mapeo a FindMed (agregar en triage_specialty_map): ${[...unmapped].join(", ")}`);
