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
// admin operations. Internal appointment overlaps are hard blocks. The result
// says so explicitly (`external_calendar: "unverified"`), and whatever part of
// the calendar could be read still blocks (F13).
//
// External busy time follows _shared/calendar-busy.ts (all pages; all-day
// events block the whole CDMX day; free/cancelled/declined events don't), the
// same rules used for the slots offered to patients.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGoogleAccessToken, getOutlookAccessToken } from "./calendar-tokens.ts";
import { type BusyInterval, fetchGoogleBusy, fetchOutlookBusy, withoutFindMedEvents } from "./calendar-busy.ts";
import { msToMxIso, mxDayBoundsMs } from "./mx-time.ts";

export interface SlotConflict {
  source: "appointment" | "google" | "outlook";
  start_at: string;
  end_at: string;
  reason: string;
}

export interface SlotValidationResult {
  available: boolean;
  conflicts: SlotConflict[];
  /**
   * "verified": connected calendar fully read · "unverified": connected but
   * (partly) unreadable, slot NOT blocked for that reason · "not_connected".
   * Absent when the slot was rejected before looking at calendars.
   */
  external_calendar?: "verified" | "unverified" | "not_connected";
}

interface ValidateSlotInput {
  supabase: SupabaseClient;
  doctorId: string;
  /**
   * Office whose external calendar (Google/Outlook) is checked. Internal
   * appointment conflicts are always checked doctor-wide (D2). When omitted
   * the legacy doctors-row calendar is used (backward compat).
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

  // 1. Internal appointments, scoped to the DOCTOR across all their offices:
  // a doctor can't be in two places at once (decision D2, 2026-10-12; enforced
  // in the DB by the appointments_no_overlap_per_doctor exclusion constraint).
  // officeId only selects which external calendar to check below.
  let q = supabase
    .from("appointments")
    .select("id, start_at, end_at, status, office_id")
    .eq("doctor_id", doctorId)
    .in("status", ["scheduled", "confirmed", "completed"])
    .lt("start_at", new Date(endMs).toISOString())
    .gt("end_at", new Date(startMs).toISOString());
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
    // One string literal: a concatenated select loses supabase-js typing.
    const { data } = await supabase
      .from("doctor_offices")
      .select("id, google_calendar_connected, google_refresh_token_ref, google_calendar_id, outlook_calendar_connected, outlook_refresh_token_ref, outlook_calendar_id")
      .eq("id", officeId)
      .maybeSingle();
    doctor = data;
  } else {
    // Legacy path (no officeId). The token helper can't persist rotation or
    // auto-disconnect here because there is no office row to update. Acceptable
    // because all production callers pass officeId post-Mejora 2.
    const { data } = await supabase
      .from("doctors")
      .select("google_calendar_connected, google_refresh_token_ref, google_calendar_id, outlook_calendar_connected, outlook_refresh_token_ref, outlook_calendar_id")
      .eq("id", doctorId)
      .maybeSingle();
    doctor = data ? { id: null, ...data } : null;
  }

  if (!doctor) return { available: true, conflicts: [], external_calendar: "not_connected" };

  // Query the whole CDMX day(s) the slot touches, so all-day events of that
  // day are always returned. The overlap math below is exact.
  const firstDay = msToMxIso(startMs).slice(0, 10);
  const lastDay = msToMxIso(endMs - 1).slice(0, 10);
  const range = {
    timeMin: new Date(mxDayBoundsMs(firstDay).startMs).toISOString(),
    timeMax: new Date(mxDayBoundsMs(lastDay).endMs).toISOString(),
  };

  // Same rules as the slots offered to patients (_shared/calendar-busy.ts):
  // every page, all-day events block the day, free/cancelled/declined don't.
  let checked = false;
  let unverified = false;
  // FindMed's own appointment events don't count (the appointments table is
  // the source for those): the moved appointment's old event and events left
  // behind by cancelled appointments must not block (calendar-busy.ts).
  const addConflicts = async (raw: BusyInterval[], fallback: string) => {
    const busy = await withoutFindMedEvents(supabase, raw);
    for (const b of busy) {
      if (b.startMs < endMs && b.endMs > startMs) {
        conflicts.push({
          source: b.source,
          start_at: new Date(b.startMs).toISOString(),
          end_at: new Date(b.endMs).toISOString(),
          reason: b.summary ?? (b.allDay ? `${fallback} (todo el día)` : fallback),
        });
      }
    }
  };

  if (doctor.google_calendar_connected && doctor.google_calendar_id) {
    checked = true;
    const accessToken = await getGoogleAccessToken({ supabase, office: doctor });
    if (!accessToken) {
      unverified = true;
    } else {
      const r = await fetchGoogleBusy({ accessToken, calendarId: doctor.google_calendar_id, ...range });
      await addConflicts(r.busy, "Google event");
      if (!r.complete) {
        unverified = true;
        console.error("[slot-validation] Google check incomplete (not verified):", r.error);
      }
    }
  }

  if (doctor.outlook_calendar_connected && doctor.outlook_calendar_id) {
    checked = true;
    const accessToken = await getOutlookAccessToken({ supabase, office: doctor });
    if (!accessToken) {
      unverified = true;
    } else {
      const r = await fetchOutlookBusy({ accessToken, calendarId: doctor.outlook_calendar_id, ...range });
      await addConflicts(r.busy, "Outlook event");
      if (!r.complete) {
        unverified = true;
        console.error("[slot-validation] Outlook check incomplete (not verified):", r.error);
      }
    }
  }

  return {
    available: conflicts.length === 0,
    conflicts,
    external_calendar: !checked ? "not_connected" : unverified ? "unverified" : "verified",
  };
}
