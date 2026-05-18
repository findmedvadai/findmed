// Admin cancel. Sets status='cancelled', cancel_reason='admin', and best-effort
// deletes the linked Google/Outlook events. External delete failures are
// tolerated — the row state in the DB is what matters.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { getGoogleAccessToken, getOutlookAccessToken } from "../_shared/calendar-tokens.ts";
import { getOrCreateManageUrl } from "../_shared/manage-token.ts";

interface Body {
  appointment_id: string;
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
  const { appointment_id } = body;
  if (!appointment_id) return jsonResponse({ error: "appointment_id requerido" }, 400);

  const { data: appointment } = await supabase
    .from("appointments")
    .select("id, doctor_id, office_id, patient_id, status, start_at, end_at, google_event_id, outlook_event_id")
    .eq("id", appointment_id)
    .maybeSingle();

  if (!appointment) return jsonResponse({ error: "Cita no encontrada" }, 404);
  if (appointment.status === "cancelled") {
    return jsonResponse({ error: "La cita ya está cancelada" }, 409);
  }

  const previousStatus = appointment.status;

  const { error: updateErr } = await supabase
    .from("appointments")
    .update({ status: "cancelled", cancel_reason: "admin" })
    .eq("id", appointment_id);
  if (updateErr) {
    return jsonResponse({ error: "No se pudo cancelar", details: updateErr.message }, 500);
  }

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

  // Delete external events (best-effort).
  if (appointment.google_event_id && office?.google_calendar_connected && office.google_calendar_id) {
    const accessToken = await getGoogleAccessToken({ supabase, office });
    if (accessToken) {
      try {
        await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(office.google_calendar_id)}/events/${appointment.google_event_id}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
        );
      } catch (err) {
        console.error("[admin-cancel] Google delete failed:", err);
      }
    }
  }

  if (appointment.outlook_event_id && office?.outlook_calendar_connected && office.outlook_calendar_id) {
    const accessToken = await getOutlookAccessToken({ supabase, office });
    if (accessToken) {
      try {
        await fetch(
          `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(office.outlook_calendar_id)}/events/${encodeURIComponent(appointment.outlook_event_id)}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
        );
      } catch (err) {
        console.error("[admin-cancel] Outlook delete failed:", err);
      }
    }
  }

  // Notify the doctor's inbox.
  await supabase.from("notifications").insert({
    doctor_id: appointment.doctor_id,
    appointment_id,
    recipient_role: "doctor",
    type: "appointment_cancelled_by_admin",
    title: "Cita cancelada por admin",
    body: `${patient?.full_name ?? "Paciente"} - ${appointment.start_at}`,
  });

  // WhatsApp dispatch — both doctor and patient.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const dispatchHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${serviceKey}`,
  };

  const manageUrl = await getOrCreateManageUrl({
    supabase,
    appointmentId: appointment_id,
    endAt: appointment.end_at,
    patientPhone: patient?.phone ?? "",
  }).catch(() => null);

  try {
    await Promise.all([
      fetch(`${supabaseUrl}/functions/v1/dispatch-webhook`, {
        method: "POST",
        headers: dispatchHeaders,
        body: JSON.stringify({
          event_type: "appointment.cancelled_by_admin",
          payload: {
            appointment_id,
            source: "admin",
            previous_status: previousStatus,
            cancel_reason: "admin",
            patient_name: patient?.full_name ?? null,
            patient_phone: patient?.phone ?? null,
            doctor_name: doctor?.full_name ?? null,
            doctor_id: appointment.doctor_id,
            office_id: appointment.office_id,
            office_name: office?.name ?? null,
            office_address: office?.address ?? null,
            start_at: appointment.start_at,
            end_at: appointment.end_at,
            notify_patient: true,
            notify_doctor: true,
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
            appointment_id,
            previous_status: previousStatus,
            new_status: "cancelled",
            cancel_reason: "admin",
            patient_phone: patient?.phone ?? null,
            patient_name: patient?.full_name ?? null,
            start_at: appointment.start_at,
            timestamp: new Date().toISOString(),
            manage_url: manageUrl,
          },
        }),
      }),
    ]);
  } catch (err) {
    console.error("[admin-cancel] dispatch-webhook failed:", err);
  }

  return jsonResponse({ success: true, appointment_id });
});
