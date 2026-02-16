import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function hmacSign(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let body: { event_type: string; payload: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { event_type, payload } = body;
  if (!event_type || !payload) {
    return new Response(JSON.stringify({ error: "event_type and payload required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Find active webhooks subscribed to this event
  const { data: webhooks } = await supabase
    .from("webhooks")
    .select("id, url, secret, events")
    .eq("is_active", true);

  const matching = (webhooks ?? []).filter((wh: any) =>
    (wh.events as string[]).includes(event_type)
  );

  const results: { webhook_id: string; status: number | string }[] = [];

  for (const wh of matching) {
    const jsonBody = JSON.stringify({ event: event_type, data: payload, timestamp: new Date().toISOString() });
    try {
      const signature = await hmacSign(wh.secret, jsonBody);
      const res = await fetch(wh.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-FindMed-Signature": signature,
          "X-FindMed-Event": event_type,
        },
        body: jsonBody,
        signal: AbortSignal.timeout(30_000),
      });
      results.push({ webhook_id: wh.id, status: res.status });
    } catch (err) {
      console.error(`Webhook ${wh.id} failed:`, err);
      results.push({ webhook_id: wh.id, status: "error" });
    }
  }

  return new Response(
    JSON.stringify({ dispatched: matching.length, results }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
