// Doctor-side appointment reschedule. Same resilient pattern as admin-reschedule-appointment.
//
// Auth: the caller must be either an admin OR the specific doctor who owns the appointment.
// The doctor_id is resolved from the appointment, not from the body.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAdminOrDoctor } from "../_shared/auth.ts";
import { validateSlotAvailable } from "../_shared/slot-validation.ts";
import { checkAvailability } from "../_shared/availability-check.ts";
import { getGoogleAccessToken, getOutlookAccessToken } from "../_shared/calendar-tokens.ts";

interface Body {
  appointment_id: string;
  start_at: string;
  end_at: string;
  force_outside_availability?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { appointment_id, start_at, end_at, force_outside_availability } = body;
  if (!appointment_id || !start_at || !end_at) {
    return jsonResponse({ error: "appointment_id, start_at y end_at son requeridos" }, 400);
  }

  // Block past slots.
  if (new Date(start_at) < new Date()) {
    return jsonResponse({ error: "No se puede reagendar en el pasado" }, 400);
  }

  // Load appointment to determine the owning doctor.
  const { data: appointment } = await supabase
    .from("appointments")
    .select("id, doctor_id, office_id, patient_id, status, start_at, end_at, symptoms, google_event_id, outlook_event_id")
    .eq("id", appointment_id)
    .maybeSingle();

  if (!appointment) return jsonResponse({ error: "Cita no encontrada" }, 404);
  if (appointment.status === "cancelled") {
    return jsonResponse({ error: "No se puede reagendar una cita cancelada" }, 409);
  }

  // Auth: admin or the doctor who owns this appointment.
  const auth = await requireAdminOrDoctor(req, supabase, appointment.doctor_id);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

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

  // Slot conflict check (excluding the current appointment).
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

  const { error: updateErr } = await supabase
    .from("appointments")
    .update({ start_at, end_at })
    .eq("id", appointment_id);

  if (updateErr) {
    return jsonResponse({ error: "No se pudo reagendar la cita", details: updateErr.message }, 500);
  }

  // Resolve doctor, office, patient for notifications + calendar sync.
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

  // Google calendar sync.
  if (office?.google_calendar_connected && office.google_calendar_id) {
    const accessToken = await getGoogleAccessToken(office);
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
            await supabase
              .from("appointments")
              .update({ google_event_id: null })
              .eq("id", appointment_id);
            appointment.google_event_id = null;
          }
        } catch (err) {
          console.error("[doctor-reschedule] Google PATCH failed:", err);
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
          console.error("[doctor-reschedule] Google CREATE failed:", err);
        }
      }
      if (!synced) syncWarnings.push("google");
    }
  }

  // Outlook calendar sync.
  if (office?.outlook_calendar_connected && office.outlook_calendar_id) {
    const accessToken = await getOutlookAccessToken(office);
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
          console.error("[doctor-reschedule] Outlook PATCH failed:", err);
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
          console.error("[doctor-reschedule] Outlook CREATE failed:", err);
        }
      }
      if (!synced) syncWarnings.push("outlook");
    }
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const dispatchHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${serviceKey}`,
  };

  const currentStatus = appointment.status;
  try {
    await Promise.all([
      fetch(`${supabaseUrl}/functions/v1/dispatch-webhook`, {
        method: "POST",
        headers: dispatchHeaders,
        body: JSON.stringify({
          event_type: "appointment.rescheduled",
          payload: {
            appointment_id,
            source: "doctor_manual",
            previous_start_at: previousStartAt,
            new_start_at: start_at,
            end_at,
            patient_name: patient?.full_name ?? null,
            patient_phone: patient?.phone ?? null,
            doctor_name: doctor?.full_name ?? null,
            doctor_id: appointment.doctor_id,
            office_id: appointment.office_id,
            office_name: office?.name ?? null,
            office_address: office?.address ?? null,
            notify_patient: true,
            notify_doctor: false,
          },
        }),
      }),
      fetch(`${supabaseUrl}/functions/v1/dispatch-webhook`, {
        method: "POST",
        headers: dispatchHeaders,
        body: JSON.stringify({
          event_type: "appointment.status_changed",
          payload: {
            appointment_id,
            source: "doctor_manual",
            previous_status: currentStatus,
            new_status: currentStatus,
            previous_start_at: previousStartAt,
            new_start_at: start_at,
            start_at,
            end_at,
            patient_phone: patient?.phone ?? null,
            patient_name: patient?.full_name ?? null,
            doctor_name: doctor?.full_name ?? null,
            doctor_id: appointment.doctor_id,
            notify_patient: true,
            notify_doctor: false,
            timestamp: new Date().toISOString(),
          },
        }),
      }),
    ]);
  } catch (err) {
    console.error("[doctor-reschedule] dispatch-webhook failed:", err);
  }

  return jsonResponse({ success: true, appointment_id, sync_warnings: syncWarnings });
});
