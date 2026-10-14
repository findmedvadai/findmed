// Triage catalog admin (Configuración → Catálogos → Triaje). Reads for the page
// go straight to the tables through RLS (admins); every write goes through
// here so the clinical catalog is validated against the engine's closed
// vocabulary (_shared/triage.ts) and every change lands in triage_changes.
// Separate from index.ts so tests can inject the database and the auth check.
//
// POST { action, ... } → 200 { ... } | 4xx { error, message, problems? }
//   vocabulary                                  → keywords by category, half-weight terms, routes, lights, origins
//   coverage                                    → FindMed specialties with their active doctors
//   test               { keywords }             → result of the real engine (suggestSpecialty)
//   condition_create   { condition }
//   condition_update   { id, condition, expected_updated_at? }
//   condition_duplicate { id }                  → inactive, unvalidated copy
//   condition_set_active { id, is_active, expected_updated_at? }
//   condition_set_validated { id, validado, expected_updated_at? }
//   condition_delete   { id }
//   map_create / map_update { mapping }        → triage specialty → patient label + FindMed specialties
//   map_delete         { especialidad }         → refused while a condition uses it
//
// The engine reads the catalog on every call (no cache), so a saved change
// applies to the agent's next suggest_specialty without a redeploy.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { HALF_WEIGHT_KEYWORDS, KEYWORDS, ROUTINGS, suggestSpecialty, unknownKeywords } from "../_shared/triage.ts";

export const LIGHTS = ["ROJO", "NARANJA", "AMARILLO", "VERDE"] as const;
export const ORIGENES = ["n8n_v1", "n8n_v1_ajustado", "nuevo"] as const;

/** Fields that change what the agent does: editing them re-stamps who validated. */
const CLINICAL_FIELDS = [
  "especialidad", "padecimiento", "semaforo", "primera_parada", "keywords", "requiere_todos", "requiere_alguno",
  "si_esto_aparece_subir_a_urgencias", "pregunta_diferencial", "accion_operativa",
] as const;

const EDITABLE_FIELDS = [...CLINICAL_FIELDS, "origen", "notas", "validado"] as const;

const MAX_TEXT = 2000;
const MAX_TERMS = 40;
const MAP_KEY_RE = /^[A-Za-z][A-Za-z+]{1,59}$/;

export interface TriageAdminDeps {
  supabase: SupabaseClient;
  authorize: (req: Request) => Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }>;
  now?: () => Date;
}

type Row = Record<string, unknown>;

export interface ConditionInput {
  especialidad: string;
  padecimiento: string;
  semaforo: string;
  primera_parada: string;
  keywords: string[];
  requiere_todos: string[];
  requiere_alguno: string[];
  si_esto_aparece_subir_a_urgencias: string | null;
  pregunta_diferencial: string | null;
  accion_operativa: string | null;
  origen: string | null;
  notas: string | null;
  validado: boolean;
}

const bad = (error: string, message: string, status = 400, extra: Row = {}) => jsonResponse({ error, message, ...extra }, status);

const terms = (v: unknown): string[] | null => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((k) => typeof k !== "string")) return null;
  return [...new Set((v as string[]).map((k) => k.trim().toLowerCase()).filter(Boolean))];
};

const text = (v: unknown): string | null | undefined => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : null;
};

/**
 * Validates a condition against the engine's vocabulary and the catalog's
 * rules. Returns the normalized value or every problem found (in Spanish).
 */
export function validateCondition(raw: unknown, knownSpecialties: ReadonlySet<string>): { ok: true; value: ConditionInput } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  if (!raw || typeof raw !== "object") return { ok: false, problems: ["Faltan los datos de la condición."] };
  const c = raw as Row;

  const especialidad = text(c.especialidad);
  if (!especialidad) problems.push("Elige la especialidad.");
  else if (!knownSpecialties.has(especialidad)) {
    problems.push(`La especialidad «${especialidad}» no está en el mapeo de especialidades. Agrégala primero en la vista Mapeo.`);
  }

  const padecimiento = text(c.padecimiento);
  if (!padecimiento) problems.push("Escribe el padecimiento (uso interno).");
  else if (padecimiento.length > 200) problems.push("El padecimiento no puede pasar de 200 caracteres.");

  const semaforo = typeof c.semaforo === "string" ? c.semaforo.trim().toUpperCase() : "";
  if (!(LIGHTS as readonly string[]).includes(semaforo)) problems.push("Elige el semáforo (rojo, naranja, amarillo o verde).");

  const primera = typeof c.primera_parada === "string" ? c.primera_parada.trim() : "";
  if (!(ROUTINGS as readonly string[]).includes(primera)) problems.push("Elige la primera parada.");

  const lists: Record<"keywords" | "requiere_todos" | "requiere_alguno", string[]> = { keywords: [], requiere_todos: [], requiere_alguno: [] };
  const LIST_LABEL = { keywords: "Palabras clave", requiere_todos: "Requiere todos", requiere_alguno: "Requiere alguno" } as const;
  for (const f of ["keywords", "requiere_todos", "requiere_alguno"] as const) {
    const v = terms(c[f]);
    if (v === null) {
      problems.push(`${LIST_LABEL[f]}: debe ser una lista de términos.`);
      continue;
    }
    if (v.length > MAX_TERMS) problems.push(`${LIST_LABEL[f]}: máximo ${MAX_TERMS} términos.`);
    const unknown = unknownKeywords(v);
    if (unknown.length) {
      problems.push(`${LIST_LABEL[f]}: «${unknown.join("», «")}» no está en el vocabulario del motor. El agente solo entiende los términos del catálogo; elige uno de la lista.`);
    }
    lists[f] = v;
  }
  if (lists.keywords.length === 0) problems.push("Agrega al menos una palabra clave.");

  const longText: Record<string, string | null> = {};
  const TEXT_LABEL: Record<string, string> = {
    si_esto_aparece_subir_a_urgencias: "Señales de alarma",
    pregunta_diferencial: "Pregunta diferencial",
    accion_operativa: "Acción operativa",
    notas: "Notas",
  };
  for (const f of Object.keys(TEXT_LABEL)) {
    const v = text(c[f]);
    if (v === undefined) problems.push(`${TEXT_LABEL[f]}: texto inválido.`);
    else if (v && v.length > MAX_TEXT) problems.push(`${TEXT_LABEL[f]}: máximo ${MAX_TEXT} caracteres.`);
    longText[f] = v ?? null;
  }

  const origen = text(c.origen);
  if (origen && !(ORIGENES as readonly string[]).includes(origen)) problems.push("Origen inválido.");
  if (c.validado !== undefined && typeof c.validado !== "boolean") problems.push("Validada: valor inválido.");

  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    value: {
      especialidad: especialidad!,
      padecimiento: padecimiento!,
      semaforo,
      primera_parada: primera,
      ...lists,
      si_esto_aparece_subir_a_urgencias: longText.si_esto_aparece_subir_a_urgencias,
      pregunta_diferencial: longText.pregunta_diferencial,
      accion_operativa: longText.accion_operativa,
      notas: longText.notas,
      origen: origen ?? null,
      validado: c.validado === true,
    },
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const sameInstant = (a: unknown, b: unknown) =>
  typeof a === "string" && typeof b === "string" && new Date(a).getTime() === new Date(b).getTime();

function parseId(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export async function handleTriageAdmin(req: Request, deps: TriageAdminDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return bad("method_not_allowed", "Método no permitido", 405);

  const auth = await deps.authorize(req);
  if (!auth.ok) return bad(auth.status === 403 ? "forbidden" : "unauthorized", auth.status === 403 ? "Solo administradores." : "Sesión inválida.", auth.status);

  let body: Row;
  try {
    body = await req.json();
  } catch {
    return bad("invalid_json", "Cuerpo inválido");
  }

  const { supabase } = deps;
  const now = () => (deps.now ? deps.now() : new Date()).toISOString();
  let actorEmail: string | null | undefined;
  const actor = async () => {
    if (actorEmail === undefined) {
      const { data } = await supabase.from("users").select("email").eq("id", auth.userId).maybeSingle();
      actorEmail = (data as { email?: string } | null)?.email ?? null;
    }
    return { actor_user_id: auth.userId, actor_email: actorEmail };
  };

  /** Append-only log; a failed insert never undoes the change but is reported. */
  const log = async (entry: { entity: "condition" | "specialty_map"; action: string; condition_id?: number | null; especialidad?: string | null; before?: unknown; after?: unknown }): Promise<string[]> => {
    const { error } = await supabase.from("triage_changes").insert({
      entity: entry.entity,
      action: entry.action,
      condition_id: entry.condition_id ?? null,
      especialidad: entry.especialidad ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ...(await actor()),
    });
    if (error) {
      console.error("triage-admin: triage_changes insert failed", error);
      return ["El cambio se guardó, pero no se pudo registrar en el historial."];
    }
    return [];
  };

  const knownSpecialties = async (): Promise<Set<string> | null> => {
    const { data, error } = await supabase.from("triage_specialty_map").select("especialidad");
    if (error) return null;
    return new Set(((data ?? []) as { especialidad: string }[]).map((m) => m.especialidad));
  };

  const loadCondition = async (id: number): Promise<Row | null> => {
    const { data } = await supabase.from("triage_findmed").select("*").eq("id", id).maybeSingle();
    return (data as Row | null) ?? null;
  };

  /** CAS on updated_at: two admins editing the same condition never overwrite each other silently. */
  const casUpdate = async (before: Row, patch: Row): Promise<Row | "conflict" | "error"> => {
    const { data, error } = await supabase
      .from("triage_findmed")
      .update(patch)
      .eq("id", before.id)
      .eq("updated_at", before.updated_at)
      .select("*");
    if (error) return "error";
    const rows = (data ?? []) as Row[];
    return rows[0] ?? "conflict";
  };

  const conflict = () => bad("concurrent_change", "Alguien más modificó esta condición. Recarga para ver la versión actual.", 409);
  const staleCheck = (row: Row) =>
    body.expected_updated_at !== undefined && body.expected_updated_at !== null && !sameInstant(row.updated_at, body.expected_updated_at);

  switch (body.action) {
    case "vocabulary":
      return jsonResponse({
        keywords: KEYWORDS,
        half_weight: HALF_WEIGHT_KEYWORDS,
        routings: ROUTINGS,
        lights: LIGHTS,
        origenes: ORIGENES,
      });

    case "coverage": {
      const [specs, links, docs, offices] = await Promise.all([
        supabase.from("specialties").select("id, name, is_active"),
        supabase.from("doctor_specialties").select("doctor_id, specialty_id"),
        supabase.from("doctors").select("id, is_active, is_deleted"),
        supabase.from("doctor_offices").select("doctor_id, is_active, is_deleted"),
      ]);
      if (specs.error || links.error || docs.error || offices.error) return bad("query_error", "No se pudo calcular la cobertura de médicos.", 500);
      const activeDoctors = new Set(
        ((docs.data ?? []) as Row[]).filter((d) => d.is_active === true && d.is_deleted !== true).map((d) => d.id as string),
      );
      const withOffice = new Set(
        ((offices.data ?? []) as Row[]).filter((o) => o.is_active === true && o.is_deleted !== true).map((o) => o.doctor_id as string),
      );
      const bySpecialty = new Map<string, Set<string>>();
      for (const l of (links.data ?? []) as Row[]) {
        const d = l.doctor_id as string;
        if (!activeDoctors.has(d) || !withOffice.has(d)) continue;
        const s = l.specialty_id as string;
        if (!bySpecialty.has(s)) bySpecialty.set(s, new Set());
        bySpecialty.get(s)!.add(d);
      }
      return jsonResponse({
        specialties: ((specs.data ?? []) as Row[])
          .map((s) => ({ name: s.name as string, is_active: s.is_active === true, active_doctors: bySpecialty.get(s.id as string)?.size ?? 0 }))
          .sort((a, b) => a.name.localeCompare(b.name, "es")),
      });
    }

    case "test": {
      const kws = terms(body.keywords);
      if (kws === null || kws.length === 0) return bad("invalid_keywords", "Elige al menos una palabra clave.");
      const result = await suggestSpecialty(supabase, kws);
      if (!result.ok) return bad(result.code, result.message_es, result.code === "invalid_keywords" ? 400 : 503);
      // For the team only (the agent never sees condition names).
      const ids = result.result === "none" ? [] : [result.best, ...result.candidates].map((c) => c.catalog_id).filter((v): v is number => v !== null);
      let conditions: Row[] = [];
      if (ids.length) {
        const { data } = await supabase.from("triage_findmed").select("id, padecimiento, validado").in("id", ids);
        conditions = (data ?? []) as Row[];
      }
      return jsonResponse({ result, conditions });
    }

    case "condition_create": {
      const known = await knownSpecialties();
      if (!known) return bad("query_error", "No se pudo leer el mapeo de especialidades.", 500);
      const v = validateCondition(body.condition, known);
      if (!v.ok) return bad("invalid_condition", v.problems.join(" "), 400, { problems: v.problems });
      const who = await actor();
      const at = now();
      const insert: Row = {
        ...v.value,
        origen: v.value.origen ?? "nuevo",
        is_active: true,
        source: "findmed_admin",
        updated_at: at,
        updated_by: who.actor_user_id,
        ...(v.value.validado
          ? { validated_by: who.actor_user_id, validated_by_email: who.actor_email, validated_at: at }
          : { validated_by: null, validated_by_email: null, validated_at: null }),
      };
      const { data, error } = await supabase.from("triage_findmed").insert(insert).select("*").single();
      if (error || !data) return bad("write_failed", "No se pudo crear la condición.", 500);
      const row = data as Row;
      const warnings = await log({ entity: "condition", action: "create", condition_id: row.id as number, after: row });
      return jsonResponse({ condition: row, warnings });
    }

    case "condition_update": {
      const id = parseId(body.id);
      if (!id) return bad("invalid_id", "Condición inválida.");
      const before = await loadCondition(id);
      if (!before) return bad("not_found", "La condición ya no existe.", 404);
      if (staleCheck(before)) return conflict();
      const known = await knownSpecialties();
      if (!known) return bad("query_error", "No se pudo leer el mapeo de especialidades.", 500);
      const v = validateCondition(body.condition, known);
      if (!v.ok) return bad("invalid_condition", v.problems.join(" "), 400, { problems: v.problems });

      const changed = EDITABLE_FIELDS.filter((f) => !same(before[f], (v.value as unknown as Row)[f]));
      if (changed.length === 0) return jsonResponse({ condition: before, unchanged: true, warnings: [] });
      const clinicalChanged = changed.some((f) => (CLINICAL_FIELDS as readonly string[]).includes(f));

      const who = await actor();
      const at = now();
      const patch: Row = { ...v.value, updated_at: at, updated_by: who.actor_user_id };
      if (!v.value.validado) Object.assign(patch, { validated_by: null, validated_by_email: null, validated_at: null });
      else if (before.validado !== true || clinicalChanged) {
        // Saving clinical changes with the switch on = the current admin vouches for the new version.
        Object.assign(patch, { validated_by: who.actor_user_id, validated_by_email: who.actor_email, validated_at: at });
      }
      const after = await casUpdate(before, patch);
      if (after === "conflict") return conflict();
      if (after === "error") return bad("write_failed", "No se pudo guardar la condición.", 500);
      const onlyValidation = changed.length === 1 && changed[0] === "validado";
      const action = onlyValidation ? (v.value.validado ? "validate" : "unvalidate") : "update";
      const warnings = await log({ entity: "condition", action, condition_id: id, before, after });
      return jsonResponse({ condition: after, warnings });
    }

    case "condition_duplicate": {
      const id = parseId(body.id);
      if (!id) return bad("invalid_id", "Condición inválida.");
      const src = await loadCondition(id);
      if (!src) return bad("not_found", "La condición ya no existe.", 404);
      const who = await actor();
      const at = now();
      const copy: Row = {
        especialidad: src.especialidad,
        padecimiento: `${(src.padecimiento as string | null) ?? "Condición"} (copia)`.slice(0, 200),
        semaforo: src.semaforo,
        primera_parada: src.primera_parada,
        keywords: src.keywords ?? [],
        requiere_todos: src.requiere_todos ?? [],
        requiere_alguno: src.requiere_alguno ?? [],
        si_esto_aparece_subir_a_urgencias: src.si_esto_aparece_subir_a_urgencias ?? null,
        pregunta_diferencial: src.pregunta_diferencial ?? null,
        accion_operativa: src.accion_operativa ?? null,
        notas: src.notas ?? null,
        origen: "nuevo",
        // A copy starts inactive and unvalidated: identical rows would tie in
        // the engine, and the copy has not been reviewed.
        is_active: false,
        validado: false,
        source: "findmed_admin",
        extra: { duplicated_from: id },
        updated_at: at,
        updated_by: who.actor_user_id,
      };
      const { data, error } = await supabase.from("triage_findmed").insert(copy).select("*").single();
      if (error || !data) return bad("write_failed", "No se pudo duplicar la condición.", 500);
      const row = data as Row;
      const warnings = await log({ entity: "condition", action: "duplicate", condition_id: row.id as number, before: { duplicated_from: id }, after: row });
      return jsonResponse({ condition: row, warnings });
    }

    case "condition_set_active":
    case "condition_set_validated": {
      const id = parseId(body.id);
      if (!id) return bad("invalid_id", "Condición inválida.");
      const isActive = body.action === "condition_set_active";
      const value = isActive ? body.is_active : body.validado;
      if (typeof value !== "boolean") return bad("invalid_value", "Valor inválido.");
      const before = await loadCondition(id);
      if (!before) return bad("not_found", "La condición ya no existe.", 404);
      if (staleCheck(before)) return conflict();
      const field = isActive ? "is_active" : "validado";
      if (before[field] === value) return jsonResponse({ condition: before, unchanged: true, warnings: [] });
      const who = await actor();
      const at = now();
      const patch: Row = { [field]: value, updated_at: at, updated_by: who.actor_user_id };
      if (!isActive) {
        Object.assign(patch, value
          ? { validated_by: who.actor_user_id, validated_by_email: who.actor_email, validated_at: at }
          : { validated_by: null, validated_by_email: null, validated_at: null });
      }
      const after = await casUpdate(before, patch);
      if (after === "conflict") return conflict();
      if (after === "error") return bad("write_failed", "No se pudo guardar el cambio.", 500);
      const action = isActive ? (value ? "activate" : "deactivate") : (value ? "validate" : "unvalidate");
      const warnings = await log({ entity: "condition", action, condition_id: id, before, after });
      return jsonResponse({ condition: after, warnings });
    }

    case "condition_delete": {
      const id = parseId(body.id);
      if (!id) return bad("invalid_id", "Condición inválida.");
      const before = await loadCondition(id);
      if (!before) return bad("not_found", "La condición ya no existe.", 404);
      const { error } = await supabase.from("triage_findmed").delete().eq("id", id);
      if (error) return bad("write_failed", "No se pudo eliminar la condición.", 500);
      const warnings = await log({ entity: "condition", action: "delete", condition_id: id, before });
      return jsonResponse({ deleted: id, warnings });
    }

    case "map_create":
    case "map_update": {
      const creating = body.action === "map_create";
      const m = (body.mapping ?? {}) as Row;
      const problems: string[] = [];
      const especialidad = text(m.especialidad);
      if (!especialidad || !MAP_KEY_RE.test(especialidad)) {
        problems.push("Clave de especialidad inválida: solo letras sin acentos ni espacios (p. ej. «Dermatologia»).");
      }
      const label = text(m.patient_label);
      if (!label) problems.push("Escribe cómo se le dice al paciente (p. ej. «Dermatólogo»).");
      else if (label.length > 80) problems.push("La etiqueta no puede pasar de 80 caracteres.");
      const notes = text(m.notes);
      if (notes === undefined || (notes && notes.length > 500)) problems.push("Notas inválidas (máximo 500 caracteres).");
      const search = Array.isArray(m.search_specialties) && m.search_specialties.every((s) => typeof s === "string")
        ? [...new Set((m.search_specialties as string[]).map((s) => s.trim()).filter(Boolean))]
        : null;
      if (search === null) problems.push("Especialidades de búsqueda: debe ser una lista.");
      if (problems.length) return bad("invalid_mapping", problems.join(" "), 400, { problems });

      const { data: existing } = await supabase.from("triage_specialty_map").select("*").eq("especialidad", especialidad!).maybeSingle();
      if (creating && existing) return bad("map_exists", `Ya existe la especialidad «${especialidad}» en el mapeo.`, 409);
      if (!creating && !existing) return bad("not_found", "Esa especialidad ya no está en el mapeo.", 404);

      const { data: specRows, error: specErr } = await supabase.from("specialties").select("name, is_active");
      if (specErr) return bad("query_error", "No se pudo leer el catálogo de especialidades.", 500);
      const specs = new Map(((specRows ?? []) as Row[]).map((s) => [s.name as string, s.is_active === true]));
      const kept = new Set(((existing as Row | null)?.search_specialties as string[] | undefined) ?? []);
      const missing = search!.filter((s) => !specs.has(s));
      // Newly added search specialties must be active; ones already mapped may stay while inactive.
      const inactive = search!.filter((s) => specs.get(s) === false && !kept.has(s));
      if (missing.length || inactive.length) {
        const msg = [
          missing.length ? `No existen en Especialidades: ${missing.join(", ")}.` : "",
          inactive.length ? `Están inactivas: ${inactive.join(", ")}.` : "",
        ].filter(Boolean).join(" ");
        return bad("invalid_mapping", msg, 400, { problems: [msg] });
      }

      const value = { especialidad: especialidad!, patient_label: label!, search_specialties: search!, notes: notes ?? null };
      if (existing && !creating && same(
        [existing.patient_label, existing.search_specialties, existing.notes ?? null],
        [value.patient_label, value.search_specialties, value.notes],
      )) return jsonResponse({ mapping: existing, unchanged: true, warnings: [] });

      const q = creating
        ? supabase.from("triage_specialty_map").insert(value).select("*").single()
        : supabase.from("triage_specialty_map").update(value).eq("especialidad", especialidad!).select("*").single();
      const { data, error } = await q;
      if (error || !data) return bad("write_failed", "No se pudo guardar el mapeo.", 500);
      const warnings = await log({
        entity: "specialty_map",
        action: creating ? "map_create" : "map_update",
        especialidad,
        before: existing ?? null,
        after: data,
      });
      const stillInactive = search!.filter((s) => specs.get(s) === false);
      if (stillInactive.length) warnings.push(`Especialidades inactivas en la búsqueda: ${stillInactive.join(", ")}.`);
      return jsonResponse({ mapping: data, warnings });
    }

    case "map_delete": {
      const especialidad = text(body.especialidad);
      if (!especialidad) return bad("invalid_mapping", "Especialidad inválida.");
      const { data: existing } = await supabase.from("triage_specialty_map").select("*").eq("especialidad", especialidad).maybeSingle();
      if (!existing) return bad("not_found", "Esa especialidad ya no está en el mapeo.", 404);
      const { count, error: useErr } = await supabase
        .from("triage_findmed")
        .select("id", { count: "exact", head: true })
        .eq("especialidad", especialidad);
      if (useErr) return bad("query_error", "No se pudo revisar el uso de la especialidad.", 500);
      if (count) {
        return bad("map_in_use", `${count} ${count === 1 ? "condición usa" : "condiciones usan"} esta especialidad. Cámbialas o elimínalas antes de quitarla del mapeo.`, 409);
      }
      const { error } = await supabase.from("triage_specialty_map").delete().eq("especialidad", especialidad);
      if (error) return bad("write_failed", "No se pudo eliminar el mapeo.", 500);
      const warnings = await log({ entity: "specialty_map", action: "map_delete", especialidad, before: existing });
      return jsonResponse({ deleted: especialidad, warnings });
    }

    default:
      return bad("invalid_action", "Acción inválida.");
  }
}
