import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createManageToken } from "../_shared/manage-token.ts";
import { isServiceRequest } from "../_shared/service-auth.ts";
import { getServiceKey } from "../_shared/supabase-keys.ts";
import { formatMxLongDateTime } from "../_shared/mx-time.ts";
import { deleteAppointmentEvents } from "../_shared/calendar-sync.ts";
import { attendedName } from "../_shared/patient-identity.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Cron-only: pg_cron calls this with the service key stored in Vault.
  // Without this check anyone could re-trigger patient WhatsApp messages.
  if (!isServiceRequest(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    getServiceKey()
  );

  const now = new Date();

  // Get all scheduled appointments that haven't happened yet
  const { data: appointments, error } = await supabase
    .from("appointments")
    .select(`
      id, start_at, end_at, doctor_id, patient_id, patient_name, office_id, google_event_id, outlook_event_id,
      doctors(full_name),
      patients(full_name, phone)
    `)
    .eq("status", "scheduled")
    .gt("start_at", now.toISOString());

  if (error) {
    console.error("Error fetching appointments:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!appointments || appointments.length === 0) {
    return new Response(
      JSON.stringify({ success: true, cancelled: 0 }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = getServiceKey();

  let cancelled = 0;

  for (const appt of appointments) {
    const patient = appt.patients as unknown as { full_name: string; phone: string } | null;
    const attended = attendedName(appt.patient_name, patient?.full_name);
    const doctor = appt.doctors as unknown as { full_name: string } | null;

    // Query settings separately since there's no FK between appointments and doctor_schedule_settings
    const { data: settings } = await supabase
      .from("doctor_schedule_settings")
      .select("min_confirm_hours_before")
      .eq("doctor_id", appt.doctor_id)
      .maybeSingle();

    const minHours = settings?.min_confirm_hours_before ?? 24;
    const deadline = new Date(new Date(appt.start_at).getTime() - minHours * 60 * 60 * 1000);

    // If we're past the deadline, auto-cancel
    if (now >= deadline) {
      // Guard on the previous status: a patient who confirmed between our
      // select and this update must NOT be cancelled. Zero rows = someone
      // else transitioned it first; skip silently.
      const { data: cancelledRow, error: cancelError } = await supabase
        .from("appointments")
        .update({ status: "cancelled", cancel_reason: "no_confirmation" })
        .eq("id", appt.id)
        .eq("status", "scheduled")
        .select("id")
        .maybeSingle();

      if (cancelError) {
        console.error(`Error cancelling appointment ${appt.id}:`, cancelError);
        continue;
      }
      if (!cancelledRow) continue;

      // Remove the event from the doctor's Google/Outlook calendar, like every
      // other cancel path. It used to stay there: the doctor saw a consultation
      // that no longer existed and the slot kept looking busy.
      try {
        await deleteAppointmentEvents(supabase, appt);
      } catch (err) {
        console.error(`[auto-cancel] calendar cleanup failed for ${appt.id}:`, err);
      }

      // Insert doctor notification
      await supabase.from("notifications").insert({
        doctor_id: appt.doctor_id,
        appointment_id: appt.id,
        recipient_role: "doctor",
        type: "appointment_auto_cancelled",
        title: "Cita auto-cancelada",
        body: `${attended ?? "Paciente"} no confirmó a tiempo. La cita del ${formatMxLongDateTime(appt.start_at ?? "")} fue cancelada.`,
      });

      // Generate reschedule token. Auto-cancellation gives the patient 24h to
      // act on the link, regardless of when the original appointment was —
      // hence the +24h expiry instead of the appointment's `end_at`.
      // A failure here must not abort the run: the appointments after this one
      // would stay un-cancelled and this one would lose its patient message.
      let rescheduleUrl: string | null = null;
      try {
        ({ manageUrl: rescheduleUrl } = await createManageToken({
          supabase,
          appointmentId: appt.id,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
          patientPhone: patient?.phone ?? "",
        }));
      } catch (err) {
        console.error(`[auto-cancel] manage token failed for ${appt.id}:`, err);
      }

      // Dispatch webhooks
      try {
        await Promise.all([
          fetch(`${supabaseUrl}/functions/v1/dispatch-webhook`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({
              event_type: "appointment.auto_cancelled",
              payload: {
                appointment_id: appt.id,
                patient_phone: patient?.phone ?? null,
                patient_name: attended,
                doctor_name: doctor?.full_name ?? null,
                start_at: appt.start_at,
                cancel_reason: "no_confirmation",
                message: "Tu cita fue cancelada automáticamente porque no fue confirmada a tiempo",
                manage_url: rescheduleUrl,
              },
            }),
            signal: AbortSignal.timeout(10_000),
          }),
          fetch(`${supabaseUrl}/functions/v1/dispatch-webhook`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({
              event_type: "appointment.status_changed",
              payload: {
                appointment_id: appt.id,
                patient_phone: patient?.phone ?? null,
                patient_name: attended,
                previous_status: "scheduled",
                new_status: "cancelled",
                start_at: appt.start_at,
                timestamp: now.toISOString(),
                manage_url: rescheduleUrl,
              },
            }),
            signal: AbortSignal.timeout(10_000),
          }),
        ]);
      } catch (e) {
        console.error(`Error dispatching webhooks for appointment ${appt.id}:`, e);
      }

      cancelled++;
    }
  }

  return new Response(
    JSON.stringify({ success: true, cancelled }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
