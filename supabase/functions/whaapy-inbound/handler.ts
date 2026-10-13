// Testable core of whaapy-inbound (no Deno.serve, no env access).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyWhaapySignature } from "../_shared/whaapy-signature.ts";
import { processAndMark } from "../_shared/whaapy-events.ts";
import type { WhaapyClient } from "../_shared/whaapy-client.ts";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface WhaapyEnvelope {
  event?: string;
  timestamp?: string;
  data?: {
    whaapy_message_id?: string;
    message_id?: string;
    conversation_id?: string;
    contact_id?: string;
    status?: string;
    message?: { id?: string };
  };
}

export async function handleWhaapyInbound(
  req: Request,
  deps: { supabase: SupabaseClient; secret: string; whaapy?: WhaapyClient },
): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  // Fail closed: without the secret nothing can be verified.
  if (!deps.secret) return json(503, { error: "not_configured" });

  const raw = await req.text();
  if (!(await verifyWhaapySignature(raw, req.headers, deps.secret))) {
    return json(401, { error: "invalid_signature" });
  }

  let body: WhaapyEnvelope;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "invalid_json" });
  }
  const event = body.event ?? req.headers.get("X-Webhook-Event") ?? "unknown";
  const d = body.data ?? {};
  const messageId = d.whaapy_message_id ?? d.message_id ?? d.message?.id ?? null;

  // WHAAPY suggests event+timestamp for idempotency; message/conversation ids
  // and the delivery status make the key specific for receipts too.
  const dedupeKey = await sha256Hex(
    [event, body.timestamp ?? "", messageId ?? "", d.conversation_id ?? "", d.status ?? ""].join("|"),
  );

  const { data: inserted, error } = await deps.supabase
    .from("whaapy_events")
    .upsert(
      {
        dedupe_key: dedupeKey,
        event_type: event,
        event_timestamp: body.timestamp ?? null,
        whaapy_message_id: messageId,
        conversation_id: d.conversation_id ?? null,
        contact_id: d.contact_id ?? null,
        payload: body,
      },
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    )
    .select("id");
  if (error) {
    // 5xx → WHAAPY retries; nothing was stored.
    console.error("[whaapy-inbound] store failed:", error);
    return json(500, { error: "store_failed" });
  }
  const duplicate = !inserted || inserted.length === 0;
  // Process right away (receipts, FindMed buttons). The event is already
  // stored, so a processing failure is retried by findmed-events-worker.
  let outcome: string | undefined;
  if (!duplicate && deps.whaapy) {
    const id = (inserted as { id: string }[])[0].id;
    outcome = (await processAndMark(deps.supabase, deps.whaapy, { id, event_type: event, payload: body as never })).outcome;
  }
  console.log(JSON.stringify({ event: "whaapy_inbound", type: event, duplicate, outcome }));
  return json(200, { received: true, duplicate });
}
