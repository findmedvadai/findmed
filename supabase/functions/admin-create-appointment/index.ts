// Admin-side appointment creation. Resilient pattern: the appointment is the
// source of truth — if external calendar (Google/Outlook) sync fails, we still
// keep the appointment and return a warning to the admin so they can retry the
// external sync manually.
//
// Inputs (all required unless noted):
//   doctor_id: uuid of an active doctor
//   start_at:  ISO 8601 (with offset) — already in CDMX-equivalent UTC instant
//   end_at:    ISO 8601 (with offset)
//   patient: { full_name, phone }
//   symptoms?: free text → appointments.symptoms
//   notify_patient_whatsapp?: boolean (default false)
//
// On success returns { appointment_id, patient_id, sync_warnings: string[] }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { validateSlotAvailable } from "../_shared/slot-validation.ts";
import { checkAvailability } from "../_shared/availability-check.ts";
import { getGoogleAccessToken, getOutlookAccessToken } from "../_shared/calendar-tokens.ts";
import { normalizeMxPhone, mxPhoneLookupVariants } from "../_shared/phone.ts";
import { createManageToken } from "../_shared/manage-token.ts";

interface CreateBody {
  doctor_id: string;
  office_id: string;
  start_at: string;
  end_at: string;
  patient: { full_name: string; phone: string };
  symptoms?: string;
  notify_patient_whatsapp?: boolean;
  /**
   * When true, skip the availability soft-check. Set by the frontend after
   * the user confirms an "outside availability" warning dialog.
   */
  force_outside_availability?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const auth = await requireAdmin(req, supabase);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

  let body: CreateBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const {
    doctor_id,
    office_id,
    start_at,
    end_at,
    patient,
    symptoms,
    notify_patient_whatsapp,
    force_outside_availability,
  } = body;
  if (!doctor_id || !office_id || !start_at || !end_at || !patient?.full_name?.trim() || !patient?.phone?.trim()) {
    return jsonResponse(
      { error: "doctor_id, office_id, start_at, end_at, patient.full_name y patient.phone son requeridos" },
      400
    );
  }

  // Block past slots.
  if (new Date(start_at) < new Date()) {
    return jsonResponse({ error: "No se puede agendar en el pasado" }, 400);
  }

  // Verify doctor.
  const { data: doctor } = await supabase
    .from("doctors")
    .select("id, full_name, is_active, is_deleted")
    .eq("id", doctor_id)
    .maybeSingle();
  if (!doctor || !doctor.is_active || doctor.is_deleted) {
    return jsonResponse({ error: "Doctor no encontrado o inactivo" }, 404);
  }

  // Verify office belongs to that doctor and is active. Calendar tokens come
  // from the office, NOT the doctor (legacy doctors fields are deprecated).
  const { data: office } = await supabase
    .from("doctor_offices")
    .select(
      "id, doctor_id, name, address, is_active, is_deleted, " +
        "google_calendar_connected, google_refresh_token_ref, google_calendar_id, " +
        "outlook_calendar_connected, outlook_refresh_token_ref, outlook_calendar_id"
    )
    .eq("id", office_id)
    .eq("doctor_id", doctor_id)
    .maybeSingle();
  if (!office || !office.is_active || office.is_deleted) {
    return jsonResponse({ error: "Consultorio no encontrado o inactivo" }, 404);
  }

  // Availability soft-check — outside the office's configured weekly schedule
  // we surface a warning to the caller so they can decide. The frontend asks
  // the user "¿Crear de todas formas?" and re-issues with `force_outside_availability=true`.
  if (!force_outside_availability) {
    const av = await checkAvailability(supabase, office_id, start_at, end_at);
    if (!av.withinAvailability) {
      return jsonResponse(
        {
          error: "outside_availability",
          weekday: av.weekday,
          blocks: av.blocksForWeekday,
          office_name: office.name,
        },
        409
      );
    }
  }

  // Slot availability — scoped to the office.
  const validation = await validateSlotAvailable({
    supabase,
    doctorId: doctor_id,
    officeId: office_id,
    startAt: start_at,
    endAt: end_at,
  });
  if (!validation.available) {
    return jsonResponse({ error: "slot_conflict", conflicts: validation.conflicts }, 409);
  }

  // Match-or-create patient. We canonicalize the input phone but look up by
  // BOTH `+52XXXXXXXXXX` and `+521XXXXXXXXXX` since legacy rows may carry the
  // Telcel `1`. If anything matches, we reuse the existing patient_id; only
  // when no variant matches do we insert a new row.
  const normalizedPhone = normalizeMxPhone(patient.phone);
  const lookupVariants = mxPhoneLookupVariants(normalizedPhone);
  const fullName = patient.full_name.trim();

  let patientId: string;
  const { data: matchedPatients } = await supabase
    .from("patients")
    .select("id, full_name, phone")
    .in("phone", lookupVariants)
    .order("created_at", { ascending: true })
    .limit(1);
  const existingPatient = matchedPatients?.[0];

  if (existingPatient) {
    patientId = existingPatient.id;
    if (fullName && fullName !== existingPatient.full_name) {
      await supabase.from("patients").update({ full_name: fullName }).eq("id", patientId);
    }
  } else {
    const { data: newPatient, error: insertErr } = await supabase
      .from("patients")
      .insert({ full_name: fullName, phone: normalizedPhone })
      .select("id")
      .single();
    if (insertErr || !newPatient) {
      console.error("[admin-create-appointment] patient insert failed:", insertErr);
      return jsonResponse({ error: "No se pudo crear el paciente" }, 500);
    }
    patientId = newPatient.id;
  }

  // Create appointment (status = confirmed, source = admin_manual).
  const { data: appointment, error: apptErr } = await supabase
    .from("appointments")
    .insert({
      doctor_id,
      office_id,
      patient_id: patientId,
      start_at,
      end_at,
      status: "confirmed",
      symptoms: symptoms?.trim() || null,
      booking_source: "admin_manual",
      created_by_user_id: auth.userId,
    })
    .select("id")
    .single();

  if (apptErr || !appointment) {
    console.error("[admin-create-appointment] appointment insert failed:", apptErr);
    return jsonResponse({ error: "No se pudo crear la cita", details: apptErr?.message }, 500);
  }

  const appointmentId = appointment.id;
  const syncWarnings: string[] = [];

  // External calendar sync: best-effort. Failures don't roll back the appointment.
  if (office.google_calendar_connected && office.google_calendar_id) {
    const accessToken = await getGoogleAccessToken({ supabase, office });
    if (!accessToken) {
      syncWarnings.push("google");
    } else {
      try {
        const calendarId = encodeURIComponent(office.google_calendar_id);
        const eventBody = {
          summary: `Cita: ${fullName}`,
          description: symptoms?.trim() ? `Síntomas: ${symptoms.trim()}` : undefined,
          start: { dateTime: start_at, timeZone: "America/Mexico_City" },
          end: { dateTime: end_at, timeZone: "America/Mexico_City" },
        };
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
              .eq("id", appointmentId);
          } else {
            syncWarnings.push("google");
          }
        } else {
          syncWarnings.push("google");
        }
      } catch (err) {
        console.error("[admin-create-appointment] Google create failed:", err);
        syncWarnings.push("google");
      }
    }
  }

  if (office.outlook_calendar_connected && office.outlook_calendar_id) {
    const accessToken = await getOutlookAccessToken({ supabase, office });
    if (!accessToken) {
      syncWarnings.push("outlook");
    } else {
      try {
        const calendarId = encodeURIComponent(office.outlook_calendar_id);
        const eventBody = {
          subject: `Cita: ${fullName}`,
          body: symptoms?.trim() ? { contentType: "Text", content: `Síntomas: ${symptoms.trim()}` } : undefined,
          start: { dateTime: start_at, timeZone: "America/Mexico_City" },
          end: { dateTime: end_at, timeZone: "America/Mexico_City" },
        };
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
              .eq("id", appointmentId);
          } else {
            syncWarnings.push("outlook");
          }
        } else {
          syncWarnings.push("outlook");
        }
      } catch (err) {
        console.error("[admin-create-appointment] Outlook create failed:", err);
        syncWarnings.push("outlook");
      }
    }
  }

  // Notification for the doctor's inbox.
  await supabase.from("notifications").insert({
    doctor_id,
    appointment_id: appointmentId,
    recipient_role: "doctor",
    type: "appointment_scheduled",
    title: "Nueva cita (creada por admin)",
    body: `${fullName} - ${start_at}`,
  });

  // Generate the patient's manage token. Without this the n8n WhatsApp flow
  // can't render the confirmation template, since it needs the /gestionar URL
  // to let the patient cancel/reschedule later. Same convention as
  // reserve-create: the token expires when the appointment ends.
  let manageToken: string | null = null;
  let manageUrl: string | null = null;
  try {
    const result = await createManageToken({
      supabase,
      appointmentId,
      expiresAt: end_at,
      patientPhone: normalizedPhone,
    });
    manageToken = result.token;
    manageUrl = result.manageUrl;
  } catch (err) {
    // Don't fail the whole request — the appointment exists and the n8n flow
    // can still generate a token via generate-manage-link if needed.
    console.error("[admin-create-appointment] manage_token insert failed:", err);
  }

  // WhatsApp dispatch — always to the doctor, optionally to the patient.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const dispatchHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${serviceKey}`,
  };

  // Two webhooks in parallel:
  //   1. `appointment.created` — feature-specific event (kept for any consumer
  //      already listening to it).
  //   2. `appointment.status_changed` — the event the n8n WhatsApp flow is
  //      actually subscribed to. Same shape as the one fired by
  //      admin-cancel-appointment so the same n8n branch logic works.
  try {
    await Promise.all([
      fetch(`${supabaseUrl}/functions/v1/dispatch-webhook`, {
        method: "POST",
        headers: dispatchHeaders,
        body: JSON.stringify({
          event_type: "appointment.created",
          payload: {
            appointment_id: appointmentId,
            source: "admin_manual",
            notify_patient: !!notify_patient_whatsapp,
            patient_name: fullName,
            patient_phone: normalizedPhone,
            doctor_name: doctor.full_name,
            doctor_id,
            office_id,
            office_name: office.name,
            office_address: office.address,
            start_at,
            end_at,
            symptoms: symptoms?.trim() || null,
            manage_token: manageToken,
            manage_url: manageUrl,
          },
        }),
      }),
      fetch(`${supabaseUrl}/functions/v1/dispatch-webhook`, {
        method: "POST",
        headers: dispatchHeaders,
        body: JSON.stringify({
          event_type: "appointment.status_changed",
          payload: {
            appointment_id: appointmentId,
            source: "admin_manual",
            previous_status: null,
            new_status: "confirmed",
            patient_phone: normalizedPhone,
            patient_name: fullName,
            doctor_name: doctor.full_name,
            doctor_id,
            office_id,
            office_name: office.name,
            office_address: office.address,
            start_at,
            end_at,
            notify_patient: !!notify_patient_whatsapp,
            notify_doctor: true,
            manage_token: manageToken,
            manage_url: manageUrl,
            timestamp: new Date().toISOString(),
          },
        }),
      }),
    ]);
  } catch (err) {
    console.error("[admin-create-appointment] dispatch-webhook failed:", err);
  }

  return jsonResponse({
    success: true,
    appointment_id: appointmentId,
    patient_id: patientId,
    sync_warnings: syncWarnings,
  });
});
