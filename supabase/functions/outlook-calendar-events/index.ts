import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const OUTLOOK_CLIENT_ID = Deno.env.get("OUTLOOK_CLIENT_ID")!;
    const OUTLOOK_CLIENT_SECRET = Deno.env.get("OUTLOOK_CLIENT_SECRET")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const payload = decodeJwtPayload(token);
    if (!payload?.sub || !payload?.exp || (payload.exp as number) < Math.floor(Date.now() / 1000)) {
      return new Response(JSON.stringify({ error: "Token inválido" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = payload.sub as string;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: userData } = await supabase
      .from("users")
      .select("doctor_id")
      .eq("id", userId)
      .maybeSingle();

    if (!userData?.doctor_id) {
      return new Response(JSON.stringify({ error: "No eres un doctor" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: doctor } = await supabase
      .from("doctors")
      .select("outlook_refresh_token_ref, outlook_calendar_id, outlook_calendar_connected")
      .eq("id", userData.doctor_id)
      .maybeSingle();

    if (!doctor?.outlook_calendar_connected || !doctor.outlook_refresh_token_ref || !doctor.outlook_calendar_id) {
      return new Response(JSON.stringify({ events: [] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const timeMin = url.searchParams.get("timeMin");
    const timeMax = url.searchParams.get("timeMax");

    if (!timeMin || !timeMax) {
      return new Response(JSON.stringify({ error: "timeMin y timeMax requeridos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Refresh access token
    const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: OUTLOOK_CLIENT_ID,
        client_secret: OUTLOOK_CLIENT_SECRET,
        refresh_token: doctor.outlook_refresh_token_ref,
        grant_type: "refresh_token",
        scope: "offline_access Calendars.ReadWrite",
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error("Token refresh failed:", tokenData);
      return new Response(JSON.stringify({ events: [], error: "Error al refrescar token" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch events using calendarView
    const calendarId = encodeURIComponent(doctor.outlook_calendar_id);
    const eventsUrl = `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/calendarView?` +
      new URLSearchParams({
        startDateTime: timeMin,
        endDateTime: timeMax,
        $top: "50",
        $orderby: "start/dateTime",
        $select: "id,subject,start,end,bodyPreview,webLink",
      });

    const eventsRes = await fetch(eventsUrl, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Prefer: 'outlook.timezone="America/Mexico_City"',
      },
    });
    const eventsData = await eventsRes.json();

    const events = (eventsData.value || [])
      .filter((e: any) => e.start?.dateTime)
      .map((e: any) => ({
        id: e.id,
        summary: e.subject || "Sin título",
        start: e.start.dateTime.endsWith("Z") ? e.start.dateTime : e.start.dateTime + "Z",
        end: e.end?.dateTime ? (e.end.dateTime.endsWith("Z") ? e.end.dateTime : e.end.dateTime + "Z") : e.start.dateTime,
        description: e.bodyPreview || null,
        htmlLink: e.webLink || null,
      }));

    return new Response(JSON.stringify({ events }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in outlook-calendar-events:", error);
    return new Response(
      JSON.stringify({ events: [], error: error instanceof Error ? error.message : "Error desconocido" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
