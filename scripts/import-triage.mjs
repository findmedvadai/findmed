#!/usr/bin/env node
// Converts an export of VADAI's public.triage_findmed (JSON from n8n or CSV)
// into a SQL file that replaces public.triage_findmed in FindMed, in one
// transaction. It does NOT touch the database: run the output with
//   bash scripts/sb.sh db query --file <salida.sql>
//
// Usage:
//   node scripts/import-triage.mjs <export.json|export.csv> <salida.sql>
//
// Accepted input:
//   * JSON: an array of rows, or n8n's output ([{ json: {...} }, ...]).
//   * CSV with a header row (comma-separated, double-quoted fields).
// Columns used: especialidad, semaforo, si_esto_aparece_subir_a_urgencias,
// keywords (array, "{a,b}" or "a, b"). Any other column goes to `extra`.
//
// The clinical content is imported verbatim; the script only reports
// problems (unknown keywords, specialties without a FindMed mapping) so a
// person decides. The export and the SQL contain FindMed's catalog: keep them
// out of the repo (the repo is public).

import fs from "node:fs";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("Uso: node scripts/import-triage.mjs <export.json|export.csv> <salida.sql>");
  process.exit(1);
}

// Same vocabulary as supabase/functions/_shared/triage.ts.
const CATALOG = new Set(`cabeza cara ojo oido nariz garganta cuello pecho espalda abdomen abdomen_superior abdomen_inferior
abdomen_derecho abdomen_izquierdo pelvis ano ingle pierna pantorrilla pie dedo_pie rodilla brazo hombro mano talon
testiculo perineal vaginal columna_lumbar columna articulacion extremidad dolor sangrado sangrado_rectal sangrado_uterino
hematuria inflamacion fiebre mareo desmayo nausea vomito tos dificultad_respirar sibilancias ardor entumecimiento debilidad
hormigueo palpitaciones taquicardia convulsion sudoracion retencion_urinaria secrecion flujo_vaginal pus deformidad
perdida_fuerza rigidez perdida_audicion dificultad_hablar vision_alterada somnolencia confusion cansancio palidez
piel_amarilla orina_oscura bulto herida ulcera heces_negras no_evacuar no_gases ronquido apnea embarazo diabetes cancer
quimioterapia caida golpe traumatismo renal_cronico menstruacion intermenstrual`.split(/\s+/).filter(Boolean));

const MAPPED = new Set(["Cirugia+Gastro+Coloprocto", "Ortopedia", "Urologia", "Ginecologia", "Otorrino", "MedicinaInterna",
  "Cardiologia", "Neurologia", "Neurocirugia", "Oncologia", "Neumologia", "Nefrologia", "Vascular"]);

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

function keywordsOf(v) {
  if (Array.isArray(v)) return v.map(String);
  const s = String(v ?? "").trim();
  if (!s) return [];
  const inner = s.startsWith("{") && s.endsWith("}") ? s.slice(1, -1) : s.startsWith("[") ? JSON.parse(s).join(",") : s;
  return inner.split(",").map((k) => k.trim().replace(/^"|"$/g, "")).filter(Boolean);
}

const lit = (v) => (v === null || v === undefined || v === "" ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const arr = (a) => `ARRAY[${a.map(lit).join(",")}]::text[]`;

const rows = load(input);
if (rows.length === 0) throw new Error("El archivo no trae filas.");

const unknownKw = new Map();
const unmapped = new Set();
const badLight = [];
const values = [];
for (const [i, r] of rows.entries()) {
  const { especialidad, semaforo, si_esto_aparece_subir_a_urgencias, keywords, id: _id, ...rest } = r;
  if (!especialidad) throw new Error(`Fila ${i + 1} sin especialidad.`);
  const kws = keywordsOf(keywords).map((k) => k.toLowerCase());
  for (const k of kws) if (!CATALOG.has(k)) unknownKw.set(k, (unknownKw.get(k) ?? 0) + 1);
  if (!MAPPED.has(especialidad)) unmapped.add(especialidad);
  const light = semaforo ? String(semaforo).trim().toUpperCase() : null;
  if (light && !["ROJO", "NARANJA", "AMARILLO", "VERDE"].includes(light)) badLight.push(`${i + 1}:${semaforo}`);
  const extra = Object.keys(rest).length ? `'${JSON.stringify(rest).replace(/'/g, "''")}'::jsonb` : "NULL";
  values.push(`(${lit(especialidad)}, ${lit(light)}, ${lit(si_esto_aparece_subir_a_urgencias)}, ${arr(kws)}, ${extra})`);
}
if (badLight.length) throw new Error(`Semáforos inválidos (fila:valor): ${badLight.join(", ")}`);

const sql = [
  "-- Generado por scripts/import-triage.mjs — reemplaza el catálogo completo.",
  "BEGIN;",
  "DELETE FROM public.triage_findmed;",
  "INSERT INTO public.triage_findmed (especialidad, semaforo, si_esto_aparece_subir_a_urgencias, keywords, extra) VALUES",
  values.join(",\n") + ";",
  "COMMIT;",
  "",
].join("\n");
fs.writeFileSync(output, sql);

console.log(`Filas: ${rows.length} → ${output}`);
console.log(`Especialidades: ${[...new Set(rows.map((r) => r.especialidad))].join(", ")}`);
if (unknownKw.size) console.log(`⚠ Keywords fuera del catálogo (no las podrá usar el agente): ${[...unknownKw].map(([k, n]) => `${k}×${n}`).join(", ")}`);
if (unmapped.size) console.log(`⚠ Especialidades sin mapeo a FindMed (agregar en triage_specialty_map): ${[...unmapped].join(", ")}`);
