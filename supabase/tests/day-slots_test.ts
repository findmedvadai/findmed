// R16, R20, R22 (simulated), R25 (slot side): slot computation shared by
// reserve-slots and the MCP.
//
//   npm run test:edge

import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeDaySlots } from "../functions/_shared/day-slots.ts";
import { mxLocalToMs } from "../functions/_shared/mx-time.ts";
import { FakeDb, stubFetch } from "./fake-supabase.ts";

Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ default: "sb_secret_test" }));
Deno.env.set("GOOGLE_CLIENT_ID", "test-client");
Deno.env.set("GOOGLE_CLIENT_SECRET", "test-secret");

// A Monday well in the future (weekday 1), so "today/past" cutoffs don't apply.
const DATE = "2027-03-01";
const iso = (hm: string) => new Date(mxLocalToMs(DATE, hm)).toISOString();

function db(officeExtra: Record<string, unknown> = {}, appts: Record<string, unknown>[] = [], overrides: Record<string, unknown>[] = []) {
  return new FakeDb({
    doctor_offices: [{
      id: "o1",
      doctor_id: "d1",
      appointment_duration_minutes: 60,
      is_active: true,
      is_deleted: false,
      google_calendar_connected: false,
      google_calendar_id: null,
      google_refresh_token_ref: null,
      outlook_calendar_connected: false,
      outlook_calendar_id: null,
      outlook_refresh_token_ref: null,
      ...officeExtra,
    }],
    doctor_schedule_settings: [{ doctor_id: "d1", min_confirm_hours_before: 24 }],
    doctor_weekly_availability: [{ office_id: "o1", weekday: 1, is_enabled: true, start_time: "09:00:00", end_time: "12:00:00" }],
    doctor_date_overrides: overrides,
    appointments: appts,
  });
}
const sb = (d: FakeDb) => d as unknown as SupabaseClient;

Deno.test("weekly block produces slots of the office duration", async () => {
  const r = await computeDaySlots(sb(db()), "o1", DATE);
  assertEquals(r.ok && r.value.slots, ["09:00", "10:00", "11:00"]);
  assertEquals(r.ok && r.value.availability_status, "verified");
});

Deno.test("R25: the doctor's appointment in ANOTHER office removes the slot (D2)", async () => {
  const appts = [{ doctor_id: "d1", office_id: "o2", status: "confirmed", start_at: iso("10:00"), end_at: iso("10:30") }];
  const r = await computeDaySlots(sb(db({}, appts)), "o1", DATE);
  assertEquals(r.ok && r.value.slots, ["09:00", "11:00"]);
});

Deno.test("cancelled appointments don't block", async () => {
  const appts = [{ doctor_id: "d1", office_id: "o1", status: "cancelled", start_at: iso("10:00"), end_at: iso("11:00") }];
  const r = await computeDaySlots(sb(db({}, appts)), "o1", DATE);
  assertEquals(r.ok && r.value.slots, ["09:00", "10:00", "11:00"]);
});

Deno.test("R16: inactive office, blocked day, no weekly block, past date", async () => {
  let r = await computeDaySlots(sb(db({ is_active: false })), "o1", DATE);
  assertEquals(r.ok && r.value.availability_status, "office_unavailable");
  r = await computeDaySlots(sb(db({}, [], [{ doctor_id: "d1", override_date: DATE, is_available: false }])), "o1", DATE);
  assertEquals(r.ok && r.value.availability_status, "day_blocked");
  r = await computeDaySlots(sb(db()), "o1", "2027-03-02"); // Tuesday: no block
  assertEquals(r.ok && r.value.availability_status, "no_weekly_availability");
  r = await computeDaySlots(sb(db()), "o1", "2020-01-06");
  assertEquals(r.ok && r.value.availability_status, "past_date");
});

Deno.test("R20: malformed date is rejected", async () => {
  const r = await computeDaySlots(sb(db()), "o1", "01/03/2027");
  assertEquals(r.ok, false);
});

const googleOffice = {
  google_calendar_connected: true,
  google_calendar_id: "cal@example.com",
  google_refresh_token_ref: "refresh",
};

Deno.test("Google busy event blocks; 'free' (transparent) event doesn't", async () => {
  const f = stubFetch(200, (url) => {
    if (url.includes("oauth2.googleapis.com")) return { status: 200, body: { access_token: "at", expires_in: 3600 } };
    if (url.includes("googleapis.com/calendar")) {
      return {
        status: 200,
        body: {
          items: [
            { start: { dateTime: iso("09:00") }, end: { dateTime: iso("09:30") } },
            { start: { dateTime: iso("11:00") }, end: { dateTime: iso("12:00") }, transparency: "transparent" },
          ],
        },
      };
    }
  });
  try {
    const r = await computeDaySlots(sb(db(googleOffice)), "o1", DATE);
    assertEquals(r.ok && r.value.slots, ["10:00", "11:00"]);
    assertEquals(r.ok && r.value.availability_status, "verified");
  } finally {
    f.restore();
  }
});

Deno.test("R22 (simulated): unreadable Google calendar → external_calendar_unverified, never 'verified'", async () => {
  const f = stubFetch(200, (url) => {
    if (url.includes("oauth2.googleapis.com")) return { status: 200, body: { access_token: "at", expires_in: 3600 } };
    if (url.includes("googleapis.com/calendar")) return { status: 503, body: { error: "backendError" } };
  });
  try {
    const r = await computeDaySlots(sb(db(googleOffice)), "o1", DATE);
    assertEquals(r.ok && r.value.availability_status, "external_calendar_unverified");
    assertEquals(r.ok && r.value.slots, ["09:00", "10:00", "11:00"]); // FindMed data still applied
  } finally {
    f.restore();
  }
});
