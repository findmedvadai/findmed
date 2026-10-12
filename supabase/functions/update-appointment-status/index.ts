// Confirm or cancel an appointment on the patient's behalf from an integration
// (formerly the n8n WhatsApp bot). Auth: `fm_` API key or our service key.
//
// Body: { action: "confirm" | "cancel", appointment_id? , patient_phone? }.
// Prefer appointment_id. With only a phone, exactly one upcoming appointment
// eligible for the action must match; otherwise 409 `multiple_appointments`
// with the candidates — the old code acted on the first row it found (F14).
// Cancelling now also deletes the external calendar event (it didn't).
// The transition lives in _shared/appointment-actions.ts.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeMxPhone, mxPhoneLookupVariants } from "../_shared/phone.ts";
import { getServiceKey } from "../_shared/supabase-keys.ts";
import { verifyApiKey } from "../_shared/api-key.ts";
import { isServiceRequest } from "../_shared/service-auth.ts";
import { applyPatientAction, findUpcomingAppointmentsByPhone, httpStatusFor } from "../_shared/appointment-actions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, getServiceKey());
  if (!isServiceRequest(req) && !(await verifyApiKey(req, supabase))) return json(401, { error: "Unauthorized" });

  let body: { appointment_id?: string; patient_phone?: string; action?: "confirm" | "cancel" };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const { action, appointment_id, patient_phone } = body;
  if (action !== "confirm" && action !== "cancel") return json(400, { error: "action must be 'confirm' or 'cancel'" });
  if (!appointment_id && !patient_phone) return json(400, { error: "Provide appointment_id or patient_phone" });

  let targetId = appointment_id;
  if (!targetId) {
    const found = await findUpcomingAppointmentsByPhone(supabase, mxPhoneLookupVariants(normalizeMxPhone(patient_phone!)));
    if (!found.ok) return json(500, { error: "Failed to look up appointments" });
    const eligible = found.appointments.filter((a) => action === "cancel" || a.status === "scheduled");
    if (eligible.length === 0) return json(404, { error: "No active appointment found" });
    if (eligible.length > 1) return json(409, { error: "multiple_appointments", appointments: eligible });
    targetId = eligible[0].appointment_id;
  }

  const result = await applyPatientAction(supabase, { appointmentId: targetId, action, channel: "whatsapp" });
  if (!result.ok) return json(httpStatusFor(result.code), { error: result.code, message_es: result.message_es });
  return json(200, {
    success: true,
    appointment_id: result.appointment_id,
    new_status: result.new_status,
    previous_status: result.previous_status,
    calendar: result.calendar ?? null,
  });
});
