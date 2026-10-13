// Specialty orientation from symptoms — M02 suggest_specialty (F10).
//
// Same logic the n8n agent ran as free SQL against triage_findmed, now
// parameterized and deterministic:
//   rows WHERE keywords && $kws, ranked by
//   match_count = |row.keywords ∩ kws| DESC, then semaforo ROJO > NARANJA > AMARILLO > VERDE.
// The best row gives the specialty, its traffic light and the alarm signals
// to ask about. A tie between different specialties at the top is reported
// so the agent asks ONE disambiguating question. With no rows, the search is
// broadened the way the old tool description told the model to do it
// (drop context terms, then keep only the body area) — never "no results".
//
// The keyword catalog below is the closed vocabulary of the original tool
// description; anything else is rejected by the MCP schema.

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
  ],
  contexto: [
    "embarazo", "diabetes", "cancer", "quimioterapia",
    "caida", "golpe", "traumatismo",
    "renal_cronico", "menstruacion", "intermenstrual",
  ],
} as const;

export const ALL_KEYWORDS: readonly string[] = [...KEYWORDS.zona_cuerpo, ...KEYWORDS.sintoma, ...KEYWORDS.contexto];

const SEVERITY: Record<string, number> = { ROJO: 0, NARANJA: 1, AMARILLO: 2, VERDE: 3 };

interface TriageRow {
  especialidad: string;
  semaforo: string | null;
  si_esto_aparece_subir_a_urgencias: string | null;
  keywords: string[];
}

interface SpecialtyMap {
  especialidad: string;
  patient_label: string;
  search_specialties: string[];
}

export interface SpecialtyCandidate {
  especialidad: string;
  /** How to say it to the patient ("Ortopedista"). */
  patient_label: string;
  /** FindMed specialties to pass to search_care_options, in order. Empty = FindMed doesn't offer it. */
  search_specialties: string[];
  semaforo: string | null;
  /** Alarm signals to ask about before recommending (may be null). */
  alarm_signals: string | null;
  match_count: number;
}

export type SuggestResult =
  | {
    ok: true;
    result: "one" | "tie";
    best: SpecialtyCandidate;
    /** Distinct specialties sharing the top score (tie) or the next best ones. */
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

export function rank(rows: TriageRow[], kws: string[]): (TriageRow & { match_count: number })[] {
  const set = new Set(kws);
  return rows
    .map((r) => ({ ...r, match_count: (r.keywords ?? []).filter((k) => set.has(k)).length }))
    .filter((r) => r.match_count > 0)
    .sort((a, b) =>
      b.match_count - a.match_count ||
      (SEVERITY[a.semaforo ?? ""] ?? 9) - (SEVERITY[b.semaforo ?? ""] ?? 9)
    );
}

export async function suggestSpecialty(supabase: SupabaseClient, rawKeywords: string[]): Promise<SuggestResult> {
  const kws = unique(rawKeywords.map((k) => k.trim().toLowerCase()));
  const unknown = kws.filter((k) => !ALL_KEYWORDS.includes(k));
  if (kws.length === 0 || unknown.length) {
    return { ok: false, code: "invalid_keywords", message_es: `Términos fuera del catálogo: ${unknown.join(", ") || "(vacío)"}` };
  }

  const { count, error: countErr } = await supabase.from("triage_findmed").select("id", { count: "exact", head: true });
  if (countErr) return { ok: false, code: "temporarily_unavailable", message_es: "No pude consultar el catálogo de orientación." };
  if (!count) return { ok: false, code: "catalog_unavailable", message_es: "La orientación por síntomas no está disponible todavía." };

  const { data: mapRows } = await supabase.from("triage_specialty_map").select("especialidad, patient_label, search_specialties");
  const map = new Map(((mapRows ?? []) as SpecialtyMap[]).map((m) => [m.especialidad, m]));

  const tries = attempts(kws);
  for (const [i, attempt] of tries.entries()) {
    const { data, error } = await supabase
      .from("triage_findmed")
      .select("especialidad, semaforo, si_esto_aparece_subir_a_urgencias, keywords")
      .overlaps("keywords", attempt)
      .limit(200);
    if (error) return { ok: false, code: "temporarily_unavailable", message_es: "No pude consultar el catálogo de orientación." };
    const ranked = rank((data ?? []) as TriageRow[], attempt);
    if (ranked.length === 0) continue;

    // One candidate per specialty, keeping its best-ranked row.
    const bySpecialty: SpecialtyCandidate[] = [];
    for (const r of ranked) {
      if (bySpecialty.some((c) => c.especialidad === r.especialidad)) continue;
      const m = map.get(r.especialidad);
      bySpecialty.push({
        especialidad: r.especialidad,
        patient_label: m?.patient_label ?? r.especialidad,
        search_specialties: m?.search_specialties ?? [],
        semaforo: r.semaforo,
        alarm_signals: r.si_esto_aparece_subir_a_urgencias?.trim() || null,
        match_count: r.match_count,
      });
    }
    const best = bySpecialty[0];
    const tied = bySpecialty.filter((c) => c.match_count === best.match_count);
    return {
      ok: true,
      result: tied.length > 1 ? "tie" : "one",
      best,
      candidates: (tied.length > 1 ? tied : bySpecialty).slice(0, 3),
      keywords_used: attempt,
      broadened: i > 0,
    };
  }
  return { ok: true, result: "none", keywords_used: tries.at(-1) ?? kws, broadened: true };
}
