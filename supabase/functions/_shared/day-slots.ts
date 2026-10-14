// Bookable slots of one office on one CDMX calendar day. Shared by
// `reserve-slots` (patient web flow) and the FindMed MCP (`list_available_slots`).
//
// Slots come from the office's weekly blocks for that weekday, minus:
//   * the doctor's date override (blocked day),
//   * live appointments of the DOCTOR in any office (decision D2),
//   * busy events in the office's connected Google/Outlook calendar (all
//     pages; all-day events block the whole day — see _shared/calendar-busy.ts),
//   * past slots, and for *today* slots closer than min_confirm_hours_before.
//
// Everything is compared as absolute instants (see _shared/mx-time.ts).
//
// `availability_status` makes calendar health explicit (F13): when the office
// has a connected calendar that could not be read, slots are still computed
// from FindMed data but reported as `external_calendar_unverified`, so no
// caller presents them as verified free time.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGoogleAccessToken, getOutlookAccessToken } from "./calendar-tokens.ts";
import { fetchGoogleBusy, fetchOutlookBusy } from "./calendar-busy.ts";
import { isValidLocalDate, mxDayBoundsMs, mxLocalToMs, mxToday } from "./mx-time.ts";

export type AvailabilityStatus =
  | "verified" // FindMed data + connected calendar (if any) checked
  | "external_calendar_unverified" // calendar connected but unreadable now
  | "past_date"
  | "office_unavailable" // missing, inactive or deleted
  | "no_weekly_availability" // no enabled block that weekday
  | "day_blocked"; // doctor_date_overrides marks the day unavailable

export interface DaySlots {
  slots: string[]; // "HH:mm", CDMX wall clock
  duration_minutes: number;
  within_48h: boolean;
  timezone: "America/Mexico_City";
  availability_status: AvailabilityStatus;
  doctor_id: string | null;
}

export type DaySlotsResult = { ok: true; value: DaySlots } | { ok: false; error: "invalid_date" };

const empty = (status: AvailabilityStatus, extra: Partial<DaySlots> = {}): DaySlotsResult => ({
  ok: true,
  value: {
    slots: [],
    duration_minutes: 30,
    within_48h: false,
    timezone: "America/Mexico_City",
    availability_status: status,
    doctor_id: null,
    ...extra,
  },
});

interface Busy {
  startMs: number;
  endMs: number;
}

export async function computeDaySlots(supabase: SupabaseClient, officeId: string, date: string): Promise<DaySlotsResult> {
  if (!isValidLocalDate(date)) return { ok: false, error: "invalid_date" };
  if (date < mxToday()) return empty("past_date");

  const { data: office } = await supabase
    .from("doctor_offices")
    .select("id, doctor_id, appointment_duration_minutes, google_calendar_connected, google_refresh_token_ref, google_calendar_id, outlook_calendar_connected, outlook_refresh_token_ref, outlook_calendar_id, is_active, is_deleted")
    .eq("id", officeId)
    .maybeSingle();
  if (!office || !office.is_active || office.is_deleted) return empty("office_unavailable");

  const duration = office.appointment_duration_minutes ?? 30;
  const base = { duration_minutes: duration, doctor_id: office.doctor_id };

  const { data: settings } = await supabase
    .from("doctor_schedule_settings")
    .select("min_confirm_hours_before")
    .eq("doctor_id", office.doctor_id)
    .maybeSingle();
  const minConfirmHours = settings?.min_confirm_hours_before ?? 24;

  // Weekday of the requested CDMX date (noon UTC avoids any day rollover).
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const { data: blocks } = await supabase
    .from("doctor_weekly_availability")
    .select("start_time, end_time")
    .eq("office_id", officeId)
    .eq("weekday", weekday)
    .eq("is_enabled", true);
  if (!blocks || blocks.length === 0) return empty("no_weekly_availability", base);

  const { data: override } = await supabase
    .from("doctor_date_overrides")
    .select("is_available")
    .eq("doctor_id", office.doctor_id)
    .eq("override_date", date)
    .maybeSingle();
  if (override && !override.is_available) return empty("day_blocked", base);

  const candidates = new Set<string>();
  for (const b of blocks) {
    const [sh, sm] = String(b.start_time).split(":").map(Number);
    const [eh, em] = String(b.end_time).split(":").map(Number);
    for (let m = sh * 60 + sm; m + duration <= eh * 60 + em; m += duration) {
      candidates.add(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
    }
  }

  const { startMs: dayStartMs, endMs: dayEndMs } = mxDayBoundsMs(date);
  const dayStartIso = new Date(dayStartMs).toISOString();
  const dayEndIso = new Date(dayEndMs).toISOString();

  const { data: appts } = await supabase
    .from("appointments")
    .select("start_at, end_at")
    .eq("doctor_id", office.doctor_id)
    .in("status", ["scheduled", "confirmed"])
    .lt("start_at", dayEndIso)
    .gt("end_at", dayStartIso);
  const busy: Busy[] = (appts ?? []).map((a) => ({ startMs: Date.parse(a.start_at), endMs: Date.parse(a.end_at) }));

  // External calendar: every page, all-day events block the whole CDMX day,
  // free/cancelled/declined don't (rules in _shared/calendar-busy.ts, shared
  // with slot-validation so an offered slot is also an accepted one).
  let calendarVerified = true;
  const dayRange = { timeMin: dayStartIso, timeMax: dayEndIso };

  if (office.google_calendar_connected && office.google_calendar_id) {
    const token = await getGoogleAccessToken({ supabase, office });
    if (!token) {
      calendarVerified = false;
    } else {
      const r = await fetchGoogleBusy({ accessToken: token, calendarId: office.google_calendar_id, ...dayRange });
      busy.push(...r.busy);
      if (!r.complete) calendarVerified = false;
    }
  }
  if (office.outlook_calendar_connected && office.outlook_calendar_id) {
    const token = await getOutlookAccessToken({ supabase, office });
    if (!token) {
      calendarVerified = false;
    } else {
      const r = await fetchOutlookBusy({ accessToken: token, calendarId: office.outlook_calendar_id, ...dayRange });
      busy.push(...r.busy);
      if (!r.complete) calendarVerified = false;
    }
  }

  const nowMs = Date.now();
  const cutoffMs = date === mxToday(nowMs) ? nowMs + minConfirmHours * 3_600_000 : nowMs;
  const slots = [...candidates].sort().filter((slot) => {
    const s = mxLocalToMs(date, slot);
    const e = s + duration * 60_000;
    if (s < cutoffMs) return false;
    return !busy.some((b) => s < b.endMs && e > b.startMs);
  });

  return {
    ok: true,
    value: {
      slots,
      duration_minutes: duration,
      within_48h: slots.length > 0 && mxLocalToMs(date, slots[0]) - nowMs < 48 * 3_600_000,
      timezone: "America/Mexico_City",
      availability_status: calendarVerified ? "verified" : "external_calendar_unverified",
      doctor_id: office.doctor_id,
    },
  };
}
