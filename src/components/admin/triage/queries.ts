// Lecturas del catálogo de triaje (RLS: solo admins) y llaves de react-query.
// Una llave = una forma de dato (ERRORES.md 2026-10-13):
//   ["triage-vocabulary"]        vocabulario del motor (de triage-admin; no cambia sin redeploy)
//   ["triage-conditions"]        todas las condiciones, todas las columnas
//   ["triage-map"]               mapeo especialidad del catálogo → etiqueta + búsqueda
//   ["triage-coverage"]          especialidades de FindMed con sus médicos activos
//   ["triage-changes", id]       historial de una condición
//   ["triage-catalog-summary"]   resumen en Configuración → Agente IA
import { keepPreviousData, useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  triageAdmin,
  type SpecialtyCoverage,
  type TriageChange,
  type TriageCondition,
  type TriageMapping,
  type TriageVocabulary,
} from "@/lib/triage-admin";

export function useTriageVocabulary() {
  return useQuery({
    queryKey: ["triage-vocabulary"],
    queryFn: () => triageAdmin<TriageVocabulary>({ action: "vocabulary" }),
    staleTime: Infinity,
  });
}

export function useTriageConditions() {
  return useQuery({
    queryKey: ["triage-conditions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("triage_findmed")
        .select("*")
        .order("especialidad")
        .order("id")
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as TriageCondition[];
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useTriageMap() {
  return useQuery({
    queryKey: ["triage-map"],
    queryFn: async () => {
      const { data, error } = await supabase.from("triage_specialty_map").select("*").order("especialidad");
      if (error) throw error;
      return (data ?? []) as TriageMapping[];
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useSpecialtyCoverage() {
  return useQuery({
    queryKey: ["triage-coverage"],
    queryFn: async () => (await triageAdmin<{ specialties: SpecialtyCoverage[] }>({ action: "coverage" })).specialties,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useConditionHistory(id: number | null) {
  return useQuery({
    queryKey: ["triage-changes", id],
    enabled: id !== null,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("triage_changes")
        .select("*")
        .eq("condition_id", id!)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as TriageChange[];
    },
    // Sin keepPreviousData: al cambiar de condición no debe verse el historial de otra.
  });
}

export function invalidateTriage(qc: QueryClient) {
  for (const queryKey of [["triage-conditions"], ["triage-map"], ["triage-changes"], ["triage-catalog-summary"]]) {
    qc.invalidateQueries({ queryKey });
  }
}
