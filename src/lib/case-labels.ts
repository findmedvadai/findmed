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

/** Historial del caso (case_events.event_type): _shared/cases.ts, reimbursements.ts y staff-alerts.ts. */
export const CASE_EVENT_LABEL: Record<string, string> = {
  created: "Caso abierto por el agente",
  deduplicated: "El paciente repitió la solicitud",
  handoff_requested: "Se pidió atención humana",
  handoff_retried: "Se volvió a pedir atención humana",
  ai_paused: "IA apagada en WhatsApp",
  ai_pause_failed: "No se pudo apagar la IA",
  ai_resumed: "IA reactivada",
  ai_resume_failed: "No se pudo reactivar la IA",
  conversation_lookup_failed: "No se pudo consultar la conversación en WHAAPY",
  conversation_not_found: "No existe conversación en WHAAPY para este número",
  whaapy_not_configured: "WHAAPY no está configurado",
  tags_added: "Etiquetas agregadas en WHAAPY",
  tags_failed: "No se pudieron agregar etiquetas en WHAAPY",
  assigned: "Caso tomado",
  whaapy_assigned: "Asignado también en WHAAPY",
  whaapy_assign_failed: "WHAAPY rechazó la asignación",
  whaapy_no_matching_agent: "Sin agente de WHAAPY con ese correo",
  whaapy_released: "Asignación liberada en WHAAPY",
  whaapy_release_failed: "No se pudo liberar la asignación en WHAAPY",
  updated: "Seguimiento actualizado",
  note: "Nota",
  resolved: "Resuelto",
  closed: "Cerrado",
  reimbursement_created: "Reembolso registrado",
  reimbursement_status: "Reembolso: cambio de estado",
  reimbursement_updated: "Reembolso actualizado",
  // Alertas al equipo (_shared/staff-alerts.ts)
  staff_alert_sent: "Equipo avisado",
  staff_alert_failed: "No se pudo avisar al equipo por WhatsApp",
  staff_alert_skipped: "Alerta por WhatsApp no enviada",
  escalated: "Re-aviso: nadie ha tomado el caso",
};

/** created/deduplicated dicen quién abrió el caso según su origen (agente, equipo o post-consulta). */
export function caseEventLabel(e: { event_type: string; detail?: unknown }): string {
  const origin = (e.detail as Record<string, unknown> | null | undefined)?.origin;
  if (e.event_type === "created" && origin === "post_consultation") return "Caso abierto por la post-consulta";
  if (e.event_type === "created" && origin === "admin") return "Caso abierto por el equipo";
  if (e.event_type === "deduplicated" && origin === "post_consultation") return "La post-consulta agregó una indicación";
  if (e.event_type === "deduplicated" && origin === "admin") return "El equipo agregó una solicitud del mismo tipo";
  return CASE_EVENT_LABEL[e.event_type] ?? e.event_type.replace(/_/g, " ");
}

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
