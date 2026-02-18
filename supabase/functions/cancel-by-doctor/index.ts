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

  // Authenticate doctor via JWT
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Verify token and get user
  const token = authHeader.replace("Bearer ", "");
  const anonSupabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: claimsData, error: claimsError } = await anonSupabase.auth.getClaims(token);
  if (claimsError || !claimsData?.claims) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = claimsData.claims.sub;

  // Get doctor_id for user
  const { data: userRow } = await supabase
    .from("users")
    .select("doctor_id")
    .eq("id", userId)
    .maybeSingle();

  if (!userRow?.doctor_id) {
    return new Response(JSON.stringify({ error: "No es doctor" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const doctorId = userRow.doctor_id;

  let body: { appointment_id: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { appointment_id } = body;
  if (!appointment_id) {
    return new Response(JSON.stringify({ error: "appointment_id requerido" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Get appointment — verify it belongs to the doctor
  const { data: appointment } = await supabase
    .from("appointments")
    .select("id, status, doctor_id, patient_id, start_at, end_at")
    .eq("id", appointment_id)
    .eq("doctor_id", doctorId)
    .maybeSingle();

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

  // Cancel appointment
  const { error: updateError } = await supabase
    .from("appointments")
    .update({ status: "cancelled", cancel_reason: "doctor" })
    .eq("id", appointment_id);

  if (updateError) {
    return new Response(
      JSON.stringify({ error: "Error al cancelar", details: updateError.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get patient info
  const { data: patient } = await supabase
    .from("patients")
    .select("full_name, phone")
    .eq("id", appointment.patient_id)
    .maybeSingle();

  // Get doctor name
  const { data: doctor } = await supabase
    .from("doctors")
    .select("full_name")
    .eq("id", doctorId)
    .maybeSingle();

  // Generate new manage token for rescheduling (12h expiry)
  const rescheduleToken = generateToken();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  await supabase.from("appointment_manage_tokens").insert({
    appointment_id: appointment_id,
    token: rescheduleToken,
    expires_at: expiresAt,
    patient_phone: patient?.phone ?? "",
  });

  const baseUrl = Deno.env.get("APP_URL") || "https://id-preview--f06cae85-4014-499a-b2cc-40cce2aba6c6.lovable.app";
  const rescheduleUrl = `${baseUrl}/gestionar?token=${rescheduleToken}`;

  // Insert notification for doctor
  await supabase.from("notifications").insert({
    doctor_id: doctorId,
    appointment_id: appointment_id,
    recipient_role: "doctor",
    type: "appointment_cancelled_by_doctor",
    title: "Cita cancelada",
    body: `Cancelaste la cita de ${patient?.full_name ?? "Paciente"} del ${appointment.start_at?.split("T")[0] ?? ""}`,
  });

  // Dispatch webhooks (fire-and-forget)
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const dispatchHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${serviceKey}`,
  };

  try {
    await Promise.all([
      fetch(`${supabaseUrl}/functions/v1/dispatch-webhook`, {
        method: "POST",
        headers: dispatchHeaders,
        body: JSON.stringify({
          event_type: "appointment.cancelled_by_doctor",
          payload: {
            appointment_id: appointment_id,
            patient_phone: patient?.phone ?? null,
            patient_name: patient?.full_name ?? null,
            doctor_name: doctor?.full_name ?? null,
            start_at: appointment.start_at,
            cancel_reason: "doctor",
            message: "Tu cita fue cancelada por el doctor",
            reschedule_url: rescheduleUrl,
          },
        }),
      }),
      fetch(`${supabaseUrl}/functions/v1/dispatch-webhook`, {
        method: "POST",
        headers: dispatchHeaders,
        body: JSON.stringify({
          event_type: "appointment.status_changed",
          payload: {
            appointment_id: appointment_id,
            patient_phone: patient?.phone ?? null,
            patient_name: patient?.full_name ?? null,
            previous_status: appointment.status,
            new_status: "cancelled",
            start_at: appointment.start_at,
            timestamp: new Date().toISOString(),
          },
        }),
      }),
    ]);
  } catch (e) {
    console.error("Error dispatching webhooks:", e);
  }

  return new Response(
    JSON.stringify({ success: true, reschedule_url: rescheduleUrl }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
