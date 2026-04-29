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

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const now = new Date();

  // Get all scheduled appointments that haven't happened yet
  const { data: appointments, error } = await supabase
    .from("appointments")
    .select(`
      id, start_at, end_at, doctor_id, patient_id,
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
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  let cancelled = 0;

  for (const appt of appointments) {
    const patient = appt.patients as { full_name: string; phone: string } | null;
    const doctor = appt.doctors as { full_name: string } | null;

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
      const { error: cancelError } = await supabase
        .from("appointments")
        .update({ status: "cancelled", cancel_reason: "no_confirmation" })
        .eq("id", appt.id);

      if (cancelError) {
        console.error(`Error cancelling appointment ${appt.id}:`, cancelError);
        continue;
      }

      // Insert doctor notification
      await supabase.from("notifications").insert({
        doctor_id: appt.doctor_id,
        appointment_id: appt.id,
        recipient_role: "doctor",
        type: "appointment_auto_cancelled",
        title: "Cita auto-cancelada",
        body: `${patient?.full_name ?? "Paciente"} no confirmó a tiempo. La cita del ${appt.start_at?.split("T")[0] ?? ""} fue cancelada.`,
      });

      // Generate reschedule token. Auto-cancellation gives the patient 24h to
      // act on the link, regardless of when the original appointment was —
      // hence the +24h expiry instead of the appointment's `end_at`.
      const { manageUrl: rescheduleUrl } = await createManageToken({
        supabase,
        appointmentId: appt.id,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        patientPhone: patient?.phone ?? "",
      });

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
                patient_name: patient?.full_name ?? null,
                doctor_name: doctor?.full_name ?? null,
                start_at: appt.start_at,
                cancel_reason: "no_confirmation",
                message: "Tu cita fue cancelada automáticamente porque no fue confirmada a tiempo",
                manage_url: rescheduleUrl,
                reschedule_url: rescheduleUrl,
              },
            }),
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
                patient_name: patient?.full_name ?? null,
                previous_status: "scheduled",
                new_status: "cancelled",
                start_at: appt.start_at,
                timestamp: now.toISOString(),
                manage_url: rescheduleUrl,
              },
            }),
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
