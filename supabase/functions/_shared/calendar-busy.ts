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

import { mxDayBoundsMs } from "./mx-time.ts";

export type CalendarProvider = "google" | "outlook";

export interface BusyInterval {
  startMs: number;
  endMs: number;
  source: CalendarProvider;
  allDay: boolean;
  summary: string | null;
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

  if (e.start?.date) {
    const range = allDayRange(e.start.date, e.end?.date ?? null);
    return range ? { ...range, source: "google", allDay: true, summary } : null;
  }
  if (!e.start?.dateTime || e.transparency === "transparent") return null;
  const startMs = Date.parse(e.start.dateTime);
  const endMs = Date.parse(e.end?.dateTime ?? e.start.dateTime);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return { startMs, endMs: Math.max(startMs, endMs), source: "google", allDay: false, summary };
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
      const res = await fetch(base + params, { headers: { Authorization: `Bearer ${opts.accessToken}` } });
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

  if (e.isAllDay) {
    const startDate = graphAllDayDate(e.start.dateTime);
    const endDate = e.end?.dateTime ? graphAllDayDate(e.end.dateTime) : null;
    const range = startDate ? allDayRange(startDate, endDate) : null;
    return range ? { ...range, source: "outlook", allDay: true, summary } : null;
  }
  if (e.showAs === "free") return null;
  const startMs = graphUtcMs(e.start.dateTime);
  const endMs = graphUtcMs(e.end?.dateTime ?? e.start.dateTime);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return { startMs, endMs: Math.max(startMs, endMs), source: "outlook", allDay: false, summary };
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
