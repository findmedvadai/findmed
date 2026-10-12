// R36 (signature + duplicates) for the WHAAPY webhook receiver.
//
//   npm run test:edge

import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleWhaapyInbound } from "../functions/whaapy-inbound/handler.ts";
import { FakeDb } from "./fake-supabase.ts";

const SECRET = "whsec_test_0123456789";

async function hmac(content: string, secret = SECRET) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(content));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const event = {
  event: "message.delivered",
  timestamp: "2026-10-12T22:00:00.000Z",
  businessId: "biz",
  data: { whaapy_message_id: "msg-1", conversation_id: "conv-1", contact_id: "c-1", status: "delivered" },
};

function post(raw: string, headers: Record<string, string>, db: FakeDb, secret = SECRET) {
  return handleWhaapyInbound(
    new Request("https://x/functions/v1/whaapy-inbound", { method: "POST", body: raw, headers: { "Content-Type": "application/json", ...headers } }),
    { supabase: db as unknown as SupabaseClient, secret },
  );
}

Deno.test("R36: valid signature (raw body, docs header) is stored once; retries are duplicates", async () => {
  const db = new FakeDb({ whaapy_events: [] });
  const raw = JSON.stringify(event, null, 2); // pretty-printed raw body
  const sig = await hmac(raw);
  const a = await post(raw, { "X-Webhook-Signature": sig }, db);
  assertEquals([a.status, (await a.json()).duplicate], [200, false]);
  const b = await post(raw, { "X-Webhook-Signature": sig }, db);
  assertEquals([b.status, (await b.json()).duplicate], [200, true]);
  assertEquals(db.rows("whaapy_events").length, 1);
  assertEquals(db.rows("whaapy_events")[0].whaapy_message_id, "msg-1");
});

Deno.test("N20/N26: signature over the compact JSON and the dashboard header name are accepted", async () => {
  const db = new FakeDb({ whaapy_events: [] });
  const raw = JSON.stringify(event, null, 2);
  const sig = await hmac(JSON.stringify(JSON.parse(raw)));
  const r = await post(raw, { "X-Whaapy-Signature": `sha256=${sig}` }, db);
  assertEquals(r.status, 200);
});

Deno.test("R36: missing or wrong signature → 401 and nothing stored", async () => {
  const db = new FakeDb({ whaapy_events: [] });
  const raw = JSON.stringify(event);
  assertEquals((await post(raw, {}, db)).status, 401);
  assertEquals((await post(raw, { "X-Webhook-Signature": await hmac(raw, "other-secret") }, db)).status, 401);
  const tampered = JSON.stringify({ ...event, data: { ...event.data, status: "read" } });
  assertEquals((await post(tampered, { "X-Webhook-Signature": await hmac(raw) }, db)).status, 401);
  assertEquals(db.rows("whaapy_events").length, 0);
});

Deno.test("fails closed without a configured secret", async () => {
  const db = new FakeDb({ whaapy_events: [] });
  const raw = JSON.stringify(event);
  const r = await post(raw, { "X-Webhook-Signature": await hmac(raw) }, db, "");
  assertEquals(r.status, 503);
  assertEquals(db.rows("whaapy_events").length, 0);
});
