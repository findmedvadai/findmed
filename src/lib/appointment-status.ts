import type { Tone } from "@/components/app/StatCard";

/** Etiqueta y color de cada estado de cita, iguales en todos los módulos. */
export const APPOINTMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  scheduled: { label: "Por confirmar", tone: "warning" },
  confirmed: { label: "Confirmada", tone: "success" },
  cancelled: { label: "Cancelada", tone: "danger" },
  completed: { label: "Completada", tone: "info" },
};
