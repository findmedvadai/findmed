// Catalog v2 scenarios — common patient complaints must land on the right
// specialty and first stop, and urgent conditions only when their
// discriminating terms are present. The catalog is FindMed's clinical content
// and lives outside git (triage.local/catalogo-v2.json); without it these
// tests are skipped.
//
//   npm run test:edge

import { assertEquals } from "jsr:@std/assert@1";
import { rank, routingOf, type TriageRow } from "../functions/_shared/triage.ts";

const path = new URL("../../triage.local/catalogo-v2.json", import.meta.url);
let rows: TriageRow[] = [];
try {
  const raw = JSON.parse(await Deno.readTextFile(path)) as Record<string, unknown>[];
  rows = raw.map((c) => ({
    especialidad: c.especialidad as string,
    semaforo: c.semaforo as string,
    primera_parada: c.primera_parada as string,
    si_esto_aparece_subir_a_urgencias: c.alarma as string,
    keywords: c.keywords as string[],
    requiere_todos: c.requiere_todos as string[],
    requiere_alguno: c.requiere_alguno as string[],
  }));
} catch { /* catalog not present on this machine */ }

// [patient keywords, expected especialidad, expected routing]
const SCENARIOS: [string[], string, string][] = [
  [["garganta", "dolor", "fiebre"], "Otorrino", "consulta"],
  [["garganta", "inflamacion", "fiebre", "dolor"], "Otorrino", "urgencias_hoy"],
  [["abdomen_superior", "dolor"], "Gastroenterologia", "consulta"],
  [["acidez", "abdomen_superior"], "Gastroenterologia", "consulta"],
  [["abdomen_superior", "dolor", "espalda", "vomito"], "Gastroenterologia", "urgencias_hoy"],
  [["abdomen_inferior", "abdomen_derecho", "dolor", "subito"], "CirugiaGeneral", "urgencias_hoy"],
  [["abdomen_superior", "abdomen_derecho", "dolor", "nausea"], "CirugiaGeneral", "consulta"],
  [["cabeza", "dolor"], "MedicinaInterna", "consulta"],
  [["cabeza", "dolor", "subito"], "Neurologia", "urgencias_inmediato"],
  [["cabeza", "golpe", "dolor"], "Neurocirugia", "consulta_mismo_dia"],
  [["cabeza", "golpe", "vomito"], "Neurocirugia", "urgencias_inmediato"],
  [["pecho", "dolor"], "MedicinaInterna", "consulta_mismo_dia"],
  [["pecho", "dolor", "sudoracion"], "Cardiologia", "urgencias_inmediato"],
  [["nariz", "sangrado"], "Otorrino", "consulta"],
  [["nariz", "sangrado", "sangrado_abundante"], "Otorrino", "urgencias_hoy"],
  [["rodilla", "dolor", "cronico"], "Ortopedia", "consulta"],
  [["tobillo", "dolor", "inflamacion", "caida"], "Ortopedia", "consulta_mismo_dia"],
  [["tobillo", "dolor", "deformidad", "caida"], "Ortopedia", "urgencias_hoy"],
  [["espalda", "columna_lumbar", "dolor"], "Ortopedia", "consulta"],
  [["espalda", "columna_lumbar", "retencion_urinaria"], "Neurocirugia", "urgencias_inmediato"],
  [["ardor", "orinar_frecuente"], "Urologia", "consulta"],
  [["fiebre", "ardor", "espalda"], "Urologia", "urgencias_hoy"],
  [["diarrea", "vomito", "subito"], "MedicinaInterna", "consulta_mismo_dia"],
  [["embarazo", "nausea"], "Ginecologia", "consulta"],
  [["embarazo", "sangrado"], "Ginecologia", "urgencias_inmediato"],
  [["dificultad_respirar", "cronico"], "MedicinaInterna", "consulta"],
  [["dificultad_respirar", "subito", "pecho"], "Neumologia", "urgencias_inmediato"],
  [["ojo", "ojo_rojo", "comezon"], "Oftalmologia", "consulta"],
  [["ojo", "vision_alterada", "cronico"], "Oftalmologia", "consulta"],
  [["mareo"], "Otorrino", "consulta"],
  [["testiculo", "dolor", "subito"], "Urologia", "urgencias_inmediato"],
  [["testiculo", "dolor", "cronico"], "Urologia", "consulta"],
  [["bulto", "ingle"], "CirugiaGeneral", "consulta"],
  [["bulto", "ingle", "vomito"], "CirugiaGeneral", "urgencias_hoy"],
  [["mano", "muneca", "hormigueo"], "Ortopedia", "consulta"],
  [["fiebre"], "MedicinaInterna", "consulta_mismo_dia"],
  [["quimioterapia", "fiebre"], "Oncologia", "urgencias_inmediato"],
  [["presion_alta", "chequeo"], "MedicinaInterna", "consulta"],
  [["diabetes", "pie", "herida"], "Vascular", "urgencias_hoy"],
  [["pierna", "dolor", "cronico", "inflamacion"], "Vascular", "consulta"],
  [["mama", "bulto"], "Ginecologia", "consulta"],
  [["sangrado_rectal", "ano"], "Coloproctologia", "consulta"],
];

for (const [kws, especialidad, routing] of SCENARIOS) {
  Deno.test({
    name: `catálogo v2: ${kws.join(" + ")} → ${especialidad} / ${routing}`,
    ignore: rows.length === 0,
    fn() {
      const best = rank(rows, kws)[0];
      assertEquals([best?.especialidad, best && routingOf(best)], [especialidad, routing]);
    },
  });
}

Deno.test({
  name: "catálogo v2: un síntoma genérico solo nunca manda a urgencias inmediatas",
  ignore: rows.length === 0,
  fn() {
    for (const k of ["dolor", "inflamacion", "nausea", "cansancio", "debilidad", "mareo", "tos", "vomito"]) {
      const best = rank(rows, [k])[0];
      if (best) assertEquals([k, routingOf(best) === "urgencias_inmediato"], [k, false]);
    }
  },
});
