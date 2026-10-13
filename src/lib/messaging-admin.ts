import { supabase } from "@/integrations/supabase/client";

/**
 * Llama a la Edge Function messaging-admin (plantillas, dueño por evento,
 * reenvíos, salud de la integración). En error lanza un Error con el mensaje
 * del backend (y sus `problems`, si vienen) en español.
 */
export async function messagingAdmin<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const res = await supabase.functions.invoke("messaging-admin", {
    body,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (res.error) {
    let message = "No se pudo completar la acción.";
    let code: string | null = null;
    const ctx = (res.error as { context?: Response }).context;
    if (ctx && typeof ctx.clone === "function") {
      const json = (await ctx.clone().json().catch(() => null)) as { error?: string; message?: string; problems?: string[] } | null;
      if (json?.message) message = json.message;
      if (json?.problems?.length) message = json.problems.join(" ");
      code = json?.error ?? null;
    }
    const err = new Error(message) as Error & { code?: string | null };
    err.code = code;
    throw err;
  }
  return res.data as T;
}

export interface IntegrationHealth {
  whaapy_api: { configured: boolean; ok: boolean; latency_ms?: number; templates?: number; approved?: number; http_status?: number; error?: string };
  mcp_url: string | null;
  webhook_url: string | null;
  secrets: Record<string, boolean>;
  checked_at: string;
}
