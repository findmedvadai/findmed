// F13 / R23 — external calendar busy time: pagination, all-day events (CDMX
// day), free/cancelled/declined events, and "not verified" on provider errors.
// Covers the shared parser (_shared/calendar-busy.ts) and the write-path check
// (_shared/slot-validation.ts) with simulated Google / Graph responses.
//
//   npm run test:edge

import { assert, assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  fetchGoogleBusy,
  fetchOutlookBusy,
  googleEventBusy,
  MAX_PAGES,
  outlookEventBusy,
} from "../functions/_shared/calendar-busy.ts";
import { validateSlotAvailable } from "../functions/_shared/slot-validation.ts";
import { mxDayBoundsMs, mxLocalToMs } from "../functions/_shared/mx-time.ts";
import { FakeDb, stubFetch } from "./fake-supabase.ts";

Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ default: "sb_secret_test" }));
Deno.env.set("GOOGLE_CLIENT_ID", "test-client");
Deno.env.set("GOOGLE_CLIENT_SECRET", "test-secret");
Deno.env.set("OUTLOOK_CLIENT_ID", "test-client");
Deno.env.set("OUTLOOK_CLIENT_SECRET", "test-secret");

const DATE = "2027-03-01"; // a Monday, far in the future
const at = (hm: string, date = DATE) => new Date(mxLocalToMs(date, hm)).toISOString();
const DAY = mxDayBoundsMs(DATE);

// ---------------------------------------------------------------------------
// Parsers

Deno.test("Google all-day event blocks the whole CDMX day (end date exclusive), even if marked free", () => {
  const b = googleEventBusy({ summary: "Vacaciones", start: { date: DATE }, end: { date: "2027-03-02" }, transparency: "transparent" });
  assertEquals([b?.startMs, b?.endMs, b?.allDay, b?.summary], [DAY.startMs, DAY.endMs, true, "Vacaciones"]);
  // 00:00 CDMX = 06:00 UTC: the day is NOT the UTC day.
  assertEquals(new Date(b!.startMs).toISOString(), "2027-03-01T06:00:00.000Z");
  const three = googleEventBusy({ start: { date: DATE }, end: { date: "2027-03-04" } });
  assertEquals(three!.endMs - three!.startMs, 3 * 86_400_000);
  const noEnd = googleEventBusy({ start: { date: DATE } });
  assertEquals(noEnd!.endMs, DAY.endMs);
});

Deno.test("Google: free timed, cancelled, declined and informational entries don't block", () => {
  const timed = { start: { dateTime: at("10:00") }, end: { dateTime: at("11:00") } };
  assert(googleEventBusy(timed));
  assertEquals(googleEventBusy({ ...timed, transparency: "transparent" }), null);
  assertEquals(googleEventBusy({ ...timed, status: "cancelled" }), null);
  assertEquals(googleEventBusy({ ...timed, attendees: [{ self: true, responseStatus: "declined" }] }), null);
  assert(googleEventBusy({ ...timed, attendees: [{ self: false, responseStatus: "declined" }, { self: true, responseStatus: "accepted" }] }));
  assertEquals(googleEventBusy({ eventType: "birthday", start: { date: DATE }, end: { date: "2027-03-02" } }), null);
  assertEquals(googleEventBusy({ eventType: "workingLocation", start: { date: DATE }, end: { date: "2027-03-02" } }), null);
  assert(googleEventBusy({ eventType: "outOfOffice", start: { date: DATE }, end: { date: "2027-03-02" } }));
});

Deno.test("Outlook all-day (isAllDay) blocks the CDMX day; a boundary shifted by the event's zone still lands on its date", () => {
  const utcMidnight = outlookEventBusy({ isAllDay: true, subject: "Congreso", showAs: "free", start: { dateTime: "2027-03-01T00:00:00.0000000" }, end: { dateTime: "2027-03-02T00:00:00.0000000" } });
  assertEquals([utcMidnight?.startMs, utcMidnight?.endMs, utcMidnight?.allDay], [DAY.startMs, DAY.endMs, true]);
  const shifted = outlookEventBusy({ isAllDay: true, start: { dateTime: "2027-02-28T22:00:00.0000000" }, end: { dateTime: "2027-03-01T22:00:00.0000000" } });
  assertEquals([shifted?.startMs, shifted?.endMs], [DAY.startMs, DAY.endMs]);
});

Deno.test("Outlook timed events: Graph's 7-digit fractions parse as UTC; free and cancelled don't block", () => {
  const e = { start: { dateTime: "2027-03-01T16:00:00.0000000" }, end: { dateTime: "2027-03-01T17:00:00.0000000" } };
  const b = outlookEventBusy(e);
  assertEquals([b?.startMs, b?.endMs], [Date.parse(at("10:00")), Date.parse(at("11:00"))]);
  assertEquals(outlookEventBusy({ ...e, showAs: "free" }), null);
  assertEquals(outlookEventBusy({ ...e, isCancelled: true }), null);
  assert(outlookEventBusy({ ...e, showAs: "tentative" }));
});

// ---------------------------------------------------------------------------
// Pagination

const RANGE = { accessToken: "at", calendarId: "cal@example.com", timeMin: new Date(DAY.startMs).toISOString(), timeMax: new Date(DAY.endMs).toISOString() };

Deno.test("Google: follows nextPageToken; an event on page 2 is read", async () => {
  const f = stubFetch(200, (url) => {
    if (!url.includes("googleapis.com/calendar")) return undefined;
    if (url.includes("pageToken=p2")) return { status: 200, body: { items: [{ start: { dateTime: at("15:00") }, end: { dateTime: at("16:00") } }] } };
    return { status: 200, body: { items: [{ start: { dateTime: at("09:00") }, end: { dateTime: at("10:00") } }], nextPageToken: "p2" } };
  });
  try {
    const r = await fetchGoogleBusy(RANGE);
    assertEquals([r.complete, r.busy.length], [true, 2]);
    assertEquals(f.calls.length, 2);
    assert(f.calls[0].url.includes("maxResults=250"));
  } finally {
    f.restore();
  }
});

Deno.test("Google: endless pages stop at MAX_PAGES and are reported incomplete; HTTP errors too", async () => {
  let f = stubFetch(200, () => ({ status: 200, body: { items: [], nextPageToken: "again" } }));
  try {
    const r = await fetchGoogleBusy(RANGE);
    assertEquals([r.complete, r.error, f.calls.length], [false, "too_many_pages", MAX_PAGES]);
  } finally {
    f.restore();
  }
  f = stubFetch(200, (url) => {
    if (url.includes("pageToken=p2")) return { status: 503, body: { error: "backendError" } };
    return { status: 200, body: { items: [{ start: { dateTime: at("09:00") }, end: { dateTime: at("10:00") } }], nextPageToken: "p2" } };
  });
  try {
    const r = await fetchGoogleBusy(RANGE);
    assertEquals([r.complete, r.error, r.busy.length], [false, "http_503", 1]); // page 1 still blocks
  } finally {
    f.restore();
  }
});

Deno.test("Outlook: follows @odata.nextLink with the UTC Prefer header; never sends the token outside Graph", async () => {
  const next = "https://graph.microsoft.com/v1.0/me/calendars/cal/calendarView?$skip=250";
  const f = stubFetch(200, (url) => {
    if (url === next) return { status: 200, body: { value: [{ isAllDay: true, start: { dateTime: "2027-03-01T00:00:00.0000000" }, end: { dateTime: "2027-03-02T00:00:00.0000000" } }] } };
    return { status: 200, body: { value: [], "@odata.nextLink": next } };
  });
  try {
    const r = await fetchOutlookBusy(RANGE);
    assertEquals([r.complete, r.busy.length, r.busy[0].allDay], [true, 1, true]);
    assert(f.calls[0].url.includes("isAllDay"));
  } finally {
    f.restore();
  }
  const evil = stubFetch(200, () => ({ status: 200, body: { value: [], "@odata.nextLink": "https://evil.example/steal" } }));
  try {
    const r = await fetchOutlookBusy(RANGE);
    assertEquals([r.complete, r.error, evil.calls.length], [false, "unexpected_next_link", 1]);
  } finally {
    evil.restore();
  }
});

// ---------------------------------------------------------------------------
// slot-validation (admin/doctor/patient write paths)

function officeDb(extra: Record<string, unknown>) {
  return new FakeDb({
    appointments: [],
    doctor_offices: [{
      id: "o1",
      doctor_id: "d1",
      google_calendar_connected: false,
      google_calendar_id: null,
      google_refresh_token_ref: null,
      outlook_calendar_connected: false,
      outlook_calendar_id: null,
      outlook_refresh_token_ref: null,
      ...extra,
    }],
    calendar_connection_events: [],
  });
}
const googleOffice = { google_calendar_connected: true, google_calendar_id: "cal@example.com", google_refresh_token_ref: "refresh" };
const outlookOffice = { outlook_calendar_connected: true, outlook_calendar_id: "cal", outlook_refresh_token_ref: "refresh" };
const slot = (db: FakeDb, hm = "10:00") =>
  validateSlotAvailable({ supabase: db as unknown as SupabaseClient, doctorId: "d1", officeId: "o1", startAt: at(hm), endAt: new Date(mxLocalToMs(DATE, hm) + 30 * 60_000).toISOString() });

function googleWith(pages: Record<string, unknown>[] | ((url: string) => { status: number; body: unknown } | undefined)) {
  return stubFetch(200, (url) => {
    if (url.includes("oauth2.googleapis.com")) return { status: 200, body: { access_token: "at", expires_in: 3600 } };
    if (!url.includes("googleapis.com/calendar")) return undefined;
    if (typeof pages === "function") return pages(url);
    const m = /pageToken=p(\d+)/.exec(url);
    const i = m ? Number(m[1]) : 0;
    return { status: 200, body: { ...pages[i], ...(i + 1 < pages.length ? { nextPageToken: `p${i + 1}` } : {}) } };
  });
}

Deno.test("slot-validation: an event that only appears on page 2 blocks the slot", async () => {
  const filler = Array.from({ length: 250 }, () => ({ start: { dateTime: at("07:00") }, end: { dateTime: at("07:30") } }));
  const f = googleWith([{ items: filler }, { items: [{ summary: "Cirugía", start: { dateTime: at("10:00") }, end: { dateTime: at("11:00") } }] }]);
  try {
    const r = await slot(officeDb(googleOffice));
    assertEquals([r.available, r.external_calendar, r.conflicts[0]?.reason], [false, "verified", "Cirugía"]);
  } finally {
    f.restore();
  }
});

Deno.test("slot-validation: an all-day event blocks any time that day; the query covers the whole CDMX day", async () => {
  const f = googleWith([{ items: [{ summary: "Vacaciones", start: { date: DATE }, end: { date: "2027-03-02" } }] }]);
  try {
    const r = await slot(officeDb(googleOffice), "18:30"); // 00:30 UTC next day
    assertEquals([r.available, r.conflicts[0]?.source, r.conflicts[0]?.reason], [false, "google", "Vacaciones"]);
    const q = new URL(f.calls.find((c) => c.url.includes("/events?"))!.url);
    assertEquals([q.searchParams.get("timeMin"), q.searchParams.get("timeMax")], ["2027-03-01T06:00:00.000Z", "2027-03-02T06:00:00.000Z"]);
  } finally {
    f.restore();
  }
  const g = googleWith([{ items: [{ summary: "Ayer", start: { date: "2027-02-28" }, end: { date: DATE } }] }]);
  try {
    assertEquals((await slot(officeDb(googleOffice), "09:00")).available, true); // previous day ended at 00:00 CDMX
  } finally {
    g.restore();
  }
});

Deno.test("slot-validation: a 'free' timed event doesn't block (same rule as the slots offered to patients)", async () => {
  const f = googleWith([{ items: [{ start: { dateTime: at("10:00") }, end: { dateTime: at("11:00") }, transparency: "transparent" }] }]);
  try {
    const r = await slot(officeDb(googleOffice));
    assertEquals([r.available, r.external_calendar], [true, "verified"]);
  } finally {
    f.restore();
  }
});

Deno.test("slot-validation: provider failure keeps 'not verified' semantics (not blocked, flagged unverified)", async () => {
  const f = googleWith(() => ({ status: 503, body: { error: "backendError" } }));
  try {
    const r = await slot(officeDb(googleOffice));
    assertEquals([r.available, r.external_calendar], [true, "unverified"]);
  } finally {
    f.restore();
  }
  const noCal = await slot(officeDb({}));
  assertEquals([noCal.available, noCal.external_calendar], [true, "not_connected"]);
});

Deno.test("slot-validation: Outlook all-day event on page 2 blocks", async () => {
  const next = "https://graph.microsoft.com/v1.0/me/calendars/cal/calendarView?$skip=250";
  const f = stubFetch(200, (url) => {
    if (url.includes("login.microsoftonline.com")) return { status: 200, body: { access_token: "at", refresh_token: "refresh", expires_in: 3600 } };
    if (url === next) return { status: 200, body: { value: [{ subject: "Congreso", isAllDay: true, showAs: "free", start: { dateTime: "2027-03-01T00:00:00.0000000" }, end: { dateTime: "2027-03-02T00:00:00.0000000" } }] } };
    if (url.includes("graph.microsoft.com")) return { status: 200, body: { value: [], "@odata.nextLink": next } };
  });
  try {
    const r = await slot(officeDb(outlookOffice));
    assertEquals([r.available, r.conflicts[0]?.source, r.conflicts[0]?.reason, r.external_calendar], [false, "outlook", "Congreso", "verified"]);
  } finally {
    f.restore();
  }
});
