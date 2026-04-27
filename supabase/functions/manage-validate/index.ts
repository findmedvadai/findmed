import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Format a UTC ISO string to local time in the given timezone, returning "HH:MM"
function formatTimeInTimezone(isoString: string, tz: string): string {
  const d = new Date(isoString);
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  }).formatToParts(d);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

// Format a UTC ISO string to a local ISO-like string (without Z) in the given timezone
function toLocalISOString(isoString: string, tz: string): string {
  const d = new Date(isoString);
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: tz,
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}

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

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let body: { token: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { token } = body;
  if (!token) {
    return new Response(JSON.stringify({ error: "Token requerido" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: manageToken, error: tokenError } = await supabase
    .from("appointment_manage_tokens")
    .select("id, appointment_id, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (tokenError || !manageToken) {
    return new Response(JSON.stringify({ error: "Token inválido" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (new Date(manageToken.expires_at) < new Date()) {
    return new Response(JSON.stringify({ error: "Este enlace ha expirado" }), {
      status: 410,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: appointment } = await supabase
    .from("appointments")
    .select("id, start_at, end_at, status, doctor_id, office_id, patient_id, symptoms")
    .eq("id", manageToken.appointment_id)
    .maybeSingle();

  if (!appointment) {
    return new Response(JSON.stringify({ error: "Cita no encontrada" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: doctor } = await supabase
    .from("doctors")
    .select("full_name")
    .eq("id", appointment.doctor_id)
    .maybeSingle();

  // Address now lives on the office. Pull it for the patient-facing page.
  let officeName: string | null = null;
  let officeAddress: string | null = null;
  if (appointment.office_id) {
    const { data: office } = await supabase
      .from("doctor_offices")
      .select("name, address")
      .eq("id", appointment.office_id)
      .maybeSingle();
    officeName = office?.name ?? null;
    officeAddress = office?.address ?? null;
  }

  const { data: settings } = await supabase
    .from("doctor_schedule_settings")
    .select("timezone")
    .eq("doctor_id", appointment.doctor_id)
    .maybeSingle();
  const timezone = settings?.timezone ?? "America/Mexico_City";

  const { data: patient } = await supabase
    .from("patients")
    .select("full_name")
    .eq("id", appointment.patient_id)
    .maybeSingle();

  return new Response(
    JSON.stringify({
      appointment_id: appointment.id,
      doctor_id: appointment.doctor_id,
      office_id: appointment.office_id,
      office_name: officeName,
      office_address: officeAddress,
      doctor_name: doctor?.full_name ?? "Doctor",
      // Backward compat for older /gestionar markup that reads `doctor_address`.
      doctor_address: officeAddress,
      patient_name: patient?.full_name ?? "Paciente",
      start_at: toLocalISOString(appointment.start_at, timezone),
      end_at: toLocalISOString(appointment.end_at, timezone),
      status: appointment.status,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
