import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { resolveOfficeForCaller } from "../_shared/office-resolver.ts";

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
    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

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
    if (!event_id) return jsonResponse({ error: "event_id es requerido" }, 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const resolved = await resolveOfficeForCaller(supabase, userId, office_id);
    if ("error" in resolved) return jsonResponse({ error: resolved.error }, resolved.status);
    const office = resolved.office;

    if (!office.google_calendar_connected || !office.google_refresh_token_ref || !office.google_calendar_id) {
      return jsonResponse({ error: "Google Calendar no está conectado en este consultorio" }, 400);
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: office.google_refresh_token_ref,
        grant_type: "refresh_token",
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) return jsonResponse({ error: "Error al refrescar token de Google" }, 500);

    const calendarId = encodeURIComponent(office.google_calendar_id);
    const deleteRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(event_id)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    );

    if (!deleteRes.ok && deleteRes.status !== 410 && deleteRes.status !== 404) {
      const errorText = await deleteRes.text();
      console.error("Google Calendar delete failed:", errorText);
      return jsonResponse({ error: "Error al eliminar evento de Google Calendar" }, 500);
    }
    return jsonResponse({ success: true });
  } catch (error) {
    console.error("Error in google-calendar-delete-event:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Error desconocido" }, 500);
  }
});
