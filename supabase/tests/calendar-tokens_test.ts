// Calendar connection loss: auto-disconnect and token rotation only touch the
// office when the token that failed / rotated is STILL the office's token.
// A stale row (loaded before the doctor reconnected) must never wipe a fresh
// connection, and a rotated old grant must never overwrite a newer one.
//
//   npm run test:edge

import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGoogleAccessToken, getOutlookAccessToken } from "../functions/_shared/calendar-tokens.ts";
import { FakeDb, stubFetch } from "./fake-supabase.ts";

Deno.env.set("GOOGLE_CLIENT_ID", "test-client");
Deno.env.set("GOOGLE_CLIENT_SECRET", "test-secret");
Deno.env.set("OUTLOOK_CLIENT_ID", "test-client");
Deno.env.set("OUTLOOK_CLIENT_SECRET", "test-secret");

const CONNECTED_AT = "2026-10-01T15:00:00.000Z";

function db(token: string) {
  return new FakeDb({
    doctor_offices: [{
      id: "o1",
      doctor_id: "d1",
      google_calendar_connected: true,
      google_calendar_id: "cal@example.com",
      google_calendar_name: "Consultorio",
      google_refresh_token_ref: token,
      google_connected_at: CONNECTED_AT,
      outlook_calendar_connected: true,
      outlook_calendar_id: "olcal",
      outlook_calendar_name: "Outlook",
      outlook_refresh_token_ref: token,
      outlook_connected_at: CONNECTED_AT,
    }],
    calendar_connection_events: [],
  });
}
const sb = (d: FakeDb) => d as unknown as SupabaseClient;
const officeWith = (token: string) => ({
  id: "o1",
  google_calendar_connected: true,
  google_calendar_id: "cal@example.com",
  google_refresh_token_ref: token,
  outlook_calendar_connected: true,
  outlook_calendar_id: "olcal",
  outlook_refresh_token_ref: token,
});
const invalidGrant = () =>
  stubFetch(200, () => ({ status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } }));

Deno.test("invalid_grant on the office's current token → disconnects and records durable evidence", async () => {
  const d = db("CURRENT");
  const office = officeWith("CURRENT");
  const f = invalidGrant();
  try {
    assertEquals(await getGoogleAccessToken({ supabase: sb(d), office }), null);
  } finally {
    f.restore();
  }
  const row = d.rows("doctor_offices")[0];
  assertEquals(
    [row.google_calendar_connected, row.google_calendar_id, row.google_refresh_token_ref, row.google_calendar_name, row.google_connected_at],
    [false, null, null, null, null],
  );
  assertEquals(row.outlook_calendar_connected, true); // the other provider is untouched
  const ev = d.rows("calendar_connection_events");
  assertEquals(ev.map((e) => [e.provider, e.event_type, e.reason_code, e.http_status, e.connected_at, e.doctor_id]), [
    ["google", "auto_disconnect", "invalid_grant", 400, CONNECTED_AT, "d1"],
  ]);
  assertEquals(office.google_calendar_connected, false); // in-memory row reflects it
});

Deno.test("invalid_grant from a STALE token (doctor reconnected meanwhile) keeps the new connection", async () => {
  const d = db("NEW_AFTER_RECONNECT");
  const f = invalidGrant();
  try {
    assertEquals(await getGoogleAccessToken({ supabase: sb(d), office: officeWith("OLD_REVOKED") }), null);
    assertEquals(await getOutlookAccessToken({ supabase: sb(d), office: officeWith("OLD_REVOKED") }), null);
  } finally {
    f.restore();
  }
  const row = d.rows("doctor_offices")[0];
  assertEquals([row.google_calendar_connected, row.google_refresh_token_ref, row.google_calendar_id], [true, "NEW_AFTER_RECONNECT", "cal@example.com"]);
  assertEquals([row.outlook_calendar_connected, row.outlook_refresh_token_ref], [true, "NEW_AFTER_RECONNECT"]);
  assertEquals(d.rows("calendar_connection_events").length, 0); // nothing was disconnected
});

Deno.test("rotated refresh token is stored only over the token it replaces", async () => {
  const rotate = () =>
    stubFetch(200, () => ({ status: 200, body: { access_token: "access", refresh_token: "ROTATED", expires_in: 3600 } }));

  // Normal Microsoft rotation: stored.
  let d = db("CURRENT");
  let f = rotate();
  try {
    const office = officeWith("CURRENT");
    assertEquals(await getOutlookAccessToken({ supabase: sb(d), office }), "access");
    assertEquals(d.rows("doctor_offices")[0].outlook_refresh_token_ref, "ROTATED");
    assertEquals(office.outlook_refresh_token_ref, "ROTATED");
  } finally {
    f.restore();
  }

  // The doctor reconnected (maybe another account) while this request ran
  // with the old grant: the newer token is kept.
  d = db("NEWER");
  f = rotate();
  try {
    assertEquals(await getOutlookAccessToken({ supabase: sb(d), office: officeWith("OLDER") }), "access");
    assertEquals(d.rows("doctor_offices")[0].outlook_refresh_token_ref, "NEWER");
  } finally {
    f.restore();
  }
});

Deno.test("transient provider errors never disconnect", async () => {
  const d = db("CURRENT");
  const f = stubFetch(200, () => ({ status: 503, body: { error: "temporarily_unavailable" } }));
  try {
    assertEquals(await getGoogleAccessToken({ supabase: sb(d), office: officeWith("CURRENT") }), null);
  } finally {
    f.restore();
  }
  assertEquals(d.rows("doctor_offices")[0].google_calendar_connected, true);
  assertEquals(d.rows("calendar_connection_events").length, 0);
});
