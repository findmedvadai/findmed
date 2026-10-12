// Confirms an appointment. Callers:
//   * our backend (service key) or an integration with an `fm_` API key: may
//     identify the appointment by appointment_id, manage_token or patient_phone;
//   * anyone else: ONLY with the patient's own manage_token (possessing the
//     link is the authorization; anonymous lookups by phone/appointment_id
//     allowed confirming other people's appointments — N03).
// By phone, exactly one upcoming appointment must match; otherwise 409
// `multiple_appointments` with the candidates (never "the first row" — F14).
// The transition itself lives in _shared/appointment-actions.ts.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeMxPhone, mxPhoneLookupVariants } from "../_shared/phone.ts";
import { verifyApiKey } from "../_shared/api-key.ts";
import { isServiceRequest } from "../_shared/service-auth.ts";
import { getServiceKey } from "../_shared/supabase-keys.ts";
import { applyPatientAction, findUpcomingAppointmentsByPhone, httpStatusFor } from "../_shared/appointment-actions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, getServiceKey());

  let body: { appointment_id?: string; patient_phone?: string; manage_token?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const { manage_token } = body;
  let { appointment_id, patient_phone } = body;
  if (!appointment_id && !patient_phone && !manage_token) {
    return json(400, { error: "appointment_id, patient_phone o manage_token requerido" });
  }

  const trusted = isServiceRequest(req) || (await verifyApiKey(req, supabase));
  if (!trusted) {
    if (!manage_token) return json(401, { error: "Unauthorized" });
    appointment_id = undefined;
    patient_phone = undefined;
  }

  let targetId: string | undefined = appointment_id;

  if (!targetId && manage_token) {
    const { data: tokenRow } = await supabase
      .from("appointment_manage_tokens")
      .select("appointment_id, expires_at")
      .eq("token", manage_token)
      .maybeSingle();
    if (!tokenRow) return json(404, { error: "Token inválido" });
    if (new Date(tokenRow.expires_at) < new Date()) return json(410, { error: "Este enlace ha expirado" });
    targetId = tokenRow.appointment_id;
  }

  if (!targetId && patient_phone) {
    const found = await findUpcomingAppointmentsByPhone(supabase, mxPhoneLookupVariants(normalizeMxPhone(patient_phone)));
    if (!found.ok) return json(500, { error: "Error al buscar la cita" });
    const confirmable = found.appointments.filter((a) => a.status === "scheduled");
    if (confirmable.length === 0) return json(404, { error: "Cita no encontrada" });
    if (confirmable.length > 1) {
      return json(409, { error: "multiple_appointments", appointments: confirmable });
    }
    targetId = confirmable[0].appointment_id;
  }

  const result = await applyPatientAction(supabase, {
    appointmentId: targetId!,
    action: "confirm",
    channel: trusted ? "api" : "web",
    manageToken: manage_token ?? null,
  });
  if (!result.ok) return json(httpStatusFor(result.code), { error: result.message_es, code: result.code });
  return json(200, { success: true, appointment_id: result.appointment_id });
});
