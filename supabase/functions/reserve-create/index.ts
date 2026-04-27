import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createManageToken } from "../_shared/manage-token.ts";

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
  const OUTLOOK_CLIENT_ID = Deno.env.get("OUTLOOK_CLIENT_ID") || "";
  const OUTLOOK_CLIENT_SECRET = Deno.env.get("OUTLOOK_CLIENT_SECRET") || "";

  let body: { session_id: string; slot_start: string; date: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { session_id, slot_start, date } = body;
  if (!session_id || !slot_start || !date) {
    return new Response(JSON.stringify({ error: "session_id, slot_start y date requeridos" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Get session — includes office_id chosen at triage time so the appointment
  // and the external calendar event both go to the right place.
  const { data: session, error: sessionError } = await supabase
    .from("reservation_sessions")
    .select("id, doctor_id, office_id, patient_id, symptoms, used_at, expires_at")
    .eq("id", session_id)
    .maybeSingle();

  if (sessionError || !session) {
    return new Response(JSON.stringify({ error: "Sesión no encontrada" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (session.used_at) {
    return new Response(JSON.stringify({ error: "Este enlace ya fue utilizado" }), {
      status: 410,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (new Date(session.expires_at) < new Date()) {
    return new Response(JSON.stringify({ error: "Este enlace ha expirado" }), {
      status: 410,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!session.office_id) {
    return new Response(JSON.stringify({ error: "Sesión sin consultorio asignado" }), {
      status: 410,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Office: duration + calendar config.
  const { data: office } = await supabase
    .from("doctor_offices")
    .select(
      "id, name, address, appointment_duration_minutes, " +
        "google_refresh_token_ref, google_calendar_id, google_calendar_connected, " +
        "outlook_refresh_token_ref, outlook_calendar_id, outlook_calendar_connected"
    )
    .eq("id", session.office_id)
    .maybeSingle();

  if (!office) {
    return new Response(JSON.stringify({ error: "Consultorio no encontrado" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const durationMinutes = office.appointment_duration_minutes ?? 30;

  // Calculate start_at and end_at with explicit Mexico City offset (-06:00).
  const startAt = `${date}T${slot_start}:00-06:00`;
  const slotParts = slot_start.split(":").map(Number);
  const totalMinutes = slotParts[0] * 60 + slotParts[1] + durationMinutes;
  const endHH = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const endMM = String(totalMinutes % 60).padStart(2, "0");
  const endAt = `${date}T${endHH}:${endMM}:00-06:00`;

  const { data: patient } = await supabase
    .from("patients")
    .select("full_name, phone")
    .eq("id", session.patient_id)
    .maybeSingle();

  const { data: doctor } = await supabase
    .from("doctors")
    .select("full_name")
    .eq("id", session.doctor_id)
    .maybeSingle();

  // Determine if within 48h → auto-confirm
  const startDate = new Date(startAt);
  const hoursUntilAppt = (startDate.getTime() - Date.now()) / (1000 * 60 * 60);
  const autoConfirmed = hoursUntilAppt < 48;
  const appointmentStatus = autoConfirmed ? "confirmed" : "scheduled";

  // Create appointment, scoped to the assigned office.
  const { data: appointment, error: apptError } = await supabase
    .from("appointments")
    .insert({
      doctor_id: session.doctor_id,
      office_id: session.office_id,
      patient_id: session.patient_id,
      start_at: startAt,
      end_at: endAt,
      status: appointmentStatus,
      symptoms: session.symptoms,
      created_from_session_id: session.id,
    })
    .select("id")
    .single();

  if (apptError || !appointment) {
    return new Response(
      JSON.stringify({ error: "Error al crear la cita", details: apptError?.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Create calendar event (Google or Outlook)
  let googleEventId: string | null = null;
  let outlookEventId: string | null = null;

  if (office.google_calendar_connected && office.google_refresh_token_ref && office.google_calendar_id) {
    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: office.google_refresh_token_ref,
          grant_type: "refresh_token",
        }),
      });

      const tokenData = await tokenRes.json();
      if (tokenRes.ok && tokenData.access_token) {
        const calendarId = encodeURIComponent(office.google_calendar_id);
        const eventBody = {
          summary: `Cita: ${patient?.full_name ?? "Paciente"}`,
          description: session.symptoms ? `Síntomas: ${session.symptoms}` : undefined,
          start: { dateTime: startAt, timeZone: "America/Mexico_City" },
          end: { dateTime: endAt, timeZone: "America/Mexico_City" },
        };

        const createRes = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${tokenData.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(eventBody),
          }
        );

        const eventData = await createRes.json();
        if (createRes.ok && eventData.id) {
          googleEventId = eventData.id;
          await supabase
            .from("appointments")
            .update({ google_event_id: googleEventId })
            .eq("id", appointment.id);
        }
      }
    } catch (err) {
      console.error("Error creating Google Calendar event:", err);
    }
  } else if (office.outlook_calendar_connected && office.outlook_refresh_token_ref && office.outlook_calendar_id && OUTLOOK_CLIENT_ID) {
    try {
      const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: OUTLOOK_CLIENT_ID,
          client_secret: OUTLOOK_CLIENT_SECRET,
          refresh_token: office.outlook_refresh_token_ref,
          grant_type: "refresh_token",
          scope: "offline_access Calendars.ReadWrite",
        }),
      });

      const tokenData = await tokenRes.json();
      if (tokenRes.ok && tokenData.access_token) {
        const calendarId = encodeURIComponent(office.outlook_calendar_id);
        const eventBody = {
          subject: `Cita: ${patient?.full_name ?? "Paciente"}`,
          body: session.symptoms ? { contentType: "Text", content: `Síntomas: ${session.symptoms}` } : undefined,
          start: { dateTime: startAt, timeZone: "America/Mexico_City" },
          end: { dateTime: endAt, timeZone: "America/Mexico_City" },
        };

        const createRes = await fetch(
          `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${tokenData.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(eventBody),
          }
        );

        const eventData = await createRes.json();
        if (createRes.ok && eventData.id) {
          outlookEventId = eventData.id;
          await supabase
            .from("appointments")
            .update({ outlook_event_id: outlookEventId })
            .eq("id", appointment.id);
        }
      }
    } catch (err) {
      console.error("Error creating Outlook Calendar event:", err);
    }
  }

  // Mark session as used
  await supabase
    .from("reservation_sessions")
    .update({ used_at: new Date().toISOString() })
    .eq("id", session.id);

  // Insert notification for doctor
  const formattedDate = startAt.split("T")[0];
  const formattedTime = slot_start;
  await supabase.from("notifications").insert({
    doctor_id: session.doctor_id,
    appointment_id: appointment.id,
    recipient_role: "doctor",
    type: "appointment_scheduled",
    title: "Nueva cita agendada",
    body: `${patient?.full_name ?? "Paciente"} - ${formattedDate} ${formattedTime}`,
  });

  // Generate manage token (expires when appointment ends).
  const { token: manageToken, manageUrl } = await createManageToken({
    supabase,
    appointmentId: appointment.id,
    expiresAt: endAt,
    patientPhone: patient?.phone ?? "",
  });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  // Dispatch webhooks (fire-and-forget)
  try {
    await Promise.all([
      fetch(`${supabaseUrl}/functions/v1/dispatch-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          event_type: "appointment.created",
          payload: {
            appointment_id: appointment.id,
            patient_name: patient?.full_name,
            patient_phone: patient?.phone,
            doctor_name: doctor?.full_name,
            office_id: office.id,
            office_name: office.name,
            office_address: office.address,
            start_at: startAt,
            end_at: endAt,
            symptoms: session.symptoms,
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
            office_id: office.id,
            office_name: office.name,
            office_address: office.address,
            previous_status: null,
            new_status: appointmentStatus,
            start_at: startAt,
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
    JSON.stringify({
      success: true,
      appointment_id: appointment.id,
      manage_url: manageUrl,
      manage_token: manageToken,
      doctor_name: doctor?.full_name ?? "Doctor",
      start_at: startAt,
      end_at: endAt,
      auto_confirmed: autoConfirmed,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
