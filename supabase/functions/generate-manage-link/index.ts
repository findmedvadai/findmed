import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function generateToken(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let token = "";
  for (let i = 0; i < 32; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
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
    // Find latest non-cancelled appointment by patient phone
    const { data: patient } = await supabase
      .from("patients")
      .select("id, phone")
      .eq("phone", patient_phone!)
      .maybeSingle();

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

  // Generate manage token (expires when appointment ends)
  const manageToken = generateToken();
  const expiresAt = appointment.end_at;

  await supabase.from("appointment_manage_tokens").insert({
    appointment_id: appointment.id,
    token: manageToken,
    expires_at: expiresAt,
    patient_phone: patientData?.phone ?? patient_phone ?? "",
  });

  const baseUrl = Deno.env.get("APP_URL") || "https://id-preview--f06cae85-4014-499a-b2cc-40cce2aba6c6.lovable.app";
  const manageUrl = `${baseUrl}/gestionar?token=${manageToken}`;

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
