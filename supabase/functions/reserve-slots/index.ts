import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
  const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

  let body: { doctor_id: string; date: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { doctor_id, date } = body;
  if (!doctor_id || !date) {
    return new Response(JSON.stringify({ error: "doctor_id y date requeridos" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Get doctor settings
  const { data: settings } = await supabase
    .from("doctor_schedule_settings")
    .select("appointment_duration_minutes, timezone")
    .eq("doctor_id", doctor_id)
    .maybeSingle();

  const durationMinutes = settings?.appointment_duration_minutes ?? 30;
  const timezone = settings?.timezone ?? "America/Mexico_City";

  // Get weekly availability for this weekday
  const dayDate = new Date(date + "T12:00:00"); // avoid timezone issues
  const weekday = dayDate.getDay(); // 0=Sunday

  const { data: availability } = await supabase
    .from("doctor_weekly_availability")
    .select("start_time, end_time, is_enabled")
    .eq("doctor_id", doctor_id)
    .eq("weekday", weekday)
    .maybeSingle();

  if (!availability || !availability.is_enabled) {
    return new Response(JSON.stringify({ slots: [] }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Check date overrides
  const { data: override } = await supabase
    .from("doctor_date_overrides")
    .select("is_available")
    .eq("doctor_id", doctor_id)
    .eq("override_date", date)
    .maybeSingle();

  if (override && !override.is_available) {
    return new Response(JSON.stringify({ slots: [] }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Generate all possible slots
  const startParts = availability.start_time.split(":").map(Number);
  const endParts = availability.end_time.split(":").map(Number);
  const startMinutes = startParts[0] * 60 + startParts[1];
  const endMinutes = endParts[0] * 60 + endParts[1];

  const allSlots: string[] = [];
  for (let m = startMinutes; m + durationMinutes <= endMinutes; m += durationMinutes) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    allSlots.push(`${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`);
  }

  // Get existing appointments for this day
  const dayStart = `${date}T00:00:00`;
  const dayEnd = `${date}T23:59:59`;

  const { data: existingAppts } = await supabase
    .from("appointments")
    .select("start_at, end_at")
    .eq("doctor_id", doctor_id)
    .in("status", ["scheduled", "confirmed"])
    .gte("start_at", dayStart)
    .lte("start_at", dayEnd);

  // Get Google Calendar events for this day
  const { data: doctor } = await supabase
    .from("doctors")
    .select("google_refresh_token_ref, google_calendar_id, google_calendar_connected")
    .eq("id", doctor_id)
    .maybeSingle();

  let googleEvents: { startMin: number; endMin: number }[] = [];

  if (doctor?.google_calendar_connected && doctor.google_refresh_token_ref && doctor.google_calendar_id) {
    try {
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
      if (tokenRes.ok && tokenData.access_token) {
        const calendarId = encodeURIComponent(doctor.google_calendar_id);
        const timeMin = `${date}T00:00:00Z`;
        const timeMax = `${date}T23:59:59Z`;
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

        // Parse local time directly from dateTime string (e.g. "2026-02-17T09:00:00-06:00")
        // to avoid UTC conversion issues in Deno runtime
        const parseLocalMinutes = (dt: string): number => {
          const timePart = dt.split("T")[1]; // "09:00:00-06:00"
          const hh = parseInt(timePart.substring(0, 2), 10);
          const mm = parseInt(timePart.substring(3, 5), 10);
          return hh * 60 + mm;
        };

        googleEvents = (eventsData.items || [])
          .filter((e: any) => e.start?.dateTime)
          .map((e: any) => ({
            startMin: parseLocalMinutes(e.start.dateTime),
            endMin: parseLocalMinutes(e.end?.dateTime || e.start.dateTime),
          }));
      }
    } catch (err) {
      console.error("Error fetching Google Calendar events:", err);
    }
  }

  // Filter out slots that overlap with existing appointments or Google events
  const availableSlots = allSlots.filter((slot) => {
    const slotStartMinutes = parseInt(slot.split(":")[0]) * 60 + parseInt(slot.split(":")[1]);
    const slotEndMinutes = slotStartMinutes + durationMinutes;

    // Check appointments
    for (const appt of existingAppts || []) {
      const apptStart = new Date(appt.start_at);
      const apptEnd = new Date(appt.end_at);
      const apptStartMin = apptStart.getHours() * 60 + apptStart.getMinutes();
      const apptEndMin = apptEnd.getHours() * 60 + apptEnd.getMinutes();

      // Overlap check: at least 1 minute overlap
      if (slotStartMinutes < apptEndMin && slotEndMinutes > apptStartMin) {
        return false;
      }
    }

    // Check Google events (parse local time from dateTime string to avoid UTC conversion)
    for (const evt of googleEvents) {
      const evtStartMin = evt.startMin;
      const evtEndMin = evt.endMin;

      if (slotStartMinutes < evtEndMin && slotEndMinutes > evtStartMin) {
        return false;
      }
    }

    // Don't show past slots for today
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];
    if (date === todayStr) {
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      if (slotStartMinutes <= nowMinutes) return false;
    }

    return true;
  });

  return new Response(
    JSON.stringify({ slots: availableSlots, duration_minutes: durationMinutes }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
