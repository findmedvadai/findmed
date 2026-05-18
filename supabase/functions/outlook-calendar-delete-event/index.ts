import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { resolveOfficeForCaller } from "../_shared/office-resolver.ts";
import { getOutlookAccessToken } from "../_shared/calendar-tokens.ts";

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "No autorizado" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const payload = decodeJwtPayload(token);
    if (!payload?.sub || !payload?.exp || (payload.exp as number) < Math.floor(Date.now() / 1000)) {
      return jsonResponse({ error: "Token inválido" }, 401);
    }
    const userId = payload.sub as string;

    const body = await req.json();
    const { event_id, office_id } = body;
    if (!office_id) return jsonResponse({ error: "office_id requerido" }, 400);
    if (!event_id) return jsonResponse({ error: "event_id requerido" }, 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const resolved = await resolveOfficeForCaller(supabase, userId, office_id);
    if ("error" in resolved) return jsonResponse({ error: resolved.error }, resolved.status);
    const office = resolved.office;

    if (!office.outlook_calendar_connected || !office.outlook_refresh_token_ref || !office.outlook_calendar_id) {
      return jsonResponse({ error: "Outlook Calendar no está conectado en este consultorio" }, 400);
    }

    const accessToken = await getOutlookAccessToken({ supabase, office });
    if (!accessToken) return jsonResponse({ error: "Error al refrescar token de Microsoft" }, 500);

    const calendarId = encodeURIComponent(office.outlook_calendar_id);
    const deleteRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events/${encodeURIComponent(event_id)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!deleteRes.ok && deleteRes.status !== 404 && deleteRes.status !== 410) {
      return jsonResponse({ error: "Error al eliminar evento de Outlook" }, 500);
    }
    return jsonResponse({ success: true });
  } catch (error) {
    console.error("Error in outlook-calendar-delete-event:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Error desconocido" }, 500);
  }
});
