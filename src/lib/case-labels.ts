// Etiquetas compartidas de casos (patient_cases) y reembolsos, para que el
// módulo Casos, el detalle post-consulta y la actividad del agente digan lo
// mismo. Los valores vienen de los CHECK de la base (migraciones
// 20261013130000 y 20261014120000).
import type { Tone } from "@/components/app/StatCard";

export const CASE_TYPE_LABEL: Record<string, string> = {
  appointment_help: "Cita",
  hospital: "Hospital",
  studies: "Estudios",
  urgency: "Urgencia",
  follow_up: "Seguimiento",
  procedure: "Procedimiento",
  referral: "Referencia",
  reimbursement: "Reembolso",
  other: "Otro",
};

export const caseTypeLabel = (t: string | null | undefined) => (t ? CASE_TYPE_LABEL[t] ?? t : "");

export const CASE_PRIORITY: Record<string, { label: string; tone: Tone }> = {
  urgent: { label: "Urgente", tone: "danger" },
  high: { label: "Alta", tone: "warning" },
  normal: { label: "Normal", tone: "neutral" },
};

export const CASE_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: "Abierto", tone: "info" },
  awaiting_assignment: { label: "Sin asignar", tone: "danger" },
  assigned: { label: "Asignado", tone: "info" },
  awaiting_patient: { label: "Esperando al paciente", tone: "warning" },
  awaiting_provider: { label: "Esperando al proveedor", tone: "warning" },
  resolved: { label: "Resuelto", tone: "success" },
  closed: { label: "Cerrado", tone: "neutral" },
};

export const REIMBURSEMENT_STATUSES = ["recibido", "en_proceso", "finalizado", "rechazado"] as const;
export type ReimbursementStatus = (typeof REIMBURSEMENT_STATUSES)[number];

export const REIMBURSEMENT_STATUS: Record<ReimbursementStatus, { label: string; tone: Tone; stage: number }> = {
  recibido: { label: "Recibido", tone: "info", stage: 0 },
  en_proceso: { label: "En proceso", tone: "warning", stage: 1 },
  finalizado: { label: "Finalizado", tone: "success", stage: 2 },
  rechazado: { label: "Rechazado", tone: "danger", stage: 2 },
};

/** Estados a los que puede pasar un reembolso (solo hacia adelante; los finales no cambian). */
export function nextReimbursementStatuses(current: string): ReimbursementStatus[] {
  const s = REIMBURSEMENT_STATUS[current as ReimbursementStatus];
  if (!s || s.stage >= 2) return [];
  return REIMBURSEMENT_STATUSES.filter((k) => REIMBURSEMENT_STATUS[k].stage > s.stage);
}

export function formatMoney(amount: number | null | undefined, currency: string): string | null {
  if (amount === null || amount === undefined) return null;
  try {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency, currencyDisplay: "code" }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
