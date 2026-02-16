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

  const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
  const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

  let body: { token: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { token } = body;
  if (!token) {
    return new Response(JSON.stringify({ error: "Token requerido" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Find manage token
  const { data: manageToken, error: tokenError } = await supabase
    .from("appointment_manage_tokens")
    .select("id, appointment_id, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (tokenError || !manageToken) {
    return new Response(JSON.stringify({ error: "Token inválido" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (new Date(manageToken.expires_at) < new Date()) {
    return new Response(JSON.stringify({ error: "Este enlace ha expirado" }), {
      status: 410,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Get appointment
  const { data: appointment } = await supabase
    .from("appointments")
    .select("id, status, google_event_id, doctor_id, patient_id, start_at")
    .eq("id", manageToken.appointment_id)
    .maybeSingle();

  if (!appointment) {
    return new Response(JSON.stringify({ error: "Cita no encontrada" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (appointment.status === "cancelled") {
    return new Response(JSON.stringify({ error: "Esta cita ya fue cancelada" }), {
      status: 409,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Cancel appointment
  const { error: updateError } = await supabase
    .from("appointments")
    .update({ status: "cancelled", cancel_reason: "patient" })
    .eq("id", appointment.id);

  if (updateError) {
    return new Response(
      JSON.stringify({ error: "Error al cancelar la cita", details: updateError.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get patient info for notification
  const { data: patient } = await supabase
    .from("patients")
    .select("full_name")
    .eq("id", appointment.patient_id)
    .maybeSingle();

  // Insert notification for doctor
  const cancelDate = appointment.start_at?.split("T")[0] ?? "";
  await supabase.from("notifications").insert({
    doctor_id: appointment.doctor_id,
    appointment_id: appointment.id,
    recipient_role: "doctor",
    type: "appointment_cancelled_by_patient",
    title: "Cita cancelada por paciente",
    body: `${patient?.full_name ?? "Paciente"} canceló su cita del ${cancelDate}`,
  });
  if (appointment.google_event_id) {
    const { data: doctor } = await supabase
      .from("doctors")
      .select("google_refresh_token_ref, google_calendar_id, google_calendar_connected")
      .eq("id", appointment.doctor_id)
      .maybeSingle();

    if (doctor?.google_calendar_connected && doctor.google_refresh_token_ref && doctor.google_calendar_id) {
      try {
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            refresh_token: doctor.google_refresh_token_ref,
            grant_type: "refresh_token",
          }),
        });

        const tokenData = await tokenRes.json();
        if (tokenRes.ok && tokenData.access_token) {
          const calendarId = encodeURIComponent(doctor.google_calendar_id);
          await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${appointment.google_event_id}`,
            {
              method: "DELETE",
              headers: { Authorization: `Bearer ${tokenData.access_token}` },
            }
          );
        }
      } catch (err) {
        console.error("Error deleting Google Calendar event:", err);
      }
    }
  }

  // Dispatch webhook (fire-and-forget)
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/dispatch-webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        event_type: "appointment.cancelled",
        payload: {
          appointment_id: appointment.id,
          patient_name: patient?.full_name,
          doctor_id: appointment.doctor_id,
          start_at: appointment.start_at,
          cancel_reason: "patient",
        },
      }),
    });
  } catch (e) {
    console.error("Error dispatching webhook:", e);
  }

  return new Response(
    JSON.stringify({ success: true, message: "Cita cancelada exitosamente" }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
