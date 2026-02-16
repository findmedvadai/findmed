import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

  let appointmentQuery = supabase
    .from("appointments")
    .select("id, status, doctor_id, patient_id, start_at");

  if (appointment_id) {
    appointmentQuery = appointmentQuery.eq("id", appointment_id);
  } else {
    // Find by patient phone - get the latest scheduled appointment
    const { data: patient } = await supabase
      .from("patients")
      .select("id")
      .eq("phone", patient_phone!)
      .maybeSingle();

    if (!patient) {
      return new Response(JSON.stringify({ error: "Paciente no encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    appointmentQuery = appointmentQuery
      .eq("patient_id", patient.id)
      .eq("status", "scheduled")
      .order("start_at", { ascending: true })
      .limit(1);
  }

  const { data: appointments } = await appointmentQuery;
  const appointment = appointments?.[0];

  if (!appointment) {
    return new Response(JSON.stringify({ error: "Cita no encontrada" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (appointment.status !== "scheduled") {
    return new Response(
      JSON.stringify({ error: `La cita tiene estado '${appointment.status}', no se puede confirmar` }),
      { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Update to confirmed
  const { error: updateError } = await supabase
    .from("appointments")
    .update({ status: "confirmed" })
    .eq("id", appointment.id);

  if (updateError) {
    return new Response(
      JSON.stringify({ error: "Error al confirmar", details: updateError.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get patient name for notification
  const { data: patient } = await supabase
    .from("patients")
    .select("full_name")
    .eq("id", appointment.patient_id)
    .maybeSingle();

  // Insert notification for doctor
  await supabase.from("notifications").insert({
    doctor_id: appointment.doctor_id,
    appointment_id: appointment.id,
    recipient_role: "doctor",
    type: "appointment_scheduled",
    title: "Cita confirmada",
    body: `${patient?.full_name ?? "Paciente"} confirmó su cita del ${appointment.start_at?.split("T")[0] ?? ""}`,
  });

  // Dispatch webhook
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/dispatch-webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        event_type: "appointment.confirmed",
        payload: {
          appointment_id: appointment.id,
          patient_name: patient?.full_name,
          start_at: appointment.start_at,
        },
      }),
    });
  } catch (e) {
    console.error("Error dispatching webhook:", e);
  }

  return new Response(
    JSON.stringify({ success: true, appointment_id: appointment.id }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
