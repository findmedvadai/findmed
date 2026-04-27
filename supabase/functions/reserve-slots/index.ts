// Slot generator for the patient reservation page. Now keyed by office_id
// instead of doctor_id: weekly availability comes from the office, the
// duration comes from the office, and external-calendar conflicts come from
// the office's connected calendar (Google or Outlook).
//
// Body: { office_id, date }. Returns { slots: ["09:00", …], duration_minutes,
// within_48h }. Empty slots when the office has no availability that weekday
// or has a date override blocking the day.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
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
  const OUTLOOK_CLIENT_ID = Deno.env.get("OUTLOOK_CLIENT_ID") || "";
  const OUTLOOK_CLIENT_SECRET = Deno.env.get("OUTLOOK_CLIENT_SECRET") || "";

  let body: { office_id?: string; doctor_id?: string; date: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Backward-compat: legacy callers may still pass doctor_id only. We resolve
  // to that doctor's only office (true post-migration when nothing's been
  // added). Once every caller is updated we can drop this branch.
  let { office_id, doctor_id } = body;
  const { date } = body;
  if (!date || (!office_id && !doctor_id)) {
    return new Response(
      JSON.stringify({ error: "office_id (o doctor_id legacy) y date requeridos" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!office_id && doctor_id) {
    const { data: legacyOffice } = await supabase
      .from("doctor_offices")
      .select("id")
      .eq("doctor_id", doctor_id)
      .eq("is_active", true)
      .eq("is_deleted", false)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    office_id = legacyOffice?.id;
  }

  if (!office_id) {
    return new Response(JSON.stringify({ slots: [] }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Office: duration, calendar config.
  const { data: office } = await supabase
    .from("doctor_offices")
    .select(
      "id, doctor_id, appointment_duration_minutes, " +
        "google_calendar_connected, google_refresh_token_ref, google_calendar_id, " +
        "outlook_calendar_connected, outlook_refresh_token_ref, outlook_calendar_id, " +
        "is_active, is_deleted"
    )
    .eq("id", office_id)
    .maybeSingle();

  if (!office || !office.is_active || office.is_deleted) {
    return new Response(JSON.stringify({ slots: [] }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const durationMinutes = office.appointment_duration_minutes ?? 30;

  // Doctor-level settings (timezone, min confirm hours).
  const { data: settings } = await supabase
    .from("doctor_schedule_settings")
    .select("min_confirm_hours_before")
    .eq("doctor_id", office.doctor_id)
    .maybeSingle();
  const minConfirmHours = settings?.min_confirm_hours_before ?? 24;

  // Weekly availability: pick the row(s) for this office on this weekday.
  // After mejora 2 there can be MULTIPLE rows per (office, weekday) — e.g.
  // morning + afternoon split. We emit slots from each enabled block.
  const dayDate = new Date(date + "T12:00:00");
  const weekday = dayDate.getDay();

  const { data: blocks } = await supabase
    .from("doctor_weekly_availability")
    .select("start_time, end_time, is_enabled")
    .eq("office_id", office_id)
    .eq("weekday", weekday)
    .eq("is_enabled", true);

  if (!blocks || blocks.length === 0) {
    return new Response(JSON.stringify({ slots: [] }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Date overrides — kept at doctor level (existing semantics).
  const { data: override } = await supabase
    .from("doctor_date_overrides")
    .select("is_available")
    .eq("doctor_id", office.doctor_id)
    .eq("override_date", date)
    .maybeSingle();
  if (override && !override.is_available) {
    return new Response(JSON.stringify({ slots: [] }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const allSlots: string[] = [];
  for (const block of blocks) {
    const [sh, sm] = block.start_time.split(":").map(Number);
    const [eh, em] = block.end_time.split(":").map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    for (let m = startMin; m + durationMinutes <= endMin; m += durationMinutes) {
      const h = Math.floor(m / 60);
      const min = m % 60;
      allSlots.push(`${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`);
    }
  }
  // Dedupe (when blocks share boundaries) and sort.
  const uniqueSlots = [...new Set(allSlots)].sort();

  // Existing appointments for this office on this day.
  const dayStart = `${date}T00:00:00`;
  const dayEnd = `${date}T23:59:59`;
  const { data: existingAppts } = await supabase
    .from("appointments")
    .select("start_at, end_at")
    .eq("office_id", office_id)
    .in("status", ["scheduled", "confirmed"])
    .gte("start_at", dayStart)
    .lte("start_at", dayEnd);

  // External calendar conflicts. Only the office's connected provider counts.
  let externalEvents: { startMin: number; endMin: number }[] = [];

  if (office.google_calendar_connected && office.google_refresh_token_ref && office.google_calendar_id) {
    try {
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
      if (tokenRes.ok && tokenData.access_token) {
        const calendarId = encodeURIComponent(office.google_calendar_id);
        const timeMin = `${date}T00:00:00Z`;
        const timeMax = `${date}T23:59:59Z`;
        const eventsUrl =
          `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?` +
          new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "50" });
        const eventsRes = await fetch(eventsUrl, { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
        const eventsData = await eventsRes.json();
        const parseLocalMinutes = (dt: string): number => {
          const timePart = dt.split("T")[1];
          const hh = parseInt(timePart.substring(0, 2), 10);
          const mm = parseInt(timePart.substring(3, 5), 10);
          return hh * 60 + mm;
        };
        externalEvents = (eventsData.items || [])
          .filter((e: any) => e.start?.dateTime)
          .map((e: any) => ({
            startMin: parseLocalMinutes(e.start.dateTime),
            endMin: parseLocalMinutes(e.end?.dateTime || e.start.dateTime),
          }));
      }
    } catch (err) {
      console.error("Error fetching Google Calendar events:", err);
    }
  } else if (office.outlook_calendar_connected && office.outlook_refresh_token_ref && office.outlook_calendar_id && OUTLOOK_CLIENT_ID) {
    try {
      const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: OUTLOOK_CLIENT_ID,
          client_secret: OUTLOOK_CLIENT_SECRET,
          refresh_token: office.outlook_refresh_token_ref,
          grant_type: "refresh_token",
          scope: "offline_access Calendars.ReadWrite",
        }),
      });
      const tokenData = await tokenRes.json();
      if (tokenRes.ok && tokenData.access_token) {
        const calendarId = encodeURIComponent(office.outlook_calendar_id);
        const eventsUrl =
          `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/calendarView?` +
          new URLSearchParams({
            startDateTime: `${date}T00:00:00Z`,
            endDateTime: `${date}T23:59:59Z`,
            $top: "50",
            $select: "id,start,end",
          });
        const eventsRes = await fetch(eventsUrl, { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
        const eventsData = await eventsRes.json();
        const toMxMinutes = (dtStr: string): number => {
          const fmt = new Intl.DateTimeFormat("es-MX", {
            timeZone: "America/Mexico_City",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });
          // Microsoft Graph returns naive UTC dateTimes; treat as UTC by default.
          const ts = dtStr.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(dtStr) ? dtStr : dtStr + "Z";
          const parts = fmt.formatToParts(new Date(ts));
          const h = parseInt(parts.find((p) => p.type === "hour")!.value);
          const m = parseInt(parts.find((p) => p.type === "minute")!.value);
          return h * 60 + m;
        };
        externalEvents = (eventsData.value || [])
          .filter((e: any) => e.start?.dateTime)
          .map((e: any) => ({
            startMin: toMxMinutes(e.start.dateTime),
            endMin: e.end?.dateTime ? toMxMinutes(e.end.dateTime) : toMxMinutes(e.start.dateTime),
          }));
      }
    } catch (err) {
      console.error("Error fetching Outlook Calendar events:", err);
    }
  }

  const toMxMinutes = (dtStr: string): number => {
    const d = new Date(dtStr);
    const fmt = new Intl.DateTimeFormat("es-MX", {
      timeZone: "America/Mexico_City",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(d);
    const h = parseInt(parts.find((p) => p.type === "hour")!.value);
    const m = parseInt(parts.find((p) => p.type === "minute")!.value);
    return h * 60 + m;
  };

  const availableSlots = uniqueSlots.filter((slot) => {
    const slotStart = parseInt(slot.split(":")[0]) * 60 + parseInt(slot.split(":")[1]);
    const slotEnd = slotStart + durationMinutes;
    for (const a of existingAppts || []) {
      const aStart = toMxMinutes(a.start_at);
      const aEnd = toMxMinutes(a.end_at);
      if (slotStart < aEnd && slotEnd > aStart) return false;
    }
    for (const e of externalEvents) {
      if (slotStart < e.endMin && slotEnd > e.startMin) return false;
    }

    // Don't show past slots for today (Mexico City timezone).
    const now = new Date();
    const todayMxStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Mexico_City",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    if (date === todayMxStr) {
      const mxParts = new Intl.DateTimeFormat("es-MX", {
        timeZone: "America/Mexico_City",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(now);
      const nowMxH = parseInt(mxParts.find((p) => p.type === "hour")!.value);
      const nowMxM = parseInt(mxParts.find((p) => p.type === "minute")!.value);
      const nowMin = nowMxH * 60 + nowMxM;
      const cutoff = nowMin + minConfirmHours * 60;
      if (slotStart < cutoff) return false;
    }
    return true;
  });

  let within48h = false;
  if (availableSlots.length > 0) {
    const slotDateTime = new Date(`${date}T${availableSlots[0]}:00-06:00`);
    within48h = slotDateTime.getTime() - Date.now() < 48 * 60 * 60 * 1000;
  }

  return new Response(
    JSON.stringify({ slots: availableSlots, duration_minutes: durationMinutes, within_48h: within48h }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
