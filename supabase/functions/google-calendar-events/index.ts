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
    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

    // Auth check
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

    // Resolve target doctor. Default = the doctor whose user is authenticated.
    // If the caller passes ?doctor_id=…, they must be admin/superadmin.
    const url = new URL(req.url);
    const requestedDoctorId = url.searchParams.get("doctor_id");
    let targetDoctorId: string | null = null;

    if (requestedDoctorId) {
      const { data: isAdmin } = await supabase.rpc("is_admin_or_superadmin", { _user_id: userId });
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      targetDoctorId = requestedDoctorId;
    } else {
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
      targetDoctorId = userData.doctor_id;
    }

    const { data: doctor } = await supabase
      .from("doctors")
      .select("google_refresh_token_ref, google_calendar_id, google_calendar_connected")
      .eq("id", targetDoctorId)
      .maybeSingle();

    if (!doctor?.google_calendar_connected || !doctor.google_refresh_token_ref || !doctor.google_calendar_id) {
      // Doctor simply has no Google calendar — empty list, no error.
      return new Response(JSON.stringify({ events: [] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse date range from query params
    const timeMin = url.searchParams.get("timeMin");
    const timeMax = url.searchParams.get("timeMax");

    if (!timeMin || !timeMax) {
      return new Response(JSON.stringify({ error: "timeMin y timeMax requeridos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Refresh access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: doctor.google_refresh_token_ref,
        grant_type: "refresh_token",
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error("Token refresh failed:", tokenData);
      return new Response(JSON.stringify({ events: [], error: "calendar_not_synced" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch events
    const calendarId = encodeURIComponent(doctor.google_calendar_id);
    const eventsUrl = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?` +
      new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "50",
      });

    const eventsRes = await fetch(eventsUrl, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const eventsData = await eventsRes.json();

    const events = (eventsData.items || [])
      .filter((e: any) => e.start?.dateTime) // Only timed events
      .map((e: any) => ({
        id: e.id,
        summary: e.summary || "Sin título",
        start: e.start.dateTime,
        end: e.end?.dateTime || e.start.dateTime,
        description: e.description || null,
        htmlLink: e.htmlLink,
      }));

    return new Response(JSON.stringify({ events }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in google-calendar-events:", error);
    return new Response(
      JSON.stringify({ events: [], error: error instanceof Error ? error.message : "Error desconocido" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
