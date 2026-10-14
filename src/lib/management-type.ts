// Tipo de manejo que el médico confirma en el formulario post-consulta
// (Etapa 2). La regla de sugerencia es la misma que usa el servidor en
// supabase/functions/_shared/postconsult-routes.ts (suggestManagementType):
// si cambia una, cambia la otra.

export const MANAGEMENT_TYPES = ["conservador", "estudios", "procedimiento", "urgente"] as const;
export type ManagementType = (typeof MANAGEMENT_TYPES)[number];

export const isManagementType = (v: unknown): v is ManagementType =>
  typeof v === "string" && (MANAGEMENT_TYPES as readonly string[]).includes(v);

export const MANAGEMENT_TYPE_INFO: Record<ManagementType, { label: string; short: string; description: string; tone: "neutral" | "info" | "warning" | "danger" }> = {
  conservador: {
    label: "Conservador · seguimiento",
    short: "Conservador",
    description: "Tratamiento en casa. FindMed llama al paciente en 7 días para dar seguimiento.",
    tone: "neutral",
  },
  estudios: {
    label: "Requiere estudios",
    short: "Estudios",
    description: "Imagen o laboratorio. FindMed coordina los estudios con el paciente.",
    tone: "info",
  },
  procedimiento: {
    label: "Requiere procedimiento u hospitalización",
    short: "Procedimiento",
    description: "FindMed coordina el procedimiento o la hospitalización.",
    tone: "warning",
  },
  urgente: {
    label: "Urgente",
    short: "Urgente",
    description: "FindMed contacta al paciente de inmediato y alerta al equipo.",
    tone: "danger",
  },
};

/** Lo capturado en el formulario (texto o interruptor encendido cuenta como capturado). */
export interface CapturedActions {
  imaging_studies?: boolean;
  lab_tests?: boolean;
  hospitalization?: boolean;
}

/**
 * Sugerencia automática: hospitalización → procedimiento; estudios de imagen
 * o laboratorio → estudios; nada → conservador. "Urgente" nunca se sugiere:
 * solo el médico lo decide.
 */
export function suggestManagementType(c: CapturedActions): ManagementType {
  if (c.hospitalization) return "procedimiento";
  if (c.imaging_studies || c.lab_tests) return "estudios";
  return "conservador";
}
