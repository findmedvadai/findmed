// Busy time of a doctor's external calendar (Google / Microsoft Graph) for
// AVAILABILITY decisions. Shared by:
//   * _shared/day-slots.ts      → slots offered to patients and to the MCP agent
//   * _shared/slot-validation.ts → every path that creates or moves an appointment
// so what FindMed offers and what it accepts follow exactly the same rules (F13, R23).
//
// Rules:
//   * Every page is read: Google `nextPageToken`, Graph `@odata.nextLink`, up to
//     MAX_PAGES. A busy day used to be cut at 50 events, so later events were
//     silently treated as free time.
//   * All-day events block the whole day(s) they cover, in CDMX time. Google
//     sends them as `start.date`/`end.date` (end exclusive); Graph as `isAllDay`
//     with midnight-to-midnight times. They used to be skipped entirely
//     ("Vacaciones" or "Congreso" all day did not block anything). They block
//     even when marked "free": Google and Outlook create all-day events as
//     free by default, and an all-day event in the doctor's agenda means the
//     doctor is not seeing patients that day.
//   * Timed events marked free (Google transparency=transparent, Graph
//     showAs=free) don't block. Cancelled events, invitations the doctor
//     declined, and Google's informational all-day entries (birthdays,
//     working location) don't block either.
//   * `complete: false` means something could not be read (HTTP error, network,
//     bad JSON, too many pages). Callers report that as "not verified" and never
//     as verified free time; whatever WAS read still blocks.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { externalTimeout } from "./http-timeout.ts";
import { mxDayBoundsMs } from "./mx-time.ts";

export type CalendarProvider = "google" | "outlook";

export interface BusyInterval {
  startMs: number;
  endMs: number;
  source: CalendarProvider;
  allDay: boolean;
  summary: string | null;
  /** Provider event id (used to recognize FindMed's own appointment events). */
  eventId?: string | null;
}

export interface BusyResult {
  busy: BusyInterval[];
  complete: boolean;
  /** Why the read is incomplete (null when complete). */
  error: string | null;
}

/** Pages read per query. 10 × 250 events is far beyond any real agenda day/week. */
export const MAX_PAGES = 10;
const PAGE_SIZE = "250";
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** [first day 00:00, end day 00:00) in CDMX. `endDate` is exclusive, as both providers send it. */
function allDayRange(startDate: string, endDate: string | null): { startMs: number; endMs: number } | null {
  if (!DATE_RE.test(startDate)) return null;
  const startMs = mxDayBoundsMs(startDate).startMs;
  if (!Number.isFinite(startMs)) return null;
  let endMs = endDate && DATE_RE.test(endDate) ? mxDayBoundsMs(endDate).startMs : NaN;
  if (!Number.isFinite(endMs) || endMs <= startMs) endMs = startMs + DAY_MS;
  return { startMs, endMs };
}

// ---------------------------------------------------------------------------
// Google

export interface GoogleEvent {
  id?: string;
  status?: string;
  eventType?: string;
  transparency?: string;
  summary?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
}

const GOOGLE_INFORMATIONAL = new Set(["workingLocation", "birthday"]);

export function googleEventBusy(e: GoogleEvent): BusyInterval | null {
  if (e.status === "cancelled") return null;
  if (e.eventType && GOOGLE_INFORMATIONAL.has(e.eventType)) return null;
  if (e.attendees?.some((a) => a.self && a.responseStatus === "declined")) return null;
  const summary = e.summary ?? null;
  const eventId = e.id ?? null;

  if (e.start?.date) {
    const range = allDayRange(e.start.date, e.end?.date ?? null);
    return range ? { ...range, source: "google", allDay: true, summary, eventId } : null;
  }
  if (!e.start?.dateTime || e.transparency === "transparent") return null;
  const startMs = Date.parse(e.start.dateTime);
  const endMs = Date.parse(e.end?.dateTime ?? e.start.dateTime);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return { startMs, endMs: Math.max(startMs, endMs), source: "google", allDay: false, summary, eventId };
}

export async function fetchGoogleBusy(opts: {
  accessToken: string;
  calendarId: string;
  timeMin: string; // ISO instant
  timeMax: string;
}): Promise<BusyResult> {
  const busy: BusyInterval[] = [];
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(opts.calendarId)}/events?`;
  let pageToken: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      timeMin: opts.timeMin,
      timeMax: opts.timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: PAGE_SIZE,
    });
    if (pageToken) params.set("pageToken", pageToken);
    let data: { items?: GoogleEvent[]; nextPageToken?: string };
    try {
      const res = await fetch(base + params, {
        headers: { Authorization: `Bearer ${opts.accessToken}` },
        signal: externalTimeout(),
      });
      if (!res.ok) return { busy, complete: false, error: `http_${res.status}` };
      data = await res.json();
    } catch (err) {
      console.error("[calendar-busy] Google read failed:", err);
      return { busy, complete: false, error: "network_error" };
    }
    for (const e of data.items ?? []) {
      const b = googleEventBusy(e);
      if (b) busy.push(b);
    }
    pageToken = typeof data.nextPageToken === "string" && data.nextPageToken ? data.nextPageToken : null;
    if (!pageToken) return { busy, complete: true, error: null };
  }
  return { busy, complete: false, error: "too_many_pages" };
}

// ---------------------------------------------------------------------------
// Microsoft Graph (Outlook)

export interface OutlookEvent {
  id?: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
  showAs?: string;
  subject?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
}

/** Graph dateTime (no offset; UTC because we send Prefer: outlook.timezone="UTC") → epoch ms. */
function graphUtcMs(dt: string): number {
  return Date.parse(dt.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(dt) ? dt : `${dt}Z`);
}

/**
 * Calendar date of an all-day boundary. Graph sends midnight; rounding to the
 * nearest midnight also covers a boundary shifted by the event's original
 * time zone (e.g. 22:00 of the previous day for a UTC+2 event).
 */
function graphAllDayDate(dt: string): string | null {
  const ms = graphUtcMs(dt);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + DAY_MS / 2).toISOString().slice(0, 10);
}

export function outlookEventBusy(e: OutlookEvent): BusyInterval | null {
  if (e.isCancelled) return null;
  if (!e.start?.dateTime) return null;
  const summary = e.subject ?? null;
  const eventId = e.id ?? null;

  if (e.isAllDay) {
    const startDate = graphAllDayDate(e.start.dateTime);
    const endDate = e.end?.dateTime ? graphAllDayDate(e.end.dateTime) : null;
    const range = startDate ? allDayRange(startDate, endDate) : null;
    return range ? { ...range, source: "outlook", allDay: true, summary, eventId } : null;
  }
  if (e.showAs === "free") return null;
  const startMs = graphUtcMs(e.start.dateTime);
  const endMs = graphUtcMs(e.end?.dateTime ?? e.start.dateTime);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return { startMs, endMs: Math.max(startMs, endMs), source: "outlook", allDay: false, summary, eventId };
}

const GRAPH_ORIGIN = "https://graph.microsoft.com/";

export async function fetchOutlookBusy(opts: {
  accessToken: string;
  calendarId: string;
  timeMin: string; // ISO instant
  timeMax: string;
}): Promise<BusyResult> {
  const busy: BusyInterval[] = [];
  let url: string | null =
    `${GRAPH_ORIGIN}v1.0/me/calendars/${encodeURIComponent(opts.calendarId)}/calendarView?` +
    new URLSearchParams({
      startDateTime: opts.timeMin,
      endDateTime: opts.timeMax,
      $top: PAGE_SIZE,
      $select: "id,subject,start,end,showAs,isAllDay,isCancelled",
    });
  for (let page = 0; page < MAX_PAGES && url; page++) {
    let data: { value?: OutlookEvent[]; "@odata.nextLink"?: string };
    try {
      const res: Response = await fetch(url, {
        headers: { Authorization: `Bearer ${opts.accessToken}`, Prefer: 'outlook.timezone="UTC"' },
        signal: externalTimeout(),
      });
      if (!res.ok) return { busy, complete: false, error: `http_${res.status}` };
      data = await res.json();
    } catch (err) {
      console.error("[calendar-busy] Outlook read failed:", err);
      return { busy, complete: false, error: "network_error" };
    }
    for (const e of data.value ?? []) {
      const b = outlookEventBusy(e);
      if (b) busy.push(b);
    }
    const next = data["@odata.nextLink"];
    if (!next) return { busy, complete: true, error: null };
    // Never send the doctor's token anywhere but Graph.
    if (typeof next !== "string" || !next.startsWith(GRAPH_ORIGIN)) {
      return { busy, complete: false, error: "unexpected_next_link" };
    }
    url = next;
  }
  return { busy, complete: false, error: "too_many_pages" };
}

// ---------------------------------------------------------------------------
// FindMed's own events

/**
 * Drops the busy intervals that are FindMed's own appointment events (the
 * event FindMed wrote to the doctor's calendar for an appointment, whatever
 * its status). Live appointments already block their time from the
 * appointments table, so counting their calendar copy again only hurts:
 *   * moving an appointment collided with its own event (10:00 -> 10:15 was
 *     "taken" by the 10:00 event of that same appointment);
 *   * a cancelled appointment whose event could not be deleted (or was never
 *     deleted: auto-cancel) kept blocking that slot for every other patient.
 * Events the doctor created by hand are not appointment events and still block.
 * If the lookup fails nothing is dropped (blocking is safer than double-booking).
 */
export async function withoutFindMedEvents(supabase: SupabaseClient, busy: BusyInterval[]): Promise<BusyInterval[]> {
  const ids = (source: CalendarProvider) =>
    [...new Set(busy.filter((b) => b.source === source && b.eventId).map((b) => b.eventId as string))];
  const lookups: Array<[CalendarProvider, string[], "google_event_id" | "outlook_event_id"]> = [
    ["google", ids("google"), "google_event_id"],
    ["outlook", ids("outlook"), "outlook_event_id"],
  ];
  const own = { google: new Set<string>(), outlook: new Set<string>() };
  for (const [source, list, column] of lookups) {
    if (list.length === 0) continue;
    const { data, error } = await supabase.from("appointments").select(column).in(column, list);
    if (error) {
      console.error(`[calendar-busy] own-event lookup failed (${source}):`, error.message);
      continue;
    }
    for (const row of (data ?? []) as Record<string, string | null>[]) {
      const id = row[column];
      if (id) own[source].add(id);
    }
  }
  if (own.google.size === 0 && own.outlook.size === 0) return busy;
  return busy.filter((b) => !(b.eventId && own[b.source].has(b.eventId)));
}
