// Shared slot-availability check used by every admin appointment write path
// (create, reschedule). The patient self-booking flow (`reserve-create`) does
// not currently use it because the slot is already filtered by `reserve-slots`
// before the user picks one — but if you ever need a defense-in-depth check
// there, this is the function to call.
//
// A slot is available iff:
//   1. No other non-cancelled appointment for the same doctor overlaps the
//      requested [start_at, end_at) range. The optional `excludeAppointmentId`
//      lets reschedule ignore the appointment being moved.
//   2. No event on the doctor's connected Google calendar overlaps.
//   3. No event on the doctor's connected Outlook calendar overlaps.
//
// External calendar API failures are treated as "unknown availability" — we
// log and continue, because we don't want a flaky third-party API to block
// admin operations. Internal appointment overlaps are hard blocks.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGoogleAccessToken, getOutlookAccessToken } from "./calendar-tokens.ts";

export interface SlotConflict {
  source: "appointment" | "google" | "outlook";
  start_at: string;
  end_at: string;
  reason: string;
}

export interface SlotValidationResult {
  available: boolean;
  conflicts: SlotConflict[];
}

interface ValidateSlotInput {
  supabase: SupabaseClient;
  doctorId: string;
  /**
   * Office to validate against. When provided we conflict-check ONLY against
   * that office's appointments and external calendars. When omitted we fall
   * back to the doctor-wide check (kept for backward compat with paths that
   * haven't been migrated to multi-office yet — should be removed once they
   * all pass office_id).
   */
  officeId?: string;
  startAt: string; // ISO 8601 with offset, e.g. "2026-04-27T08:00:00-06:00" or with Z
  endAt: string;
  excludeAppointmentId?: string;
}

export async function validateSlotAvailable(input: ValidateSlotInput): Promise<SlotValidationResult> {
  const { supabase, doctorId, officeId, startAt, endAt, excludeAppointmentId } = input;

  const startMs = new Date(startAt).getTime();
  const endMs = new Date(endAt).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return {
      available: false,
      conflicts: [{ source: "appointment", start_at: startAt, end_at: endAt, reason: "invalid_range" }],
    };
  }

  const conflicts: SlotConflict[] = [];

  // 1. Internal appointments. Scope to the office when provided — different
  // offices of the same doctor can have overlapping appointments only because
  // of human error elsewhere; we still want to allow concurrent slots in
  // different offices (different physical locations).
  let q = supabase
    .from("appointments")
    .select("id, start_at, end_at, status, office_id")
    .eq("doctor_id", doctorId)
    .in("status", ["scheduled", "confirmed", "completed"])
    .lt("start_at", new Date(endMs).toISOString())
    .gt("end_at", new Date(startMs).toISOString());
  if (officeId) q = q.eq("office_id", officeId);
  if (excludeAppointmentId) q = q.neq("id", excludeAppointmentId);

  const { data: overlaps } = await q;
  for (const a of overlaps ?? []) {
    conflicts.push({
      source: "appointment",
      start_at: a.start_at,
      end_at: a.end_at,
      reason: `Existing ${a.status} appointment`,
    });
  }
  if (conflicts.length > 0) {
    return { available: false, conflicts };
  }

  // 2./3. External calendars: read from the office row when provided, else
  // from the legacy doctors row. The office id is needed so the token helper
  // can persist Microsoft's rotated refresh_token and auto-disconnect on
  // permanent failures.
  let doctor:
    | ({
        id: string | null;
        google_calendar_connected?: boolean | null;
        google_refresh_token_ref?: string | null;
        google_calendar_id?: string | null;
        outlook_calendar_connected?: boolean | null;
        outlook_refresh_token_ref?: string | null;
        outlook_calendar_id?: string | null;
      })
    | null = null;

  if (officeId) {
    const { data } = await supabase
      .from("doctor_offices")
      .select(
        "id, google_calendar_connected, google_refresh_token_ref, google_calendar_id, " +
          "outlook_calendar_connected, outlook_refresh_token_ref, outlook_calendar_id"
      )
      .eq("id", officeId)
      .maybeSingle();
    doctor = data;
  } else {
    // Legacy path (no officeId). The token helper can't persist rotation or
    // auto-disconnect here because there is no office row to update. Acceptable
    // because all production callers pass officeId post-Mejora 2.
    const { data } = await supabase
      .from("doctors")
      .select(
        "google_calendar_connected, google_refresh_token_ref, google_calendar_id, " +
          "outlook_calendar_connected, outlook_refresh_token_ref, outlook_calendar_id"
      )
      .eq("id", doctorId)
      .maybeSingle();
    doctor = data ? { id: null, ...data } : null;
  }

  if (!doctor) return { available: true, conflicts: [] };

  // Widen the query window slightly so an event starting 10 minutes early is
  // still caught. The conflict math itself is exact.
  const widenStart = new Date(startMs - 60 * 60 * 1000).toISOString();
  const widenEnd = new Date(endMs + 60 * 60 * 1000).toISOString();

  if (doctor.google_calendar_connected && doctor.google_calendar_id) {
    try {
      const accessToken = await getGoogleAccessToken({ supabase, office: doctor });
      if (accessToken) {
        const calendarId = encodeURIComponent(doctor.google_calendar_id);
        const url =
          `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?` +
          new URLSearchParams({
            timeMin: widenStart,
            timeMax: widenEnd,
            singleEvents: "true",
            orderBy: "startTime",
            maxResults: "50",
          });
        const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (res.ok) {
          const data = await res.json();
          for (const e of (data.items ?? []) as Array<{ start?: { dateTime?: string }; end?: { dateTime?: string }; summary?: string }>) {
            if (!e.start?.dateTime || !e.end?.dateTime) continue;
            const eStart = new Date(e.start.dateTime).getTime();
            const eEnd = new Date(e.end.dateTime).getTime();
            if (eStart < endMs && eEnd > startMs) {
              conflicts.push({
                source: "google",
                start_at: e.start.dateTime,
                end_at: e.end.dateTime,
                reason: e.summary ?? "Google event",
              });
            }
          }
        }
      }
    } catch (err) {
      console.error("[slot-validation] Google check failed (treating as available):", err);
    }
  }

  if (doctor.outlook_calendar_connected && doctor.outlook_calendar_id) {
    try {
      const accessToken = await getOutlookAccessToken({ supabase, office: doctor });
      if (accessToken) {
        const calendarId = encodeURIComponent(doctor.outlook_calendar_id);
        const url =
          `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/calendarView?` +
          new URLSearchParams({
            startDateTime: widenStart,
            endDateTime: widenEnd,
            $top: "50",
            $orderby: "start/dateTime",
            $select: "id,subject,start,end",
          });
        const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (res.ok) {
          const data = await res.json();
          for (const e of (data.value ?? []) as Array<{ start?: { dateTime?: string }; end?: { dateTime?: string }; subject?: string }>) {
            if (!e.start?.dateTime || !e.end?.dateTime) continue;
            // Microsoft Graph returns dateTime without offset; default is UTC when
            // no Prefer header is sent, so appending "Z" yields a valid instant.
            const eStartIso = e.start.dateTime.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(e.start.dateTime)
              ? e.start.dateTime
              : e.start.dateTime.replace(/\.\d+$/, "") + "Z";
            const eEndIso = e.end.dateTime.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(e.end.dateTime)
              ? e.end.dateTime
              : e.end.dateTime.replace(/\.\d+$/, "") + "Z";
            const eStart = new Date(eStartIso).getTime();
            const eEnd = new Date(eEndIso).getTime();
            if (eStart < endMs && eEnd > startMs) {
              conflicts.push({
                source: "outlook",
                start_at: eStartIso,
                end_at: eEndIso,
                reason: e.subject ?? "Outlook event",
              });
            }
          }
        }
      }
    } catch (err) {
      console.error("[slot-validation] Outlook check failed (treating as available):", err);
    }
  }

  return { available: conflicts.length === 0, conflicts };
}
