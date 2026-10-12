import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkAvailability } from "../_shared/availability-check.ts";
import { validateSlotAvailable } from "../_shared/slot-validation.ts";
import { getGoogleAccessToken, getOutlookAccessToken } from "../_shared/calendar-tokens.ts";
import { getServiceKey } from "../_shared/supabase-keys.ts";
import { isValidLocalDate, isValidLocalTime, msToMxIso, mxLocalToMs } from "../_shared/mx-time.ts";

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
    getServiceKey()
  );

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
  const json = (status: number, payload: unknown) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  const SLOT_TAKEN = "Ese horario ya no está disponible. Por favor elige otro.";
  if (!isValidLocalDate(date) || !isValidLocalTime(slot_start)) {
    return json(400, { error: "Fecha u hora inválida" });
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

  // A completed consultation (or one whose time already passed) can't be
  // rescheduled from the patient link; cancelled ones can (the /gestionar
  // page offers "reagendar" after a cancellation on purpose).
  if (oldAppt.status === "completed") {
    return json(409, { error: "Esta consulta ya fue realizada y no se puede reagendar." });
  }
  if (oldAppt.status !== "cancelled" && new Date(oldAppt.start_at).getTime() < Date.now()) {
    return json(409, { error: "Esta cita ya pasó y no se puede reagendar." });
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

  // CDMX wall clock -> absolute instants (handles end times past midnight).
  const startMs = mxLocalToMs(date, slot_start);
  const endMs = startMs + durationMinutes * 60 * 1000;
  const startAt = msToMxIso(startMs);
  const endAt = msToMxIso(endMs);
  if (startMs < Date.now()) return json(409, { error: SLOT_TAKEN });

  // Hard-block: patients can't reschedule outside the office's configured
  // availability, onto a blocked day, or onto a slot that is already taken
  // (other appointments or the doctor's external calendar). reserve-slots
  // already filters, but this endpoint is public by token.
  if (oldAppt.office_id) {
    const { data: override } = await supabase
      .from("doctor_date_overrides")
      .select("is_available")
      .eq("doctor_id", oldAppt.doctor_id)
      .eq("override_date", date)
      .maybeSingle();
    if (override && !override.is_available) return json(409, { error: SLOT_TAKEN });

    const av = await checkAvailability(supabase, oldAppt.office_id, startAt, endAt);
    if (!av.withinAvailability) {
      return json(409, { error: "Este horario no está disponible en el consultorio." });
    }
    const slotCheck = await validateSlotAvailable({
      supabase,
      doctorId: oldAppt.doctor_id,
      officeId: oldAppt.office_id,
      startAt,
      endAt,
      excludeAppointmentId: oldAppt.id,
    });
    if (!slotCheck.available) return json(409, { error: SLOT_TAKEN });
  }

  // Determine if within 48h → auto-confirm
  const hoursUntilAppt = (startMs - Date.now()) / (1000 * 60 * 60);
  const autoConfirmed = hoursUntilAppt < 48;
  const newStatus = autoConfirmed ? "confirmed" : "scheduled";

  // 1. Create the NEW appointment first. Previously the old one was cancelled
  // (and its calendar events deleted) before the insert, so an insert failure
  // left the patient with nothing. If this fails, nothing has changed yet.
  // The DB exclusion constraint also guarantees no overlap even under races.
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
    if (apptError?.code === "23P01") return json(409, { error: SLOT_TAKEN });
    console.error("[manage-reschedule] insert failed:", apptError);
    return json(500, { error: "Error al crear la nueva cita" });
  }

  // 2. Cancel old appointment + delete calendar events if not already cancelled.
  // Shared helper handles refresh token rotation (Microsoft) and auto-disconnects
  // the office when the refresh token is permanently invalid (invalid_grant).
  const tokenArgs = office ? { supabase, office } : null;
  const googleAccessToken = tokenArgs ? await getGoogleAccessToken(tokenArgs) : null;
  const outlookAccessToken = tokenArgs ? await getOutlookAccessToken(tokenArgs) : null;

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

    const { error: cancelErr } = await supabase
      .from("appointments")
      .update({ status: "cancelled", cancel_reason: "patient" })
      .eq("id", oldAppt.id);
    if (cancelErr) console.error("[manage-reschedule] cancel old failed:", cancelErr);
  }

  // 3. Create new calendar event (Google or Outlook)
  let newGoogleEventId: string | null = null;
  let newOutlookEventId: string | null = null;

  // Re-attempt token refresh for create step; the office row may have been
  // updated by the rotation persistence above.
  const gcToken =
    googleAccessToken ?? (tokenArgs ? await getGoogleAccessToken(tokenArgs) : null);
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

  const olToken =
    outlookAccessToken ?? (tokenArgs ? await getOutlookAccessToken(tokenArgs) : null);
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

  // 4. Repoint the manage token to the new appointment and extend its expiry
  // to the new end time (it used to keep the OLD end time, so links died
  // early after rescheduling to a later date).
  await supabase
    .from("appointment_manage_tokens")
    .update({ appointment_id: newAppt.id, expires_at: endAt })
    .eq("id", manageToken.id);

  // 5. Insert notifications for doctor
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
  const serviceKey = getServiceKey();
  // The token string comes from the request (`token`); the row was selected
  // without it, so `manageToken.token` used to be undefined in the URL.
  const manageUrl = `${Deno.env.get("APP_URL") || "https://findmed.lovable.app"}/gestionar?token=${token}`;

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
            appointment_id: newAppt.id,
            patient_phone: manageToken.patient_phone ?? null,
            patient_name: patient?.full_name ?? null,
            previous_status: oldAppt.status,
            new_status: newStatus,
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
