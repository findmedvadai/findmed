import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createManageToken } from "../_shared/manage-token.ts";
import { normalizeMxPhone, mxPhoneLookupVariants } from "../_shared/phone.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

  let body: { appointment_id?: string; patient_phone?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { appointment_id, patient_phone } = body;
  if (!appointment_id && !patient_phone) {
    return new Response(
      JSON.stringify({ error: "appointment_id o patient_phone requerido" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let appointment: any;

  if (appointment_id) {
    const { data } = await supabase
      .from("appointments")
      .select("id, status, patient_id, end_at")
      .eq("id", appointment_id)
      .maybeSingle();
    appointment = data;
  } else {
    // Find latest non-cancelled appointment by patient phone. The lookup
    // tolerates Mexican `+52` / `+521` variants so the n8n flow can pass any
    // form the patient typed without missing existing rows.
    const phoneVariants = mxPhoneLookupVariants(normalizeMxPhone(patient_phone!));
    const { data: patientMatches } = await supabase
      .from("patients")
      .select("id, phone")
      .in("phone", phoneVariants)
      .order("created_at", { ascending: true })
      .limit(1);
    const patient = patientMatches?.[0];

    if (!patient) {
      return new Response(JSON.stringify({ error: "Paciente no encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data } = await supabase
      .from("appointments")
      .select("id, status, patient_id, end_at")
      .eq("patient_id", patient.id)
      .in("status", ["scheduled", "confirmed"])
      .order("start_at", { ascending: true })
      .limit(1);

    appointment = data?.[0];
  }

  if (!appointment) {
    return new Response(JSON.stringify({ error: "Cita no encontrada" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (appointment.status === "cancelled") {
    return new Response(JSON.stringify({ error: "La cita ya fue cancelada" }), {
      status: 409,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Get patient phone
  const { data: patientData } = await supabase
    .from("patients")
    .select("phone")
    .eq("id", appointment.patient_id)
    .maybeSingle();

  // Generate manage token (expires when appointment ends).
  const expiresAt = appointment.end_at;
  const { token: manageToken, manageUrl } = await createManageToken({
    supabase,
    appointmentId: appointment.id,
    expiresAt,
    patientPhone: patientData?.phone ?? patient_phone ?? "",
  });

  return new Response(
    JSON.stringify({
      success: true,
      manage_url: manageUrl,
      manage_token: manageToken,
      expires_at: expiresAt,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
