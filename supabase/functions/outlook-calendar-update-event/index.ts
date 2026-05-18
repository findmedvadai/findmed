import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { resolveOfficeForCaller } from "../_shared/office-resolver.ts";
import { checkAvailability } from "../_shared/availability-check.ts";
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
    const { event_id, summary, description, start_at, end_at, office_id, force_outside_availability } = body;
    if (!office_id) return jsonResponse({ error: "office_id requerido" }, 400);
    if (!event_id || !start_at || !end_at) {
      return jsonResponse({ error: "event_id, start_at y end_at son requeridos" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const resolved = await resolveOfficeForCaller(supabase, userId, office_id);
    if ("error" in resolved) return jsonResponse({ error: resolved.error }, resolved.status);
    const office = resolved.office;

    if (!office.outlook_calendar_connected || !office.outlook_refresh_token_ref || !office.outlook_calendar_id) {
      return jsonResponse({ error: "Outlook Calendar no está conectado en este consultorio" }, 400);
    }

    if (!force_outside_availability) {
      const av = await checkAvailability(supabase, office_id, start_at, end_at);
      if (!av.withinAvailability) {
        return jsonResponse(
          {
            error: "outside_availability",
            weekday: av.weekday,
            blocks: av.blocksForWeekday,
            office_name: office.name,
          },
          409
        );
      }
    }

    const accessToken = await getOutlookAccessToken({ supabase, office });
    if (!accessToken) return jsonResponse({ error: "Error al refrescar token de Microsoft" }, 500);

    const eventBody: Record<string, unknown> = {
      start: { dateTime: start_at, timeZone: "America/Mexico_City" },
      end: { dateTime: end_at, timeZone: "America/Mexico_City" },
    };
    if (summary !== undefined) eventBody.subject = summary;
    if (description !== undefined) eventBody.body = { contentType: "Text", content: description };

    const calendarId = encodeURIComponent(office.outlook_calendar_id);
    const updateRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events/${encodeURIComponent(event_id)}`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(eventBody),
      }
    );
    if (!updateRes.ok) return jsonResponse({ error: "Error al actualizar evento en Outlook" }, 500);
    const updateData = await updateRes.json();
    return jsonResponse({ success: true, event_id: updateData.id });
  } catch (error) {
    console.error("Error in outlook-calendar-update-event:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Error desconocido" }, 500);
  }
});
