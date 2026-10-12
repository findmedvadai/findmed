// Slot generator for the patient reservation page. Now keyed by office_id
// instead of doctor_id: weekly availability comes from the office, the
// duration comes from the office, and external-calendar conflicts come from
// the office's connected calendar (Google or Outlook).
//
// Body: { office_id, date }. Returns { slots: ["09:00", …], duration_minutes,
// within_48h }. Empty slots when the office has no availability that weekday
// or has a date override blocking the day.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGoogleAccessToken, getOutlookAccessToken } from "../_shared/calendar-tokens.ts";
import { isValidLocalDate, mxDayBoundsMs, mxLocalToMs, mxToday } from "../_shared/mx-time.ts";
import { getServiceKey } from "../_shared/supabase-keys.ts";

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
    getServiceKey()
  );

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
  if (!isValidLocalDate(date)) {
    return new Response(JSON.stringify({ error: "date debe tener formato YYYY-MM-DD" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // Past days never have slots.
  if (date < mxToday()) {
    return new Response(JSON.stringify({ slots: [] }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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
    // Single string literal (not concatenated) so supabase-js can infer the row
    // type; a concatenated select degrades `office` to GenericStringError.
    .select(
      "id, doctor_id, appointment_duration_minutes, google_calendar_connected, google_refresh_token_ref, google_calendar_id, outlook_calendar_connected, outlook_refresh_token_ref, outlook_calendar_id, is_active, is_deleted"
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

  // Everything below compares absolute instants (epoch ms). The previous
  // version compared minutes-of-day and built the day window without an
  // offset (read as UTC by Postgres), so appointments from 18:00–23:59 CDMX
  // were missed and those slots could be double-booked.
  const { startMs: dayStartMs, endMs: dayEndMs } = mxDayBoundsMs(date);
  const dayStartIso = new Date(dayStartMs).toISOString();
  const dayEndIso = new Date(dayEndMs).toISOString();

  // Existing appointments of this DOCTOR (any office) that overlap this CDMX
  // day: a doctor can't be in two offices at once (decision D2).
  const { data: existingAppts } = await supabase
    .from("appointments")
    .select("start_at, end_at")
    .eq("doctor_id", office.doctor_id)
    .in("status", ["scheduled", "confirmed"])
    .lt("start_at", dayEndIso)
    .gt("end_at", dayStartIso);

  const busy: { startMs: number; endMs: number }[] = (existingAppts ?? []).map((a) => ({
    startMs: Date.parse(a.start_at),
    endMs: Date.parse(a.end_at),
  }));

  // External calendar conflicts. Only the office's connected provider counts.
  if (office.google_calendar_connected && office.google_calendar_id) {
    try {
      const accessToken = await getGoogleAccessToken({ supabase, office });
      if (accessToken) {
        const calendarId = encodeURIComponent(office.google_calendar_id);
        const eventsUrl =
          `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?` +
          new URLSearchParams({
            timeMin: dayStartIso,
            timeMax: dayEndIso,
            singleEvents: "true",
            orderBy: "startTime",
            maxResults: "250",
          });
        const eventsRes = await fetch(eventsUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
        const eventsData = await eventsRes.json();
        // Timed events only (all-day events keep being ignored, as before).
        // Google returns dateTime with an explicit offset, so Date.parse is exact.
        for (const e of eventsData.items || []) {
          if (!e.start?.dateTime) continue;
          busy.push({
            startMs: Date.parse(e.start.dateTime),
            endMs: Date.parse(e.end?.dateTime || e.start.dateTime),
          });
        }
      }
    } catch (err) {
      console.error("Error fetching Google Calendar events:", err);
    }
  } else if (office.outlook_calendar_connected && office.outlook_calendar_id) {
    try {
      const accessToken = await getOutlookAccessToken({ supabase, office });
      if (accessToken) {
        const calendarId = encodeURIComponent(office.outlook_calendar_id);
        const eventsUrl =
          `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/calendarView?` +
          new URLSearchParams({
            startDateTime: dayStartIso,
            endDateTime: dayEndIso,
            $top: "250",
            $select: "id,start,end",
          });
        // Was `tokenData.access_token` (undefined -> ReferenceError swallowed by
        // the catch), so Outlook busy times never blocked patient slots.
        const eventsRes = await fetch(eventsUrl, {
          headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.timezone="UTC"' },
        });
        const eventsData = await eventsRes.json();
        // With Prefer UTC, Graph returns naive UTC dateTimes; append Z.
        const parseGraph = (dt: string): number =>
          Date.parse(dt.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(dt) ? dt : dt + "Z");
        for (const e of eventsData.value || []) {
          if (!e.start?.dateTime) continue;
          busy.push({
            startMs: parseGraph(e.start.dateTime),
            endMs: parseGraph(e.end?.dateTime || e.start.dateTime),
          });
        }
      }
    } catch (err) {
      console.error("Error fetching Outlook Calendar events:", err);
    }
  }

  // Same cutoffs as before: past slots are never offered, and for *today* the
  // slot must also be at least min_confirm_hours_before away.
  const nowMs = Date.now();
  const cutoffMs = date === mxToday(nowMs) ? nowMs + minConfirmHours * 60 * 60 * 1000 : nowMs;

  const availableSlots = uniqueSlots.filter((slot) => {
    const slotStartMs = mxLocalToMs(date, slot);
    const slotEndMs = slotStartMs + durationMinutes * 60 * 1000;
    if (slotStartMs < cutoffMs) return false;
    for (const b of busy) {
      if (slotStartMs < b.endMs && slotEndMs > b.startMs) return false;
    }
    return true;
  });

  let within48h = false;
  if (availableSlots.length > 0) {
    within48h = mxLocalToMs(date, availableSlots[0]) - nowMs < 48 * 60 * 60 * 1000;
  }

  return new Response(
    JSON.stringify({ slots: availableSlots, duration_minutes: durationMinutes, within_48h: within48h }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
