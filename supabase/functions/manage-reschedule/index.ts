import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkAvailability } from "../_shared/availability-check.ts";

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

  let body: { token: string; slot_start: string; date: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { token, slot_start, date } = body;
  if (!token || !slot_start || !date) {
    return new Response(JSON.stringify({ error: "token, slot_start y date requeridos" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Validate manage token
  const { data: manageToken } = await supabase
    .from("appointment_manage_tokens")
    .select("id, appointment_id, expires_at, patient_phone")
    .eq("token", token)
    .maybeSingle();

  if (!manageToken) {
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

  // Get current appointment, including its office_id so we keep the
  // reschedule on the same office.
  const { data: oldAppt } = await supabase
    .from("appointments")
    .select("id, doctor_id, office_id, patient_id, symptoms, google_event_id, outlook_event_id, status, start_at")
    .eq("id", manageToken.appointment_id)
    .maybeSingle();

  if (!oldAppt) {
    return new Response(JSON.stringify({ error: "Cita no encontrada" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Doctor display name only — calendar and duration come from the office.
  const { data: doctor } = await supabase
    .from("doctors")
    .select("full_name")
    .eq("id", oldAppt.doctor_id)
    .maybeSingle();

  // Office: source of truth for calendars + duration.
  const { data: office } = await supabase
    .from("doctor_offices")
    .select(
      "id, name, address, appointment_duration_minutes, " +
        "google_refresh_token_ref, google_calendar_id, google_calendar_connected, " +
        "outlook_refresh_token_ref, outlook_calendar_id, outlook_calendar_connected"
    )
    .eq("id", oldAppt.office_id)
    .maybeSingle();

  const { data: patient } = await supabase
    .from("patients")
    .select("full_name")
    .eq("id", oldAppt.patient_id)
    .maybeSingle();

  const durationMinutes = office?.appointment_duration_minutes ?? 30;

  // Calculate new times with explicit Mexico City offset (-06:00)
  const startAt = `${date}T${slot_start}:00-06:00`;
  const slotParts = slot_start.split(":").map(Number);
  const totalMinutes = slotParts[0] * 60 + slotParts[1] + durationMinutes;
  const endHH = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const endMM = String(totalMinutes % 60).padStart(2, "0");
  const endAt = `${date}T${endHH}:${endMM}:00-06:00`;

  // Hard-block: patients can't reschedule outside the office's configured
  // availability. The reserve-slots endpoint already filters slots, so this
  // is defensive against direct API misuse.
  if (oldAppt.office_id) {
    const av = await checkAvailability(supabase, oldAppt.office_id, startAt, endAt);
    if (!av.withinAvailability) {
      return new Response(
        JSON.stringify({ error: "Este horario no está disponible en el consultorio." }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // Helper to get Google access token
  const getGoogleAccessToken = async (): Promise<string | null> => {
    if (!office?.google_calendar_connected || !office.google_refresh_token_ref) return null;
    try {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: office.google_refresh_token_ref,
          grant_type: "refresh_token",
        }),
      });
      const data = await res.json();
      return res.ok ? data.access_token : null;
    } catch {
      return null;
    }
  };

  // Helper to get Outlook access token
  const OUTLOOK_CLIENT_ID = Deno.env.get("OUTLOOK_CLIENT_ID") || "";
  const OUTLOOK_CLIENT_SECRET = Deno.env.get("OUTLOOK_CLIENT_SECRET") || "";
  const getOutlookAccessToken = async (): Promise<string | null> => {
    if (!office?.outlook_calendar_connected || !office.outlook_refresh_token_ref || !OUTLOOK_CLIENT_ID) return null;
    try {
      const res = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
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
      const data = await res.json();
      return res.ok ? data.access_token : null;
    } catch {
      return null;
    }
  };

  // 1. Cancel old appointment + delete calendar events if not already cancelled
  const googleAccessToken = await getGoogleAccessToken();
  const outlookAccessToken = await getOutlookAccessToken();

  if (oldAppt.status !== "cancelled") {
    // Delete old Google event
    if (googleAccessToken && oldAppt.google_event_id && office?.google_calendar_id) {
      const calendarId = encodeURIComponent(office.google_calendar_id);
      try {
        await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${oldAppt.google_event_id}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${googleAccessToken}` } }
        );
      } catch (err) {
        console.error("Error deleting old Google event:", err);
      }
    }

    // Delete old Outlook event
    if (outlookAccessToken && oldAppt.outlook_event_id && office?.outlook_calendar_id) {
      const calendarId = encodeURIComponent(office.outlook_calendar_id);
      try {
        await fetch(
          `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events/${encodeURIComponent(oldAppt.outlook_event_id)}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${outlookAccessToken}` } }
        );
      } catch (err) {
        console.error("Error deleting old Outlook event:", err);
      }
    }

    await supabase
      .from("appointments")
      .update({ status: "cancelled", cancel_reason: "patient" })
      .eq("id", oldAppt.id);
  }

  // 2. Determine if within 48h → auto-confirm
  const newStartDate = new Date(startAt);
  const hoursUntilAppt = (newStartDate.getTime() - Date.now()) / (1000 * 60 * 60);
  const autoConfirmed = hoursUntilAppt < 48;
  const newStatus = autoConfirmed ? "confirmed" : "scheduled";

  // 3. Create new appointment, keeping the same office assignment.
  const { data: newAppt, error: apptError } = await supabase
    .from("appointments")
    .insert({
      doctor_id: oldAppt.doctor_id,
      office_id: oldAppt.office_id,
      patient_id: oldAppt.patient_id,
      start_at: startAt,
      end_at: endAt,
      status: newStatus,
      symptoms: oldAppt.symptoms,
    })
    .select("id")
    .single();

  if (apptError || !newAppt) {
    return new Response(
      JSON.stringify({ error: "Error al crear la nueva cita", details: apptError?.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 4. Create new calendar event (Google or Outlook)
  let newGoogleEventId: string | null = null;
  let newOutlookEventId: string | null = null;

  const gcToken = googleAccessToken ?? await getGoogleAccessToken();
  if (gcToken && office?.google_calendar_id) {
    const calendarId = encodeURIComponent(office.google_calendar_id);
    try {
      const eventBody = {
        summary: `Cita: ${patient?.full_name ?? "Paciente"}`,
        description: oldAppt.symptoms ? `Síntomas: ${oldAppt.symptoms}` : undefined,
        start: { dateTime: startAt, timeZone: "America/Mexico_City" },
        end: { dateTime: endAt, timeZone: "America/Mexico_City" },
      };

      const createRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${gcToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(eventBody),
        }
      );

      const eventData = await createRes.json();
      if (createRes.ok && eventData.id) {
        newGoogleEventId = eventData.id;
        await supabase
          .from("appointments")
          .update({ google_event_id: newGoogleEventId })
          .eq("id", newAppt.id);
      }
    } catch (err) {
      console.error("Error creating new Google event:", err);
    }
  }

  const olToken = outlookAccessToken ?? await getOutlookAccessToken();
  if (olToken && office?.outlook_calendar_id) {
    const calendarId = encodeURIComponent(office.outlook_calendar_id);
    try {
      const eventBody = {
        subject: `Cita: ${patient?.full_name ?? "Paciente"}`,
        body: oldAppt.symptoms ? { contentType: "Text", content: `Síntomas: ${oldAppt.symptoms}` } : undefined,
        start: { dateTime: startAt, timeZone: "America/Mexico_City" },
        end: { dateTime: endAt, timeZone: "America/Mexico_City" },
      };

      const createRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${olToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(eventBody),
        }
      );

      const eventData = await createRes.json();
      if (createRes.ok && eventData.id) {
        newOutlookEventId = eventData.id;
        await supabase
          .from("appointments")
          .update({ outlook_event_id: newOutlookEventId })
          .eq("id", newAppt.id);
      }
    } catch (err) {
      console.error("Error creating new Outlook event:", err);
    }
  }

  // 5. Update manage token to point to new appointment
  await supabase
    .from("appointment_manage_tokens")
    .update({ appointment_id: newAppt.id })
    .eq("id", manageToken.id);

  // 6. Insert notifications for doctor
  const rescheduleDate = startAt.split("T")[0];
  await supabase.from("notifications").insert([
    {
      doctor_id: oldAppt.doctor_id,
      appointment_id: oldAppt.id,
      recipient_role: "doctor",
      type: "appointment_cancelled_by_patient",
      title: "Cita reagendada (anterior cancelada)",
      body: `${patient?.full_name ?? "Paciente"} reagendó su cita`,
    },
    {
      doctor_id: oldAppt.doctor_id,
      appointment_id: newAppt.id,
      recipient_role: "doctor",
      type: "appointment_scheduled",
      title: "Nueva cita (reagendada)",
      body: `${patient?.full_name ?? "Paciente"} - ${rescheduleDate} ${slot_start}`,
    },
  ]);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  // Dispatch webhooks (fire-and-forget)
  try {
    await Promise.all([
      fetch(`${supabaseUrl}/functions/v1/dispatch-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          event_type: "appointment.rescheduled",
          payload: {
            old_appointment_id: oldAppt.id,
            new_appointment_id: newAppt.id,
            patient_name: patient?.full_name,
            patient_phone: manageToken.patient_phone ?? null,
            doctor_name: doctor?.full_name,
            new_start_at: startAt,
            old_start_at: oldAppt.start_at ?? null,
            end_at: endAt,
            manage_url: `${Deno.env.get("APP_URL") || "https://findmed.lovable.app"}/gestionar?token=${manageToken.token}`,
          },
        }),
      }),
      fetch(`${supabaseUrl}/functions/v1/dispatch-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          event_type: "appointment.status_changed",
          payload: {
            appointment_id: newAppt.id,
            patient_phone: manageToken.patient_phone ?? null,
            patient_name: patient?.full_name ?? null,
            previous_status: "scheduled",
            new_status: "scheduled",
            start_at: startAt,
            timestamp: new Date().toISOString(),
            manage_url: `${Deno.env.get("APP_URL") || "https://findmed.lovable.app"}/gestionar?token=${token}`,
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
      appointment_id: newAppt.id,
      status: newStatus,
      doctor_name: doctor?.full_name ?? "Doctor",
      patient_name: patient?.full_name ?? "Paciente",
      start_at: startAt,
      end_at: endAt,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
