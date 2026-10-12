import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isServiceRequest } from "../_shared/service-auth.ts";
import { verifyJwtClaims } from "../_shared/auth.ts";
import { getServiceKey } from "../_shared/supabase-keys.ts";

// Events the browser may dispatch directly (post-consultation flows in
// PorCompletar.tsx and SendReportModal.tsx). Everything else must come from
// our own backend with the service key. Value = roles allowed to send it.
const USER_DISPATCHABLE_EVENTS: Record<string, Array<"admin" | "doctor">> = {
  "postconsultation.submitted": ["admin", "doctor"],
  "postconsultation.report_sent": ["admin"],
};

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
    getServiceKey()
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

  // --- Caller authorization ---
  // This endpoint signs payloads with the real webhook secrets and n8n turns
  // them into WhatsApp messages, so it must never be callable anonymously.
  if (!isServiceRequest(req)) {
    const forbidden = (status: number, error: string) =>
      new Response(JSON.stringify({ error }), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const claims = token ? await verifyJwtClaims(token) : null;
    if (!claims?.sub) return forbidden(401, "Unauthorized");
    const userId = claims.sub as string;

    const allowedRoles = USER_DISPATCHABLE_EVENTS[event_type];
    if (!allowedRoles) return forbidden(403, "Forbidden");

    const [{ data: isAdmin }, { data: userRow }] = await Promise.all([
      supabase.rpc("is_admin_or_superadmin", { _user_id: userId }),
      supabase.from("users").select("doctor_id").eq("id", userId).maybeSingle(),
    ]);
    const callerRole = isAdmin ? "admin" : userRow?.doctor_id ? "doctor" : null;
    if (!callerRole || !allowedRoles.includes(callerRole)) return forbidden(403, "Forbidden");

    // The payload must reference a real appointment the caller can act on,
    // and the patient contact data is taken from the DB, not from the client,
    // so a caller can't redirect messages to an arbitrary phone.
    const appointmentId = payload.appointment_id as string | undefined;
    if (!appointmentId) return forbidden(400, "appointment_id required");
    const { data: appt } = await supabase
      .from("appointments")
      .select("doctor_id, patients(full_name, phone)")
      .eq("id", appointmentId)
      .maybeSingle();
    if (!appt) return forbidden(404, "Appointment not found");
    if (callerRole === "doctor" && appt.doctor_id !== userRow?.doctor_id) {
      return forbidden(403, "Forbidden");
    }
    const patient = (appt as { patients?: { full_name?: string; phone?: string } }).patients;
    payload.patient_name = patient?.full_name ?? null;
    payload.patient_phone = patient?.phone ?? null;
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
