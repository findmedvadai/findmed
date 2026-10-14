// Specialty orientation from symptoms — M02 suggest_specialty (F10).
//
// The n8n agent ran free SQL against triage_findmed: rows whose keywords
// overlap the patient's, ranked by overlap count, then severity. Catalog v2
// keeps that idea but fixes what made it unsafe or useless:
//
//  * One row per condition (the source had each condition 20× with synthetic
//    phrases that the search never used).
//  * Gates: an urgent condition is only eligible when its discriminating terms
//    are present (requiere_todos / requiere_alguno), so "dolor de cabeza" is
//    not "cefalea de alarma" and "dolor de estómago" is not "pancreatitis".
//    The benign condition's alarm signals are what escalate it.
//  * Weighted score: generic terms (dolor, inflamacion, nausea...) count half,
//    so the specific term decides. Ties still go to the most severe condition.
//  * Routing: each condition carries the source's "primera parada"
//    (urgencias inmediato / hoy, consulta mismo día / consulta). It is returned
//    so the agent never books an elective consult for an urgent condition.
//
// The catalog is edited from Configuración → Catálogos → Triaje (Edge Function
// triage-admin, which validates against KEYWORDS below). It is read on every
// call — no cache — and inactive conditions (is_active = false) are ignored.
//
// The keyword list is a closed vocabulary; anything else is rejected by the
// MCP schema. The condition name is never returned (the agent must not
// suggest diagnoses); `catalog_id` keeps traceability in the MCP log.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const KEYWORDS = {
  zona_cuerpo: [
    "cabeza", "cara", "ojo", "oido", "nariz", "garganta", "cuello",
    "pecho", "espalda", "abdomen", "abdomen_superior", "abdomen_inferior",
    "abdomen_derecho", "abdomen_izquierdo", "pelvis", "ano", "ingle",
    "pierna", "pantorrilla", "pie", "dedo_pie", "rodilla",
    "brazo", "hombro", "mano", "talon",
    "testiculo", "perineal", "vaginal",
    "columna_lumbar", "columna", "articulacion", "extremidad",
    "tobillo", "cadera", "muneca", "codo", "mama", "piel",
  ],
  sintoma: [
    "dolor", "sangrado", "sangrado_rectal", "sangrado_uterino", "hematuria",
    "inflamacion", "fiebre", "mareo", "desmayo",
    "nausea", "vomito", "tos", "dificultad_respirar", "sibilancias",
    "ardor", "entumecimiento", "debilidad", "hormigueo",
    "palpitaciones", "taquicardia", "convulsion", "sudoracion",
    "retencion_urinaria",
    "secrecion", "flujo_vaginal", "pus",
    "deformidad", "perdida_fuerza", "rigidez",
    "perdida_audicion", "dificultad_hablar", "vision_alterada",
    "somnolencia", "confusion", "cansancio", "palidez",
    "piel_amarilla", "orina_oscura",
    "bulto", "herida", "ulcera",
    "heces_negras", "no_evacuar", "no_gases",
    "ronquido", "apnea",
    "diarrea", "acidez", "estrenimiento", "comezon", "congestion_nasal",
    "ojo_rojo", "sangrado_abundante", "orinar_frecuente",
  ],
  contexto: [
    "embarazo", "diabetes", "cancer", "quimioterapia",
    "caida", "golpe", "traumatismo",
    "renal_cronico", "menstruacion", "intermenstrual",
    "subito", "cronico", "chequeo", "presion_alta", "estudio_alterado",
  ],
} as const;

export const ALL_KEYWORDS: readonly string[] = [...KEYWORDS.zona_cuerpo, ...KEYWORDS.sintoma, ...KEYWORDS.contexto];

export type KeywordCategory = keyof typeof KEYWORDS;

/** Category of a vocabulary term, or null if the engine does not know it. */
export function keywordCategory(k: string): KeywordCategory | null {
  for (const cat of Object.keys(KEYWORDS) as KeywordCategory[]) {
    if ((KEYWORDS[cat] as readonly string[]).includes(k)) return cat;
  }
  return null;
}

/** Terms outside the closed vocabulary (the engine would never match them). */
export const unknownKeywords = (kws: readonly string[]): string[] => [...new Set(kws.filter((k) => !ALL_KEYWORDS.includes(k)))];

/** Terms that appear in many conditions: they help, but never decide alone. */
export const HALF_WEIGHT_KEYWORDS = ["dolor", "inflamacion", "nausea", "cansancio", "debilidad", "mareo", "subito", "cronico", "chequeo"] as const;
const HALF_WEIGHT = new Set<string>(HALF_WEIGHT_KEYWORDS);
const weight = (k: string) => (HALF_WEIGHT.has(k) ? 0.5 : 1);

const SEVERITY: Record<string, number> = { ROJO: 0, NARANJA: 1, AMARILLO: 2, VERDE: 3 };

export const ROUTINGS = ["urgencias_inmediato", "urgencias_hoy", "consulta_mismo_dia", "consulta"] as const;
export type Routing = typeof ROUTINGS[number];
const ROUTING_FROM_LIGHT: Record<string, Routing> = {
  ROJO: "urgencias_inmediato", NARANJA: "urgencias_hoy", AMARILLO: "consulta_mismo_dia", VERDE: "consulta",
};

export interface TriageRow {
  id?: number;
  especialidad: string;
  semaforo: string | null;
  primera_parada?: string | null;
  si_esto_aparece_subir_a_urgencias: string | null;
  pregunta_diferencial?: string | null;
  keywords: string[];
  requiere_todos?: string[] | null;
  requiere_alguno?: string[] | null;
}

interface SpecialtyMap {
  especialidad: string;
  patient_label: string;
  search_specialties: string[];
}

export interface SpecialtyCandidate {
  catalog_id: number | null;
  especialidad: string;
  /** How to say it to the patient ("Ortopedista"). */
  patient_label: string;
  /** FindMed specialties to pass to search_care_options, in order. Empty = FindMed doesn't offer it. */
  search_specialties: string[];
  semaforo: string | null;
  /** Where the patient should go first, per the catalog. */
  routing: Routing;
  /** Alarm signals to ask about before recommending (may be null). */
  alarm_signals: string | null;
  /** Question that tells this condition apart from the others in a tie. */
  pregunta_diferencial: string | null;
  score: number;
}

export type SuggestResult =
  | {
    ok: true;
    result: "one" | "tie";
    best: SpecialtyCandidate;
    /** Conditions sharing the top score (tie) or the next best ones. */
    candidates: SpecialtyCandidate[];
    keywords_used: string[];
    broadened: boolean;
  }
  | { ok: true; result: "none"; keywords_used: string[]; broadened: true }
  | { ok: false; code: "catalog_unavailable" | "invalid_keywords" | "temporarily_unavailable"; message_es: string };

const unique = (a: string[]) => [...new Set(a)];

/** Search attempts from most to least specific (old tool's "broaden" rules). */
export function attempts(kws: string[]): string[][] {
  const zona = kws.filter((k) => (KEYWORDS.zona_cuerpo as readonly string[]).includes(k));
  const sintoma = kws.filter((k) => (KEYWORDS.sintoma as readonly string[]).includes(k));
  const out = [kws, [...sintoma, ...zona], zona, sintoma].filter((a) => a.length > 0);
  const seen = new Set<string>();
  return out.filter((a) => {
    const key = [...a].sort().join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function eligible(row: TriageRow, set: Set<string>): boolean {
  const todos = row.requiere_todos ?? [];
  const alguno = row.requiere_alguno ?? [];
  return todos.every((k) => set.has(k)) && (alguno.length === 0 || alguno.some((k) => set.has(k)));
}

export const routingOf = (r: TriageRow): Routing =>
  (ROUTINGS as readonly string[]).includes(r.primera_parada ?? "")
    ? r.primera_parada as Routing
    : ROUTING_FROM_LIGHT[r.semaforo ?? ""] ?? "consulta";

export function rank(rows: TriageRow[], kws: string[]): (TriageRow & { score: number })[] {
  const set = new Set(kws);
  return rows
    .filter((r) => eligible(r, set))
    .map((r) => ({ ...r, score: (r.keywords ?? []).filter((k) => set.has(k)).reduce((s, k) => s + weight(k), 0) }))
    .filter((r) => r.score > 0)
    .sort((a, b) =>
      b.score - a.score ||
      (SEVERITY[a.semaforo ?? ""] ?? 9) - (SEVERITY[b.semaforo ?? ""] ?? 9)
    );
}

export async function suggestSpecialty(supabase: SupabaseClient, rawKeywords: string[]): Promise<SuggestResult> {
  const kws = unique(rawKeywords.map((k) => k.trim().toLowerCase()));
  const unknown = kws.filter((k) => !ALL_KEYWORDS.includes(k));
  if (kws.length === 0 || unknown.length) {
    return { ok: false, code: "invalid_keywords", message_es: `Términos fuera del catálogo: ${unknown.join(", ") || "(vacío)"}` };
  }

  // Read on every call (no cache): a change saved from Catálogos → Triaje
  // applies to the very next suggest_specialty. Inactive conditions are ignored.
  const { count, error: countErr } = await supabase.from("triage_findmed").select("id", { count: "exact", head: true }).eq("is_active", true);
  if (countErr) return { ok: false, code: "temporarily_unavailable", message_es: "No pude consultar el catálogo de orientación." };
  if (!count) return { ok: false, code: "catalog_unavailable", message_es: "La orientación por síntomas no está disponible todavía." };

  const { data: mapRows } = await supabase.from("triage_specialty_map").select("especialidad, patient_label, search_specialties");
  const map = new Map(((mapRows ?? []) as SpecialtyMap[]).map((m) => [m.especialidad, m]));

  const toCandidate = (r: TriageRow & { score: number }): SpecialtyCandidate => {
    const m = map.get(r.especialidad);
    return {
      catalog_id: r.id ?? null,
      especialidad: r.especialidad,
      patient_label: m?.patient_label ?? r.especialidad,
      search_specialties: m?.search_specialties ?? [],
      semaforo: r.semaforo,
      routing: routingOf(r),
      alarm_signals: r.si_esto_aparece_subir_a_urgencias?.trim() || null,
      pregunta_diferencial: r.pregunta_diferencial?.trim() || null,
      score: r.score,
    };
  };

  const tries = attempts(kws);
  for (const [i, attempt] of tries.entries()) {
    const { data, error } = await supabase
      .from("triage_findmed")
      .select("id, especialidad, semaforo, primera_parada, si_esto_aparece_subir_a_urgencias, pregunta_diferencial, keywords, requiere_todos, requiere_alguno")
      .eq("is_active", true)
      .overlaps("keywords", attempt)
      .limit(300);
    if (error) return { ok: false, code: "temporarily_unavailable", message_es: "No pude consultar el catálogo de orientación." };
    const ranked = rank((data ?? []) as TriageRow[], attempt).map(toCandidate);
    if (ranked.length === 0) continue;

    const best = ranked[0];
    const top = ranked.filter((c) => c.score === best.score);
    // A tie only matters if it would change who the patient sees or where they go.
    const tie = top.some((c) => c.especialidad !== best.especialidad || c.routing !== best.routing);
    return {
      ok: true,
      result: tie ? "tie" : "one",
      best,
      candidates: (tie ? top : ranked.slice(1)).slice(0, 3),
      keywords_used: attempt,
      broadened: i > 0,
    };
  }
  return { ok: true, result: "none", keywords_used: tries.at(-1) ?? kws, broadened: true };
}
