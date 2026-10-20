import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createManageToken } from "../_shared/manage-token.ts";
import { getGoogleAccessToken, getOutlookAccessToken } from "../_shared/calendar-tokens.ts";
import { checkAvailability } from "../_shared/availability-check.ts";
import { validateSlotAvailable } from "../_shared/slot-validation.ts";
import { formatMxLongDateTime, isValidLocalDate, isValidLocalTime, msToMxIso, mxLocalToMs } from "../_shared/mx-time.ts";
import { getServiceKey } from "../_shared/supabase-keys.ts";
import { externalTimeout } from "../_shared/http-timeout.ts";
import { attendedName } from "../_shared/patient-identity.ts";
import { createWhaapyClient } from "../_shared/whaapy-client.ts";
import { scheduleWhaapyContactSync } from "../_shared/whaapy-contact-sync.ts";

const whaapy = createWhaapyClient();

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
  if (!isValidLocalDate(date) || !isValidLocalTime(slot_start)) {
    return new Response(JSON.stringify({ error: "Fecha u hora inválida" }), {
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

  // Get session — includes office_id chosen at triage time so the appointment
  // and the external calendar event both go to the right place.
  const { data: session, error: sessionError } = await supabase
    .from("reservation_sessions")
    .select("id, doctor_id, office_id, patient_id, patient_name, symptoms, used_at, expires_at")
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
    .select("id, name, address, appointment_duration_minutes, is_active, is_deleted, google_refresh_token_ref, google_calendar_id, google_calendar_connected, outlook_refresh_token_ref, outlook_calendar_id, outlook_calendar_connected")
    .eq("id", session.office_id)
    .maybeSingle();

  if (!office) {
    return new Response(JSON.stringify({ error: "Consultorio no encontrado" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // A link created before the office was deleted/deactivated (or the doctor
  // left) must not book there: deleted offices can keep weekly availability
  // rows, so checkAvailability alone would let it through.
  const { data: doctorState } = await supabase
    .from("doctors")
    .select("is_active, is_deleted")
    .eq("id", session.doctor_id)
    .maybeSingle();
  if (!office.is_active || office.is_deleted || doctorState?.is_active === false || doctorState?.is_deleted === true) {
    return json(410, { error: "Este consultorio ya no recibe citas. Escríbenos por WhatsApp y te ayudamos a encontrar otra opción." });
  }

  const durationMinutes = office.appointment_duration_minutes ?? 30;

  // CDMX wall clock -> absolute instants (handles end times past midnight).
  const startMs = mxLocalToMs(date, slot_start);
  const endMs = startMs + durationMinutes * 60 * 1000;
  const startAt = msToMxIso(startMs);
  const endAt = msToMxIso(endMs);

  // Defense in depth: the slot list shown to the patient is advisory. The
  // slot is re-validated here because another patient (or the doctor) may
  // have taken it since, and because this endpoint is public by token.
  if (startMs < Date.now()) return json(409, { error: SLOT_TAKEN });

  const { data: override } = await supabase
    .from("doctor_date_overrides")
    .select("is_available")
    .eq("doctor_id", session.doctor_id)
    .eq("override_date", date)
    .maybeSingle();
  if (override && !override.is_available) return json(409, { error: SLOT_TAKEN });

  const availability = await checkAvailability(supabase, session.office_id, startAt, endAt);
  if (!availability.withinAvailability) return json(409, { error: SLOT_TAKEN });

  const slotCheck = await validateSlotAvailable({
    supabase,
    doctorId: session.doctor_id,
    officeId: session.office_id,
    startAt,
    endAt,
  });
  if (!slotCheck.available) return json(409, { error: SLOT_TAKEN });

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

  // Who is attended: the name given when the link was created (can be a
  // relative of the phone's titular), else the titular (garantía 20-oct-2026).
  const attended = attendedName(session.patient_name, patient?.full_name) ?? "Paciente";

  // Determine if within 48h → auto-confirm
  const startDate = new Date(startAt);
  const hoursUntilAppt = (startDate.getTime() - Date.now()) / (1000 * 60 * 60);
  const autoConfirmed = hoursUntilAppt < 48;
  const appointmentStatus = autoConfirmed ? "confirmed" : "scheduled";

  // Claim the session atomically BEFORE inserting, so a double-click or two
  // tabs can't create two appointments from one link (used_at was previously
  // only set after the insert, without a conditional).
  const { data: claimed } = await supabase
    .from("reservation_sessions")
    .update({ used_at: new Date().toISOString() })
    .eq("id", session.id)
    .is("used_at", null)
    .select("id")
    .maybeSingle();
  if (!claimed) return json(410, { error: "Este enlace ya fue utilizado" });

  // Create appointment, scoped to the assigned office.
  const { data: appointment, error: apptError } = await supabase
    .from("appointments")
    .insert({
      doctor_id: session.doctor_id,
      office_id: session.office_id,
      patient_id: session.patient_id,
      patient_name: attendedName(session.patient_name, patient?.full_name),
      start_at: startAt,
      end_at: endAt,
      status: appointmentStatus,
      symptoms: session.symptoms,
      created_from_session_id: session.id,
    })
    .select("id")
    .single();

  if (apptError || !appointment) {
    // Release the claim so the patient can retry with another slot.
    await supabase.from("reservation_sessions").update({ used_at: null }).eq("id", session.id);
    // 23P01 = exclusion constraint (appointments_no_overlap_per_doctor): lost
    // the race against a concurrent booking. Don't leak DB details publicly.
    if (apptError?.code === "23P01") return json(409, { error: SLOT_TAKEN });
    console.error("[reserve-create] insert failed:", apptError);
    return json(500, { error: "Error al crear la cita" });
  }

  // Create calendar event (Google or Outlook)
  let googleEventId: string | null = null;
  let outlookEventId: string | null = null;

  if (office.google_calendar_connected && office.google_calendar_id) {
    try {
      const accessToken = await getGoogleAccessToken({ supabase, office });
      if (accessToken) {
        const calendarId = encodeURIComponent(office.google_calendar_id);
        const eventBody = {
          summary: `Cita: ${attended}`,
          description: session.symptoms ? `Síntomas: ${session.symptoms}` : undefined,
          start: { dateTime: startAt, timeZone: "America/Mexico_City" },
          end: { dateTime: endAt, timeZone: "America/Mexico_City" },
        };

        const createRes = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
          {
            signal: externalTimeout(),
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
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
  } else if (office.outlook_calendar_connected && office.outlook_calendar_id) {
    try {
      const accessToken = await getOutlookAccessToken({ supabase, office });
      if (accessToken) {
        const calendarId = encodeURIComponent(office.outlook_calendar_id);
        const eventBody = {
          subject: `Cita: ${attended}`,
          body: session.symptoms ? { contentType: "Text", content: `Síntomas: ${session.symptoms}` } : undefined,
          start: { dateTime: startAt, timeZone: "America/Mexico_City" },
          end: { dateTime: endAt, timeZone: "America/Mexico_City" },
        };

        const createRes = await fetch(
          `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events`,
          {
            signal: externalTimeout(),
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
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

  // Insert notification for doctor
  await supabase.from("notifications").insert({
    doctor_id: session.doctor_id,
    appointment_id: appointment.id,
    recipient_role: "doctor",
    type: "appointment_scheduled",
    title: "Nueva cita agendada",
    body: `${attended} - ${formatMxLongDateTime(startAt)}`,
  });

  // Generate manage token (expires when appointment ends).
  const { token: manageToken, manageUrl } = await createManageToken({
    supabase,
    appointmentId: appointment.id,
    expiresAt: endAt,
    patientPhone: patient?.phone ?? "",
  });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = getServiceKey();

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
            patient_name: attended,
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
            patient_name: attended,
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

  // Project the patient's data into the WHAAPY contact (best-effort, in the
  // background: never delays or fails the booking).
  await scheduleWhaapyContactSync(supabase, whaapy, { patientId: session.patient_id, phone: patient?.phone ?? null });

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
