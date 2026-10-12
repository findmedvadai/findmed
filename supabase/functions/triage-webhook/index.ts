// Creates a reservation session (72 h) and returns the /reserva link for an
// explicit doctor + office. Auth: `fm_` API key or our service key.
// Body: { doctor_id, office_id, patient_name, patient_phone, symptoms? }.
//
// The logic lives in _shared/booking-session.ts (also used by the FindMed MCP
// tool create_booking_link). The response keeps the original fields. The link
// is an invitation to book — no appointment exists until the patient books.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getServiceKey } from "../_shared/supabase-keys.ts";
import { verifyApiKey } from "../_shared/api-key.ts";
import { isServiceRequest } from "../_shared/service-auth.ts";
import { createReservationSession } from "../_shared/booking-session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const LEGACY_ERRORS: Record<string, string> = {
  invalid_phone: "invalid_phone",
  doctor_not_found: "Doctor not found or inactive",
  office_not_found: "Office not found or inactive",
  db_error: "Failed to create reservation session",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, getServiceKey());
  if (!isServiceRequest(req) && !(await verifyApiKey(req, supabase))) return json(401, { error: "Unauthorized" });

  let body: { doctor_id?: string; office_id?: string; patient_name?: string; patient_phone?: string; symptoms?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const { doctor_id, office_id, patient_name, patient_phone, symptoms } = body;
  if (!doctor_id || !office_id || !patient_name || !patient_phone) {
    return json(400, { error: "Missing required fields: doctor_id, office_id, patient_name, patient_phone" });
  }

  const r = await createReservationSession(supabase, {
    doctorId: doctor_id,
    officeId: office_id,
    patientName: patient_name,
    patientPhone: patient_phone,
    symptoms,
  });
  if (!r.ok) return json(r.status, { error: LEGACY_ERRORS[r.code], message_es: r.message_es });

  return json(200, {
    success: true,
    reserve_url: r.reserve_url,
    session_id: r.session_id,
    token: r.token,
    expires_at: r.expires_at,
    patient_id: r.patient_id,
    doctor_name: r.doctor_name,
    office_id: r.office_id,
    office_name: r.office_name,
    office_address: r.office_address,
  });
});
