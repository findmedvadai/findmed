// Delete (soft) a doctor's office. If the office has any future, non-cancelled
// appointments, we cancel them automatically — same flow as admin-cancel /
// cancel-by-doctor: mark the row, delete the external calendar event when
// possible, dispatch the WhatsApp webhook so n8n can notify the patient and
// the doctor. The cancel_reason is `admin` when an admin triggers the delete
// or `doctor` when the office's owning doctor does it.
//
// Body:
//   office_id: uuid (required)
//   confirm: boolean (required true; UI must show the count first via
//     ?dry_run=1)
//
// Response when `dry_run=1`: { affected_count, future_appointments: [...] }.
// Response on real delete: { success: true, cancelled: N }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAdminOrDoctor } from "../_shared/auth.ts";
import { getGoogleAccessToken, getOutlookAccessToken } from "../_shared/calendar-tokens.ts";
import { getOrCreateManageUrl } from "../_shared/manage-token.ts";

interface Body {
  office_id: string;
  confirm?: boolean;
  dry_run?: boolean;
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
  if (!body.office_id) return jsonResponse({ error: "office_id requerido" }, 400);

  const { data: office } = await supabase
    .from("doctor_offices")
    .select(
      "id, doctor_id, name, is_deleted, " +
        "google_calendar_connected, google_refresh_token_ref, google_calendar_id, " +
        "outlook_calendar_connected, outlook_refresh_token_ref, outlook_calendar_id"
    )
    .eq("id", body.office_id)
    .maybeSingle();
  if (!office) return jsonResponse({ error: "Consultorio no encontrado" }, 404);
  if (office.is_deleted) return jsonResponse({ error: "Ya está borrado" }, 409);

  const auth = await requireAdminOrDoctor(req, supabase, office.doctor_id);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);
  const cancelReason: "admin" | "doctor" = auth.isAdmin ? "admin" : "doctor";

  // Future, non-cancelled appointments at this office.
  const nowIso = new Date().toISOString();
  const { data: futureAppts } = await supabase
    .from("appointments")
    .select(
      "id, doctor_id, patient_id, start_at, end_at, status, google_event_id, outlook_event_id"
    )
    .eq("office_id", body.office_id)
    .in("status", ["scheduled", "confirmed"])
    .gte("start_at", nowIso);

  const affected = futureAppts ?? [];

  if (body.dry_run) {
    return jsonResponse({
      affected_count: affected.length,
      future_appointments: affected.map((a) => ({
        id: a.id,
        start_at: a.start_at,
        status: a.status,
      })),
    });
  }

  if (!body.confirm) {
    return jsonResponse(
      { error: "confirm=true requerido cuando hay citas activas. Llama con dry_run=true primero para ver el conteo." },
      400
    );
  }

  // Cancel each appointment.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const dispatchHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${serviceKey}`,
  };

  let cancelled = 0;
  for (const appt of affected) {
    // 1. Mark cancelled.
    const { error: updErr } = await supabase
      .from("appointments")
      .update({ status: "cancelled", cancel_reason: cancelReason })
      .eq("id", appt.id);
    if (updErr) {
      console.error(`[doctor-office-delete] failed to cancel appt ${appt.id}:`, updErr);
      continue;
    }

    // 2. Delete external calendar event (best-effort).
    if (appt.google_event_id && office.google_calendar_connected && office.google_calendar_id) {
      const accessToken = await getGoogleAccessToken({ supabase, office });
      if (accessToken) {
        try {
          await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(office.google_calendar_id)}/events/${appt.google_event_id}`,
            { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
          );
        } catch (err) {
          console.error("Google delete failed:", err);
        }
      }
    }
    if (appt.outlook_event_id && office.outlook_calendar_connected && office.outlook_calendar_id) {
      const accessToken = await getOutlookAccessToken({ supabase, office });
      if (accessToken) {
        try {
          await fetch(
            `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(office.outlook_calendar_id)}/events/${encodeURIComponent(appt.outlook_event_id)}`,
            { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
          );
        } catch (err) {
          console.error("Outlook delete failed:", err);
        }
      }
    }

    // 3. Patient + doctor info for the webhook.
    const [{ data: patient }, { data: doctor }] = await Promise.all([
      supabase.from("patients").select("full_name, phone").eq("id", appt.patient_id).maybeSingle(),
      supabase.from("doctors").select("full_name").eq("id", appt.doctor_id).maybeSingle(),
    ]);

    const manageUrl = await getOrCreateManageUrl({
      supabase,
      appointmentId: appt.id,
      endAt: appt.end_at,
      patientPhone: patient?.phone ?? "",
    }).catch(() => null);

    // 4. Inbox notification + outbound webhook so n8n can WhatsApp.
    const eventType =
      cancelReason === "admin" ? "appointment.cancelled_by_admin" : "appointment.cancelled_by_doctor";
    const notifType =
      cancelReason === "admin" ? "appointment_cancelled_by_admin" : "appointment_cancelled_by_doctor";

    await supabase.from("notifications").insert({
      doctor_id: appt.doctor_id,
      appointment_id: appt.id,
      recipient_role: "doctor",
      type: notifType,
      title: "Cita cancelada (consultorio borrado)",
      body: `Se canceló la cita de ${patient?.full_name ?? "Paciente"} por borrado del consultorio "${office.name}".`,
    });

    try {
      await Promise.all([
        fetch(`${supabaseUrl}/functions/v1/dispatch-webhook`, {
          method: "POST",
          headers: dispatchHeaders,
          body: JSON.stringify({
            event_type: eventType,
            payload: {
              appointment_id: appt.id,
              source: cancelReason,
              cancel_reason: cancelReason,
              cancel_context: "office_deleted",
              patient_name: patient?.full_name ?? null,
              patient_phone: patient?.phone ?? null,
              doctor_name: doctor?.full_name ?? null,
              doctor_id: appt.doctor_id,
              office_id: body.office_id,
              office_name: office.name,
              start_at: appt.start_at,
              end_at: appt.end_at,
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
              appointment_id: appt.id,
              previous_status: appt.status,
              new_status: "cancelled",
              cancel_reason: cancelReason,
              cancel_context: "office_deleted",
              patient_phone: patient?.phone ?? null,
              patient_name: patient?.full_name ?? null,
              doctor_id: appt.doctor_id,
              office_id: body.office_id,
              office_name: office.name,
              start_at: appt.start_at,
              timestamp: new Date().toISOString(),
              manage_url: manageUrl,
            },
          }),
        }),
      ]);
    } catch (err) {
      console.error("dispatch-webhook failed:", err);
    }

    cancelled++;
  }

  // 5. Clean up orphan rows that reference this office.
  //    - doctor_weekly_availability: cascade FK exists but only fires on hard
  //      DELETE; we're soft-deleting, so we clean explicitly.
  //    - reservation_sessions: open triage links for this office are now stale;
  //      delete so patients can't land on a booking flow for a gone office.
  await Promise.all([
    supabase.from("doctor_weekly_availability").delete().eq("office_id", body.office_id),
    supabase.from("reservation_sessions").delete().eq("office_id", body.office_id),
  ]);

  // 6. Soft-delete the office. is_active=false too so the partial unique
  // index releases the (doctor_id, zone_id) slot for re-use.
  const { error: deleteErr } = await supabase
    .from("doctor_offices")
    .update({ is_deleted: true, is_active: false })
    .eq("id", body.office_id);
  if (deleteErr) {
    return jsonResponse({ error: "No se pudo borrar el consultorio", details: deleteErr.message }, 500);
  }

  return jsonResponse({ success: true, cancelled });
});
