import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGoogleAccessToken, getOutlookAccessToken } from "../_shared/calendar-tokens.ts";

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

  // Get appointment (now scoped by office for downstream calendar sync).
  const { data: appointment } = await supabase
    .from("appointments")
    .select("id, status, google_event_id, outlook_event_id, doctor_id, office_id, patient_id, start_at")
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
    .select("full_name, phone")
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

  // Calendar sync now reads tokens off the appointment's office, not doctors.
  // The shared helper handles refresh token rotation (Microsoft) and auto-
  // disconnects the office on invalid_grant.
  let office:
    | {
        id: string;
        google_refresh_token_ref: string | null;
        google_calendar_id: string | null;
        google_calendar_connected: boolean;
        outlook_refresh_token_ref: string | null;
        outlook_calendar_id: string | null;
        outlook_calendar_connected: boolean;
      }
    | null = null;
  if (appointment.office_id) {
    const { data: officeRow } = await supabase
      .from("doctor_offices")
      .select(
        "id, google_refresh_token_ref, google_calendar_id, google_calendar_connected, " +
          "outlook_refresh_token_ref, outlook_calendar_id, outlook_calendar_connected"
      )
      .eq("id", appointment.office_id)
      .maybeSingle();
    office = officeRow ?? null;
  }

  if (appointment.google_event_id && office?.google_calendar_connected && office.google_calendar_id) {
    const accessToken = await getGoogleAccessToken({ supabase, office });
    if (accessToken) {
      try {
        const calendarId = encodeURIComponent(office.google_calendar_id);
        await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${appointment.google_event_id}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
        );
      } catch (err) {
        console.error("Error deleting Google Calendar event:", err);
      }
    }
  }

  if (appointment.outlook_event_id && office?.outlook_calendar_connected && office.outlook_calendar_id) {
    const accessToken = await getOutlookAccessToken({ supabase, office });
    if (accessToken) {
      try {
        const calendarId = encodeURIComponent(office.outlook_calendar_id);
        await fetch(
          `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events/${encodeURIComponent(appointment.outlook_event_id)}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
        );
      } catch (err) {
        console.error("Error deleting Outlook Calendar event:", err);
      }
    }
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const baseUrl = Deno.env.get("APP_URL") || "https://findmed.lovable.app";
  const manageUrl = `${baseUrl}/gestionar?token=${token}`;

  // Dispatch webhooks (fire-and-forget)
  try {
    await Promise.all([
      fetch(`${supabaseUrl}/functions/v1/dispatch-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          event_type: "appointment.cancelled_by_patient",
          payload: {
            appointment_id: appointment.id,
            patient_name: patient?.full_name,
            patient_phone: patient?.phone ?? null,
            doctor_id: appointment.doctor_id,
            start_at: appointment.start_at,
            cancel_reason: "patient",
            manage_url: manageUrl,
          },
        }),
      }),
      fetch(`${supabaseUrl}/functions/v1/dispatch-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          event_type: "appointment.status_changed",
          payload: {
            appointment_id: appointment.id,
            patient_phone: patient?.phone ?? null,
            patient_name: patient?.full_name ?? null,
            previous_status: appointment.status,
            new_status: "cancelled",
            start_at: appointment.start_at,
            timestamp: new Date().toISOString(),
            manage_url: manageUrl,
          },
        }),
      }),
    ]);
  } catch (e) {
    console.error("Error dispatching webhooks:", e);
  }

  return new Response(
    JSON.stringify({ success: true, message: "Cita cancelada exitosamente" }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
