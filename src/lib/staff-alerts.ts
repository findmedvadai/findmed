// Alertas al equipo por casos (Configuración → Alertas): llamada a las acciones
// de case-actions y etiquetas compartidas. Las lecturas van directo a las tablas
// por RLS (solo admins); toda escritura pasa por la Edge Function.
import { supabase } from "@/integrations/supabase/client";
import type { Tone } from "@/components/app/StatCard";

/** Tipos de notificación que vienen de un caso (abren /admin/casos?caso=…). */
export const CASE_NOTIFICATION_TYPES = ["case_opened", "case_handoff", "case_overdue"] as const;

export const RECEIVES_LABEL: Record<string, string> = {
  all: "Todas las alertas",
  urgent_only: "Solo urgentes",
};

export const DELIVERY_STATUS: Record<string, { label: string; tone: Tone }> = {
  sending: { label: "Enviando", tone: "neutral" },
  accepted: { label: "Aceptado", tone: "info" },
  sent: { label: "Enviado", tone: "info" },
  delivered: { label: "Entregado", tone: "success" },
  read: { label: "Leído", tone: "success" },
  failed: { label: "Falló", tone: "danger" },
  uncertain: { label: "Incierto", tone: "warning" },
};

export const casePath = (caseId: string) => `/admin/casos?caso=${encodeURIComponent(caseId)}`;

/**
 * Llama a case-actions con una acción de alertas. En error lanza un Error con
 * el mensaje del backend en español.
 */
export async function alertAction<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const res = await supabase.functions.invoke("case-actions", {
    body,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (res.error) {
    let message = "No se pudo completar la acción.";
    const ctx = (res.error as { context?: Response }).context;
    if (ctx && typeof ctx.clone === "function") {
      const json = (await ctx.clone().json().catch(() => null)) as { message?: string } | null;
      if (json?.message) message = json.message;
    }
    throw new Error(message);
  }
  return res.data as T;
}
