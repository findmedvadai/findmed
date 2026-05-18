// Admin reschedule. Updates start_at/end_at on the existing appointment row
// (no row replacement, unlike manage-reschedule). External calendar events
// are PATCHed; if the event was deleted out-of-band (404), we recreate it
// and update the *_event_id column. External failures don't roll back the
// reschedule — the appointment row is the source of truth.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { validateSlotAvailable } from "../_shared/slot-validation.ts";
import { checkAvailability } from "../_shared/availability-check.ts";
import { getGoogleAccessToken, getOutlookAccessToken } from "../_shared/calendar-tokens.ts";
import { dispatchStaffRescheduleWebhook } from "../_shared/staff-reschedule-webhook.ts";

interface Body {
  appointment_id: string;
  start_at: string;
  end_at: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const auth = await requireAdmin(req, supabase);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { appointment_id, start_at, end_at, force_outside_availability } = body as {
    appointment_id?: string;
    start_at?: string;
    end_at?: string;
    force_outside_availability?: boolean;
  };
  if (!appointment_id || !start_at || !end_at) {
    return jsonResponse({ error: "appointment_id, start_at y end_at son requeridos" }, 400);
  }

  // Block past slots.
  if (new Date(start_at) < new Date()) {
    return jsonResponse({ error: "No se puede reagendar en el pasado" }, 400);
  }

  const { data: appointment } = await supabase
    .from("appointments")
    .select("id, doctor_id, office_id, patient_id, status, start_at, end_at, symptoms, google_event_id, outlook_event_id")
    .eq("id", appointment_id)
    .maybeSingle();

  if (!appointment) return jsonResponse({ error: "Cita no encontrada" }, 404);
  if (appointment.status === "cancelled") {
    return jsonResponse({ error: "No se puede reagendar una cita cancelada" }, 409);
  }

  // Availability soft-check on the new slot.
  if (!force_outside_availability && appointment.office_id) {
    const av = await checkAvailability(supabase, appointment.office_id, start_at, end_at);
    if (!av.withinAvailability) {
      const { data: officeRow } = await supabase
        .from("doctor_offices")
        .select("name")
        .eq("id", appointment.office_id)
        .maybeSingle();
      return jsonResponse(
        {
          error: "outside_availability",
          weekday: av.weekday,
          blocks: av.blocksForWeekday,
          office_name: officeRow?.name ?? "",
        },
        409
      );
    }
  }

  // Slot availability — scoped to the same office, excluding the moved appt.
  const validation = await validateSlotAvailable({
    supabase,
    doctorId: appointment.doctor_id,
    officeId: appointment.office_id ?? undefined,
    startAt: start_at,
    endAt: end_at,
    excludeAppointmentId: appointment_id,
  });
  if (!validation.available) {
    return jsonResponse({ error: "slot_conflict", conflicts: validation.conflicts }, 409);
  }

  const previousStartAt = appointment.start_at;
  const previousEndAt = appointment.end_at;

  const { error: updateErr } = await supabase
    .from("appointments")
    .update({ start_at, end_at })
    .eq("id", appointment_id);

  if (updateErr) {
    return jsonResponse({ error: "No se pudo reagendar la cita", details: updateErr.message }, 500);
  }

  // External calendar sync — read tokens off the appointment's office.
  const { data: doctor } = await supabase
    .from("doctors")
    .select("full_name")
    .eq("id", appointment.doctor_id)
    .maybeSingle();

  const { data: office } = appointment.office_id
    ? await supabase
        .from("doctor_offices")
        .select(
          "id, name, address, " +
            "google_calendar_connected, google_refresh_token_ref, google_calendar_id, " +
            "outlook_calendar_connected, outlook_refresh_token_ref, outlook_calendar_id"
        )
        .eq("id", appointment.office_id)
        .maybeSingle()
    : { data: null };

  const { data: patient } = await supabase
    .from("patients")
    .select("full_name, phone")
    .eq("id", appointment.patient_id)
    .maybeSingle();

  const syncWarnings: string[] = [];
  const symptomsText = appointment.symptoms?.trim() ?? "";

  // Google
  if (office?.google_calendar_connected && office.google_calendar_id) {
    const accessToken = await getGoogleAccessToken({ supabase, office });
    if (!accessToken) {
      syncWarnings.push("google");
    } else {
      const calendarId = encodeURIComponent(office.google_calendar_id);
      const eventBody = {
        summary: `Cita: ${patient?.full_name ?? "Paciente"}`,
        description: symptomsText ? `Síntomas: ${symptomsText}` : undefined,
        start: { dateTime: start_at, timeZone: "America/Mexico_City" },
        end: { dateTime: end_at, timeZone: "America/Mexico_City" },
      };

      let synced = false;
      if (appointment.google_event_id) {
        try {
          const res = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${appointment.google_event_id}`,
            {
              method: "PATCH",
              headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
              body: JSON.stringify(eventBody),
            }
          );
          if (res.ok) {
            synced = true;
          } else if (res.status === 404 || res.status === 410) {
            // Event gone — clear the stale id and fall through to creation.
            await supabase
              .from("appointments")
              .update({ google_event_id: null })
              .eq("id", appointment_id);
            appointment.google_event_id = null;
          }
        } catch (err) {
          console.error("[admin-reschedule] Google PATCH failed:", err);
        }
      }
      if (!synced && !appointment.google_event_id) {
        try {
          const res = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
            {
              method: "POST",
              headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
              body: JSON.stringify(eventBody),
            }
          );
          if (res.ok) {
            const data = await res.json();
            if (data.id) {
              await supabase
                .from("appointments")
                .update({ google_event_id: data.id })
                .eq("id", appointment_id);
              synced = true;
            }
          }
        } catch (err) {
          console.error("[admin-reschedule] Google CREATE failed:", err);
        }
      }
      if (!synced) syncWarnings.push("google");
    }
  }

  // Outlook
  if (office?.outlook_calendar_connected && office.outlook_calendar_id) {
    const accessToken = await getOutlookAccessToken({ supabase, office });
    if (!accessToken) {
      syncWarnings.push("outlook");
    } else {
      const calendarId = encodeURIComponent(office.outlook_calendar_id);
      const eventBody = {
        subject: `Cita: ${patient?.full_name ?? "Paciente"}`,
        body: symptomsText ? { contentType: "Text", content: `Síntomas: ${symptomsText}` } : undefined,
        start: { dateTime: start_at, timeZone: "America/Mexico_City" },
        end: { dateTime: end_at, timeZone: "America/Mexico_City" },
      };

      let synced = false;
      if (appointment.outlook_event_id) {
        try {
          const res = await fetch(
            `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events/${encodeURIComponent(appointment.outlook_event_id)}`,
            {
              method: "PATCH",
              headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
              body: JSON.stringify(eventBody),
            }
          );
          if (res.ok) {
            synced = true;
          } else if (res.status === 404 || res.status === 410) {
            await supabase
              .from("appointments")
              .update({ outlook_event_id: null })
              .eq("id", appointment_id);
            appointment.outlook_event_id = null;
          }
        } catch (err) {
          console.error("[admin-reschedule] Outlook PATCH failed:", err);
        }
      }
      if (!synced && !appointment.outlook_event_id) {
        try {
          const res = await fetch(
            `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events`,
            {
              method: "POST",
              headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
              body: JSON.stringify(eventBody),
            }
          );
          if (res.ok) {
            const data = await res.json();
            if (data.id) {
              await supabase
                .from("appointments")
                .update({ outlook_event_id: data.id })
                .eq("id", appointment_id);
              synced = true;
            }
          }
        } catch (err) {
          console.error("[admin-reschedule] Outlook CREATE failed:", err);
        }
      }
      if (!synced) syncWarnings.push("outlook");
    }
  }

  // Notification + WhatsApp dispatch.
  await supabase.from("notifications").insert({
    doctor_id: appointment.doctor_id,
    appointment_id,
    recipient_role: "doctor",
    type: "appointment_rescheduled",
    title: "Cita reagendada",
    body: `${patient?.full_name ?? "Paciente"} fue reagendado a ${start_at}`,
  });

  // Single webhook: appointment.rescheduled_by_staff. Status doesn't change
  // on staff reschedule, so we don't emit appointment.status_changed.
  await dispatchStaffRescheduleWebhook({
    supabase,
    appointmentId: appointment_id,
    doctorId: appointment.doctor_id,
    doctorName: doctor?.full_name ?? null,
    patientName: patient?.full_name ?? null,
    patientPhone: patient?.phone ?? null,
    officeId: appointment.office_id,
    officeName: office?.name ?? null,
    officeAddress: office?.address ?? null,
    previousStartAt,
    previousEndAt,
    startAt: start_at,
    endAt: end_at,
    source: "admin",
  });

  return jsonResponse({ success: true, appointment_id, sync_warnings: syncWarnings });
});
