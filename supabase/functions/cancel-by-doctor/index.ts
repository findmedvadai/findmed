import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createManageToken } from "../_shared/manage-token.ts";
import { deleteAppointmentEvents } from "../_shared/calendar-sync.ts";
import { getServiceKey, getPublishableKey } from "../_shared/supabase-keys.ts";
import { formatMxLongDateTime } from "../_shared/mx-time.ts";
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

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Authenticate doctor via JWT
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    getServiceKey()
  );

  // Verify token and get user
  const token = authHeader.replace("Bearer ", "");
  const anonSupabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    getPublishableKey(),
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: claimsData, error: claimsError } = await anonSupabase.auth.getClaims(token);
  if (claimsError || !claimsData?.claims) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = claimsData.claims.sub;

  // Get doctor_id for user
  const { data: userRow } = await supabase
    .from("users")
    .select("doctor_id")
    .eq("id", userId)
    .maybeSingle();

  if (!userRow?.doctor_id) {
    return new Response(JSON.stringify({ error: "No es doctor" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const doctorId = userRow.doctor_id;

  let body: { appointment_id: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { appointment_id } = body;
  if (!appointment_id) {
    return new Response(JSON.stringify({ error: "appointment_id requerido" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Get appointment — verify it belongs to the doctor.
  const { data: appointment } = await supabase
    .from("appointments")
    .select("id, status, doctor_id, office_id, patient_id, patient_name, start_at, end_at, google_event_id, outlook_event_id")
    .eq("id", appointment_id)
    .eq("doctor_id", doctorId)
    .maybeSingle();

  if (!appointment) {
    return new Response(JSON.stringify({ error: "Cita no encontrada" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (appointment.status === "cancelled") {
    return new Response(JSON.stringify({ error: "La cita ya fue cancelada" }), {
      status: 409,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // A completed consultation is history: cancelling it would erase that it
  // happened and send the patient a "cancelled" WhatsApp.
  if (appointment.status === "completed") {
    return new Response(JSON.stringify({ error: "La consulta ya se realizó; no se puede cancelar." }), {
      status: 409,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Cancel appointment, guarded on the status we read (a concurrent patient
  // action or cron wins instead of being overwritten).
  const { data: cancelledRow, error: updateError } = await supabase
    .from("appointments")
    .update({ status: "cancelled", cancel_reason: "doctor" })
    .eq("id", appointment_id)
    .eq("status", appointment.status)
    .select("id")
    .maybeSingle();

  if (updateError) {
    return new Response(
      JSON.stringify({ error: "Error al cancelar", details: updateError.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  if (!cancelledRow) {
    return new Response(JSON.stringify({ error: "La cita cambió mientras la cancelabas. Recarga y revisa su estado." }), {
      status: 409,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Get patient info
  const { data: patient } = await supabase
    .from("patients")
    .select("full_name, phone")
    .eq("id", appointment.patient_id)
    .maybeSingle();
  const attended = attendedName(appointment.patient_name, patient?.full_name);

  // Doctor name (display only).
  const { data: doctor } = await supabase
    .from("doctors")
    .select("full_name")
    .eq("id", doctorId)
    .maybeSingle();

  // Delete external calendar events via the shared helper (token rotation,
  // auto-disconnect on invalid_grant, timeouts, per-provider result).
  await deleteAppointmentEvents(supabase, appointment);

  // Generate new manage token for rescheduling (expires when appointment would have ended).
  const { manageUrl: rescheduleUrl } = await createManageToken({
    supabase,
    appointmentId: appointment_id,
    expiresAt: appointment.end_at,
    patientPhone: patient?.phone ?? "",
  });

  // Insert notification for doctor
  await supabase.from("notifications").insert({
    doctor_id: doctorId,
    appointment_id: appointment_id,
    recipient_role: "doctor",
    type: "appointment_cancelled_by_doctor",
    title: "Cita cancelada",
    body: `Cancelaste la cita de ${attended ?? "Paciente"} del ${formatMxLongDateTime(appointment.start_at ?? "")}`,
  });

  // Dispatch webhooks (fire-and-forget)
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = getServiceKey();
  const dispatchHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${serviceKey}`,
  };

  try {
    await Promise.all([
      fetch(`${supabaseUrl}/functions/v1/dispatch-webhook`, {
        method: "POST",
        headers: dispatchHeaders,
        body: JSON.stringify({
          event_type: "appointment.cancelled_by_doctor",
          payload: {
            appointment_id: appointment_id,
            patient_phone: patient?.phone ?? null,
            patient_name: attended,
            doctor_name: doctor?.full_name ?? null,
            start_at: appointment.start_at,
            cancel_reason: "doctor",
            message: "Tu cita fue cancelada por el doctor",
            manage_url: rescheduleUrl,
          },
        }),
      }),
      fetch(`${supabaseUrl}/functions/v1/dispatch-webhook`, {
        method: "POST",
        headers: dispatchHeaders,
        body: JSON.stringify({
          event_type: "appointment.status_changed",
          payload: {
            appointment_id: appointment_id,
            patient_phone: patient?.phone ?? null,
            patient_name: attended,
            previous_status: appointment.status,
            new_status: "cancelled",
            start_at: appointment.start_at,
            timestamp: new Date().toISOString(),
            manage_url: rescheduleUrl,
          },
        }),
      }),
    ]);
  } catch (e) {
    console.error("Error dispatching webhooks:", e);
  }

  return new Response(
    JSON.stringify({ success: true, manage_url: rescheduleUrl }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
