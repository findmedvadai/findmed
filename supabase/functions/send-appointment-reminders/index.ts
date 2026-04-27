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
  // Window: appointments starting between 47h and 49h from now
  const windowStart = new Date(now.getTime() + 47 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(now.getTime() + 49 * 60 * 60 * 1000).toISOString();

  // Pull office info too — its address now replaces the doctor's, and its
  // name goes into the WhatsApp template as an additive field.
  const { data: appointments, error } = await supabase
    .from("appointments")
    .select(`
      id, start_at, end_at, doctor_id, office_id, patient_id,
      doctors(full_name),
      doctor_offices(name, address),
      patients(full_name, phone)
    `)
    .eq("status", "scheduled")
    .gte("start_at", windowStart)
    .lte("start_at", windowEnd);

  if (error) {
    console.error("Error fetching appointments:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!appointments || appointments.length === 0) {
    return new Response(
      JSON.stringify({ success: true, processed: 0, message: "No appointments in window" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const baseUrl = Deno.env.get("APP_URL") || "https://findmed.lovable.app";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  let processed = 0;

  for (const appt of appointments) {
    const patient = appt.patients as { full_name: string; phone: string } | null;
    const doctor = appt.doctors as { full_name: string } | null;
    const office = appt.doctor_offices as { name: string; address: string | null } | null;

    // Check for existing valid manage token
    const { data: existingToken } = await supabase
      .from("appointment_manage_tokens")
      .select("token, expires_at")
      .eq("appointment_id", appt.id)
      .gt("expires_at", now.toISOString())
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let manageToken: string;
    let manageUrl: string;
    if (existingToken) {
      manageToken = existingToken.token;
      manageUrl = `${baseUrl}/gestionar?token=${manageToken}`;
    } else {
      // Generate new token (expires when appointment ends).
      const result = await createManageToken({
        supabase,
        appointmentId: appt.id,
        expiresAt: appt.end_at,
        patientPhone: patient?.phone ?? "",
      });
      manageToken = result.token;
      manageUrl = result.manageUrl;
    }

    // Fetch doctor's min_confirm_hours_before
    const { data: settings } = await supabase
      .from("doctor_schedule_settings")
      .select("min_confirm_hours_before")
      .eq("doctor_id", appt.doctor_id)
      .maybeSingle();

    const minConfirmHours = settings?.min_confirm_hours_before ?? 24;

    try {
      await fetch(`${supabaseUrl}/functions/v1/dispatch-webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          event_type: "appointment.reminder_48h",
          payload: {
            appointment_id: appt.id,
            patient_phone: patient?.phone ?? null,
            patient_name: patient?.full_name ?? null,
            doctor_name: doctor?.full_name ?? null,
            // doctor_address is preserved for backward compat but is now
            // sourced from the office, since the doctor's column is deprecated.
            doctor_address: office?.address ?? null,
            office_id: appt.office_id,
            office_name: office?.name ?? null,
            office_address: office?.address ?? null,
            start_at: appt.start_at,
            manage_url: manageUrl,
            min_confirm_hours_before: minConfirmHours,
            message: "Tu cita es en 48 horas. Puedes confirmar, cancelar o reagendar desde el link.",
          },
        }),
      });
      processed++;
    } catch (e) {
      console.error(`Error dispatching reminder for appointment ${appt.id}:`, e);
    }
  }

  return new Response(
    JSON.stringify({ success: true, processed }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
