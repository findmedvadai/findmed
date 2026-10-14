// Catálogo de triaje (Configuración → Catálogos → Triaje): cliente de la Edge
// Function triage-admin, etiquetas en español y helpers puros de la vista.
// Las lecturas van directo a las tablas por RLS (admins); toda escritura pasa
// por triage-admin, que valida contra el vocabulario del motor
// (supabase/functions/_shared/triage.ts) y registra el cambio en triage_changes.
// El vocabulario NO se duplica aquí: se pide a la función (acción "vocabulary").
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import type { Tone } from "@/components/app/StatCard";

export type TriageCondition = Tables<"triage_findmed">;
export type TriageMapping = Tables<"triage_specialty_map">;
export type TriageChange = Tables<"triage_changes">;

export type KeywordCategory = "zona_cuerpo" | "sintoma" | "contexto";

export interface TriageVocabulary {
  keywords: Record<KeywordCategory, string[]>;
  half_weight: string[];
  routings: string[];
  lights: string[];
  origenes: string[];
}

export interface SpecialtyCoverage {
  name: string;
  is_active: boolean;
  active_doctors: number;
}

export interface EngineCandidate {
  catalog_id: number | null;
  especialidad: string;
  patient_label: string;
  search_specialties: string[];
  semaforo: string | null;
  routing: string;
  alarm_signals: string | null;
  pregunta_diferencial: string | null;
  score: number;
}

export type EngineResult =
  | { ok: true; result: "one" | "tie"; best: EngineCandidate; candidates: EngineCandidate[]; keywords_used: string[]; broadened: boolean }
  | { ok: true; result: "none"; keywords_used: string[]; broadened: true };

export interface TriageTestResponse {
  result: EngineResult;
  conditions: { id: number; padecimiento: string | null; validado: boolean }[];
}

export class TriageAdminError extends Error {
  code: string | null;
  problems: string[];
  constructor(message: string, code: string | null, problems: string[]) {
    super(message);
    this.code = code;
    this.problems = problems;
  }
}

/** Llama a triage-admin. En error lanza TriageAdminError con el mensaje del backend en español. */
export async function triageAdmin<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const res = await supabase.functions.invoke("triage-admin", {
    body,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (res.error) {
    let message = "No se pudo completar la acción.";
    let code: string | null = null;
    let problems: string[] = [];
    const ctx = (res.error as { context?: Response }).context;
    if (ctx && typeof ctx.clone === "function") {
      const json = (await ctx.clone().json().catch(() => null)) as { error?: string; message?: string; problems?: string[] } | null;
      if (json?.message) message = json.message;
      code = json?.error ?? null;
      problems = json?.problems ?? [];
    }
    throw new TriageAdminError(message, code, problems);
  }
  return res.data as T;
}

/* ───────── etiquetas ───────── */

export const ROUTING: Record<string, { label: string; tone: Tone }> = {
  urgencias_inmediato: { label: "Urgencias inmediato", tone: "danger" },
  urgencias_hoy: { label: "Urgencias hoy", tone: "warning" },
  consulta_mismo_dia: { label: "Consulta el mismo día", tone: "info" },
  consulta: { label: "Consulta", tone: "success" },
};

export const LIGHT: Record<string, { label: string; tone: Tone }> = {
  ROJO: { label: "Rojo", tone: "danger" },
  NARANJA: { label: "Naranja", tone: "warning" },
  AMARILLO: { label: "Amarillo", tone: "info" },
  VERDE: { label: "Verde", tone: "success" },
};

export const ORIGEN_LABEL: Record<string, string> = {
  n8n_v1: "n8n v1",
  n8n_v1_ajustado: "n8n v1 ajustado",
  nuevo: "Nuevo",
};

export const CATEGORY_LABEL: Record<KeywordCategory, string> = {
  zona_cuerpo: "Zona del cuerpo",
  sintoma: "Síntoma",
  contexto: "Contexto",
};

export const CHANGE_ACTION_LABEL: Record<string, string> = {
  create: "Creó la condición",
  update: "Editó la condición",
  duplicate: "Creó como copia",
  activate: "Activó",
  deactivate: "Desactivó",
  validate: "Marcó como validada",
  unvalidate: "Quitó la validación",
  delete: "Eliminó",
  map_create: "Agregó al mapeo",
  map_update: "Editó el mapeo",
  map_delete: "Quitó del mapeo",
};

export const FIELD_LABEL: Record<string, string> = {
  especialidad: "Especialidad",
  padecimiento: "Padecimiento",
  semaforo: "Semáforo",
  primera_parada: "Primera parada",
  keywords: "Palabras clave",
  requiere_todos: "Requiere todos",
  requiere_alguno: "Requiere alguno",
  si_esto_aparece_subir_a_urgencias: "Señales de alarma",
  pregunta_diferencial: "Pregunta diferencial",
  accion_operativa: "Acción operativa",
  origen: "Origen",
  notas: "Notas",
  validado: "Validada",
  is_active: "Activa",
};

const ACCENTED: Record<string, string> = {
  oido: "oído", muneca: "muñeca", talon: "talón", testiculo: "testículo", vomito: "vómito", nausea: "náusea",
  inflamacion: "inflamación", convulsion: "convulsión", sudoracion: "sudoración", retencion: "retención",
  secrecion: "secreción", perdida: "pérdida", audicion: "audición", vision: "visión", confusion: "confusión",
  ulcera: "úlcera", estrenimiento: "estreñimiento", comezon: "comezón", congestion: "congestión",
  subito: "súbito", cronico: "crónico", cancer: "cáncer", caida: "caída", menstruacion: "menstruación", presion: "presión",
};

/** Término del vocabulario legible para personas: "perdida_audicion" → "pérdida audición". */
export const keywordLabel = (k: string) => k.split("_").map((w) => ACCENTED[w] ?? w).join(" ");

/* ───────── filtros y conteos ───────── */

export interface ConditionFilters {
  search: string;
  especialidad: string; // "all" o la clave
  routing: string; // "all" o la ruta
  light: string; // "all" o el semáforo
  validated: "all" | "yes" | "no";
  origen: string; // "all" o el origen
  status: "all" | "active" | "inactive";
}

export const EMPTY_FILTERS: ConditionFilters = {
  search: "", especialidad: "all", routing: "all", light: "all", validated: "all", origen: "all", status: "all",
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function filterConditions(rows: TriageCondition[], f: ConditionFilters): TriageCondition[] {
  const term = norm(f.search.trim());
  return rows.filter((r) => {
    if (f.especialidad !== "all" && r.especialidad !== f.especialidad) return false;
    if (f.routing !== "all" && r.primera_parada !== f.routing) return false;
    if (f.light !== "all" && r.semaforo !== f.light) return false;
    if (f.validated === "yes" && !r.validado) return false;
    if (f.validated === "no" && r.validado) return false;
    if (f.origen !== "all" && (r.origen ?? "") !== f.origen) return false;
    if (f.status === "active" && !r.is_active) return false;
    if (f.status === "inactive" && r.is_active) return false;
    if (!term) return true;
    const hay = [r.padecimiento, r.especialidad, r.notas, r.pregunta_diferencial, r.si_esto_aparece_subir_a_urgencias, ...(r.keywords ?? []).map(keywordLabel), ...(r.keywords ?? [])]
      .filter(Boolean)
      .map((v) => norm(String(v)))
      .join(" ");
    return term.split(/\s+/).every((t) => hay.includes(t));
  });
}

export const hasActiveFilters = (f: ConditionFilters) =>
  Object.entries(f).some(([k, v]) => (k === "search" ? !!String(v).trim() : v !== "all"));

export function countConditions(rows: TriageCondition[]) {
  const byRouting: Record<string, number> = {};
  let active = 0;
  let validated = 0;
  for (const r of rows) {
    if (r.is_active) {
      active++;
      const k = r.primera_parada ?? "sin_definir";
      byRouting[k] = (byRouting[k] ?? 0) + 1;
    }
    if (r.validado) validated++;
  }
  return { total: rows.length, active, inactive: rows.length - active, validated, byRouting };
}

/* ───────── formulario ───────── */

export interface ConditionForm {
  especialidad: string;
  padecimiento: string;
  semaforo: string;
  primera_parada: string;
  keywords: string[];
  requiere_todos: string[];
  requiere_alguno: string[];
  si_esto_aparece_subir_a_urgencias: string;
  pregunta_diferencial: string;
  accion_operativa: string;
  origen: string;
  notas: string;
  validado: boolean;
}

export const emptyConditionForm = (especialidad = ""): ConditionForm => ({
  especialidad, padecimiento: "", semaforo: "", primera_parada: "", keywords: [], requiere_todos: [], requiere_alguno: [],
  si_esto_aparece_subir_a_urgencias: "", pregunta_diferencial: "", accion_operativa: "", origen: "nuevo", notas: "", validado: false,
});

export const formFromCondition = (c: TriageCondition): ConditionForm => ({
  especialidad: c.especialidad,
  padecimiento: c.padecimiento ?? "",
  semaforo: c.semaforo ?? "",
  primera_parada: c.primera_parada ?? "",
  keywords: c.keywords ?? [],
  requiere_todos: c.requiere_todos ?? [],
  requiere_alguno: c.requiere_alguno ?? [],
  si_esto_aparece_subir_a_urgencias: c.si_esto_aparece_subir_a_urgencias ?? "",
  pregunta_diferencial: c.pregunta_diferencial ?? "",
  accion_operativa: c.accion_operativa ?? "",
  origen: c.origen ?? "",
  notas: c.notas ?? "",
  validado: c.validado,
});

/** Lo que el formulario sabe validar antes de enviar (el servidor revalida todo). */
export function formProblems(f: ConditionForm): string[] {
  const p: string[] = [];
  if (!f.especialidad) p.push("Elige la especialidad.");
  if (!f.padecimiento.trim()) p.push("Escribe el padecimiento.");
  if (!f.semaforo) p.push("Elige el semáforo.");
  if (!f.primera_parada) p.push("Elige la primera parada.");
  if (f.keywords.length === 0) p.push("Agrega al menos una palabra clave.");
  return p;
}

export const formToPayload = (f: ConditionForm) => ({
  ...f,
  origen: f.origen || null,
});

/** Campos que cambiaron entre el antes y el después de un registro del historial. */
export function changedFields(before: unknown, after: unknown): string[] {
  if (!before || !after || typeof before !== "object" || typeof after !== "object") return [];
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  return Object.keys(FIELD_LABEL).filter((k) => k in a && JSON.stringify(b[k] ?? null) !== JSON.stringify(a[k] ?? null));
}

const STOPWORDS = new Set(["que", "con", "por", "del", "los", "las", "una", "uno", "mas", "sin", "muy", "tengo", "desde", "para", "pero", "cuando", "esta", "este", "eso", "hace", "dias"]);

/**
 * Para el probador: sugiere términos del vocabulario a partir de un texto libre
 * ("me duele la rodilla desde que me caí" → rodilla, caida). Solo sugiere; la
 * persona elige qué términos manda al motor.
 */
export function suggestKeywords(text: string, vocabulary: readonly string[]): string[] {
  const tokens = norm(text).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  if (tokens.length === 0) return [];
  const hits = (word: string) =>
    tokens.some((t) => t === word || (word.length >= 4 && (word.startsWith(t) || (t.length >= 4 && t.startsWith(word.slice(0, Math.max(4, word.length - 2)))))));
  return vocabulary.filter((k) => {
    const words = norm(keywordLabel(k)).split(" ");
    return words.every((w) => w.length < 3 || hits(w));
  });
}
