import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function normalizePhone(raw: string): string {
  let digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) return `+52${digits}`;
  if (digits.length === 12 && digits.startsWith("52")) return `+${digits}`;
  return `+${digits}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // --- API Key validation (same pattern as triage-webhook) ---
  const authHeader = req.headers.get("Authorization") ?? "";
  const rawKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!rawKey.startsWith("fm_")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const encoded = new TextEncoder().encode(rawKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const keyHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const { data: apiKey } = await supabase
    .from("api_keys")
    .select("id")
    .eq("key_hash", keyHash)
    .eq("is_active", true)
    .maybeSingle();

  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Update last_used_at
  supabase.from("api_keys").update({ last_used_at: new Date().toISOString() } as any).eq("id", apiKey.id).then(() => {});

  // --- Parse body ---
  let body: { appointment_id?: string; patient_phone?: string; action: "confirm" | "cancel" };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { action, appointment_id, patient_phone } = body;

  if (!action || !["confirm", "cancel"].includes(action)) {
    return new Response(JSON.stringify({ error: "action must be 'confirm' or 'cancel'" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!appointment_id && !patient_phone) {
    return new Response(JSON.stringify({ error: "Provide appointment_id or patient_phone" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // --- Find the appointment ---
  let appointmentQuery = supabase
    .from("appointments")
    .select("id, status, doctor_id, patient_id, start_at, end_at, patients(full_name, phone), doctors(full_name)")
    .in("status", ["scheduled", "confirmed"])
    .order("start_at", { ascending: true })
    .limit(1);

  if (appointment_id) {
    appointmentQuery = appointmentQuery.eq("id", appointment_id);
  } else if (patient_phone) {
    const phone = normalizePhone(patient_phone);
    // Find patient first
    const { data: patient } = await supabase
      .from("patients")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();

    if (!patient) {
      return new Response(JSON.stringify({ error: "Patient not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    appointmentQuery = appointmentQuery.eq("patient_id", patient.id);
  }

  const { data: appointments, error: queryError } = await appointmentQuery;

  if (queryError || !appointments || appointments.length === 0) {
    return new Response(JSON.stringify({ error: "No active appointment found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const appointment = appointments[0] as any;
  const previousStatus = appointment.status;

  // --- Validate action coherence ---
  if (action === "confirm" && appointment.status === "confirmed") {
    return new Response(JSON.stringify({ error: "Appointment is already confirmed" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (action === "cancel" && appointment.status === "cancelled") {
    return new Response(JSON.stringify({ error: "Appointment is already cancelled" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // --- Execute action ---
  const newStatus = action === "confirm" ? "confirmed" : "cancelled";
  const updateData: any = { status: newStatus };
  if (action === "cancel") {
    updateData.cancel_reason = "patient";
  }

  const { error: updateError } = await supabase
    .from("appointments")
    .update(updateData)
    .eq("id", appointment.id);

  if (updateError) {
    console.error("Update error:", updateError);
    return new Response(JSON.stringify({ error: "Failed to update appointment" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // --- Create notification ---
  const patientName = appointment.patients?.full_name ?? "Paciente";
  const doctorName = appointment.doctors?.full_name ?? "Doctor";
  const notifType = action === "confirm"
    ? "appointment_scheduled" // reuse for confirmed via WhatsApp
    : "appointment_cancelled_by_patient";

  const notifTitle = action === "confirm"
    ? `Cita confirmada — ${patientName}`
    : `Cita cancelada — ${patientName}`;

  const notifBody = action === "confirm"
    ? `${patientName} confirmó su cita con ${doctorName} vía WhatsApp.`
    : `${patientName} canceló su cita con ${doctorName} vía WhatsApp.`;

  // Notification for admin
  await supabase.from("notifications").insert({
    title: notifTitle,
    body: notifBody,
    type: notifType,
    recipient_role: "admin",
    doctor_id: appointment.doctor_id,
    appointment_id: appointment.id,
  });

  // Notification for doctor
  await supabase.from("notifications").insert({
    title: notifTitle,
    body: notifBody,
    type: notifType,
    recipient_role: "doctor",
    doctor_id: appointment.doctor_id,
    appointment_id: appointment.id,
  });

  // --- Dispatch webhooks ---
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const webhookPayload = {
    appointment_id: appointment.id,
    doctor_id: appointment.doctor_id,
    patient_name: patientName,
    patient_phone: appointment.patients?.phone ?? patient_phone,
    start_at: appointment.start_at,
    end_at: appointment.end_at,
    previous_status: previousStatus,
    new_status: newStatus,
  };

  // Dispatch specific event
  const specificEvent = action === "confirm" ? "appointment.confirmed" : "appointment.cancelled";
  fetch(`${SUPABASE_URL}/functions/v1/dispatch-webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ event_type: specificEvent, payload: webhookPayload }),
  }).catch((e) => console.error("Dispatch specific webhook error:", e));

  // Dispatch status_changed event
  fetch(`${SUPABASE_URL}/functions/v1/dispatch-webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ event_type: "appointment.status_changed", payload: webhookPayload }),
  }).catch((e) => console.error("Dispatch status_changed webhook error:", e));

  return new Response(
    JSON.stringify({
      success: true,
      appointment_id: appointment.id,
      new_status: newStatus,
      previous_status: previousStatus,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
