// Cron-driven EF: marks confirmed appointments as `completed` once their
// `end_at` has passed. Emits `appointment.completed` + `appointment.status_changed`.
// Scheduled at */15 * * * * via pg_cron.
//
// Why only `confirmed` and not `scheduled`: a `scheduled` appointment whose
// time passed without confirmation is the territory of `auto-cancel-unconfirmed`
// — different cron, different outcome. Mixing them here would lose that
// distinction in the data.

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

  const { data: appointments, error } = await supabase
    .from("appointments")
    .select(`
      id, start_at, end_at, doctor_id, office_id, patient_id,
      doctors(full_name),
      doctor_offices(name),
      patients(full_name, phone)
    `)
    .eq("status", "confirmed")
    .lt("end_at", now.toISOString());

  if (error) {
    console.error("[auto-complete] fetch failed:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!appointments || appointments.length === 0) {
    return new Response(
      JSON.stringify({ success: true, completed: 0 }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const baseUrl = Deno.env.get("APP_URL") || "https://findmed.lovable.app";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  let completed = 0;

  for (const appt of appointments) {
    const patient = appt.patients as { full_name: string; phone: string } | null;
    const doctor = appt.doctors as { full_name: string } | null;
    const office = appt.doctor_offices as { name: string } | null;

    const { error: completeErr } = await supabase
      .from("appointments")
      .update({ status: "completed" })
      .eq("id", appt.id);

    if (completeErr) {
      console.error(`[auto-complete] failed to mark ${appt.id} as completed:`, completeErr);
      continue;
    }

    // Reuse existing manage token if any. If none exists, create one with a
    // 7-day window so post-consultation flows (feedback, encuestas) have a
    // working link — the appointment's own end_at has already passed.
    let manageUrl: string;
    const { data: existingToken } = await supabase
      .from("appointment_manage_tokens")
      .select("token")
      .eq("appointment_id", appt.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingToken?.token) {
      manageUrl = `${baseUrl}/gestionar?token=${existingToken.token}`;
    } else {
      try {
        const result = await createManageToken({
          supabase,
          appointmentId: appt.id,
          expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          patientPhone: patient?.phone ?? "",
        });
        manageUrl = result.manageUrl;
      } catch (err) {
        console.error(`[auto-complete] manage token create failed for ${appt.id}:`, err);
        manageUrl = "";
      }
    }

    try {
      await Promise.all([
        fetch(`${supabaseUrl}/functions/v1/dispatch-webhook`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            event_type: "appointment.completed",
            payload: {
              appointment_id: appt.id,
              patient_name: patient?.full_name ?? null,
              patient_phone: patient?.phone ?? null,
              doctor_id: appt.doctor_id,
              doctor_name: doctor?.full_name ?? null,
              office_id: appt.office_id,
              office_name: office?.name ?? null,
              start_at: appt.start_at,
              end_at: appt.end_at,
              completed_at: now.toISOString(),
              manage_url: manageUrl,
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
              patient_name: patient?.full_name ?? null,
              patient_phone: patient?.phone ?? null,
              doctor_id: appt.doctor_id,
              previous_status: "confirmed",
              new_status: "completed",
              start_at: appt.start_at,
              end_at: appt.end_at,
              timestamp: now.toISOString(),
              manage_url: manageUrl,
            },
          }),
        }),
      ]);
    } catch (e) {
      console.error(`[auto-complete] dispatch-webhook failed for ${appt.id}:`, e);
    }

    completed++;
  }

  return new Response(
    JSON.stringify({ success: true, completed }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
