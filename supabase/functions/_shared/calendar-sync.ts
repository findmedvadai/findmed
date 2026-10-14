// External-calendar side effects of appointment transitions.
//
// Before this helper each cancel path inlined its own DELETE: some didn't
// encodeURIComponent the Google event id, none checked the provider response,
// and the WhatsApp cancel path (update-appointment-status) and auto-cancel
// didn't delete the event at all (F14). Results are reported per provider so
// callers can surface "calendar out of sync" instead of assuming success.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGoogleAccessToken, getOutlookAccessToken } from "./calendar-tokens.ts";
import { externalTimeout } from "./http-timeout.ts";

export type SyncOutcome = "deleted" | "already_gone" | "skipped" | "failed";

export interface CalendarDeleteResult {
  google: SyncOutcome;
  outlook: SyncOutcome;
}

interface AppointmentCalendarRefs {
  office_id: string | null;
  google_event_id: string | null;
  outlook_event_id: string | null;
}

function outcomeFor(status: number): SyncOutcome {
  if (status >= 200 && status < 300) return "deleted";
  if (status === 404 || status === 410) return "already_gone";
  return "failed";
}

export async function deleteAppointmentEvents(
  supabase: SupabaseClient,
  appt: AppointmentCalendarRefs,
): Promise<CalendarDeleteResult> {
  const result: CalendarDeleteResult = { google: "skipped", outlook: "skipped" };
  if (!appt.office_id || (!appt.google_event_id && !appt.outlook_event_id)) return result;

  const { data: office } = await supabase
    .from("doctor_offices")
    .select("id, google_refresh_token_ref, google_calendar_id, google_calendar_connected, outlook_refresh_token_ref, outlook_calendar_id, outlook_calendar_connected")
    .eq("id", appt.office_id)
    .maybeSingle();
  if (!office) return result;

  if (appt.google_event_id && office.google_calendar_connected && office.google_calendar_id) {
    const token = await getGoogleAccessToken({ supabase, office });
    if (!token) {
      result.google = "failed";
    } else {
      try {
        const res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(office.google_calendar_id)}/events/${encodeURIComponent(appt.google_event_id)}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${token}` }, signal: externalTimeout() },
        );
        result.google = outcomeFor(res.status);
      } catch (err) {
        console.error("[calendar-sync] Google delete failed:", err);
        result.google = "failed";
      }
    }
  }

  if (appt.outlook_event_id && office.outlook_calendar_connected && office.outlook_calendar_id) {
    const token = await getOutlookAccessToken({ supabase, office });
    if (!token) {
      result.outlook = "failed";
    } else {
      try {
        const res = await fetch(
          `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(office.outlook_calendar_id)}/events/${encodeURIComponent(appt.outlook_event_id)}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${token}` }, signal: externalTimeout() },
        );
        result.outlook = outcomeFor(res.status);
      } catch (err) {
        console.error("[calendar-sync] Outlook delete failed:", err);
        result.outlook = "failed";
      }
    }
  }

  if (result.google === "failed" || result.outlook === "failed") {
    console.error(`[calendar-sync] event delete incomplete for office ${appt.office_id}:`, result);
  }
  return result;
}
