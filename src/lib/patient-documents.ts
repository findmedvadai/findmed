import type { Tone } from "@/components/app/StatCard";

/**
 * Documentos del paciente (póliza + INE) para una cita. FindMed los pide por
 * WhatsApp con la plantilla pedir_documentos al reservar; cuando el paciente
 * manda una foto o PDF, la cita queda "recibidos". Los archivos no se guardan
 * en FindMed: se consultan en el módulo WhatsApp (bandeja de WHAAPY).
 */
export type DocumentsStatus = "received" | "pending" | "not_requested";

export function documentsStatus(a: {
  documents_requested_at?: string | null;
  documents_received_at?: string | null;
}): DocumentsStatus {
  if (a.documents_received_at) return "received";
  if (a.documents_requested_at) return "pending";
  return "not_requested";
}

export const DOCUMENTS_STATUS: Record<DocumentsStatus, { label: string; short: string; tone: Tone; hint: string }> = {
  received: {
    label: "Documentos recibidos",
    short: "Recibidos",
    tone: "success",
    hint: "El paciente envió su documentación por WhatsApp; el equipo de FindMed la revisa ahí.",
  },
  pending: {
    label: "Documentos pendientes",
    short: "Pendientes",
    tone: "warning",
    hint: "Se le pidieron póliza e INE por WhatsApp y todavía no los envía.",
  },
  not_requested: {
    label: "Documentos no solicitados",
    short: "No solicitados",
    tone: "neutral",
    hint: "Todavía no se le han pedido documentos a este paciente para esta cita.",
  },
};

/** Estado del seguro: true = con seguro, false = sin seguro, null = no capturado. */
export type InsuranceChoice = "yes" | "no" | "unknown";

export function insuranceChoice(hasInsurance: boolean | null | undefined): InsuranceChoice {
  if (hasInsurance === true) return "yes";
  if (hasInsurance === false) return "no";
  return "unknown";
}
