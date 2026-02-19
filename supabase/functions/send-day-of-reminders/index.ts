import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function generateToken(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let token = "";
  for (let i = 0; i < 32; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const now = new Date();

  // Get today's date in Mexico City timezone
  const todayMxStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // "YYYY-MM-DD"

  // Query confirmed appointments for today in Mexico City
  // Today in MX = todayMxStr, appointments stored with -06:00 offset
  const dayStart = `${todayMxStr}T00:00:00-06:00`;
  const dayEnd = `${todayMxStr}T23:59:59-06:00`;

  const { data: appointments, error } = await supabase
    .from("appointments")
    .select(`
      id, start_at, end_at, doctor_id, patient_id,
      doctors(full_name),
      patients(full_name, phone)
    `)
    .eq("status", "confirmed")
    .gte("start_at", dayStart)
    .lte("start_at", dayEnd);

  if (error) {
    console.error("Error fetching appointments:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!appointments || appointments.length === 0) {
    return new Response(
      JSON.stringify({ success: true, processed: 0, message: "No confirmed appointments today" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const baseUrl = Deno.env.get("APP_URL") || "https://id-preview--f06cae85-4014-499a-b2cc-40cce2aba6c6.lovable.app";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  let processed = 0;

  for (const appt of appointments) {
    const patient = appt.patients as { full_name: string; phone: string } | null;
    const doctor = appt.doctors as { full_name: string } | null;

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
    if (existingToken) {
      manageToken = existingToken.token;
    } else {
      // Generate new token with 24h expiry (covers the day of the appointment)
      manageToken = generateToken();
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
      await supabase.from("appointment_manage_tokens").insert({
        appointment_id: appt.id,
        token: manageToken,
        expires_at: expiresAt,
        patient_phone: patient?.phone ?? "",
      });
    }

    const manageUrl = `${baseUrl}/gestionar?token=${manageToken}`;

    try {
      await fetch(`${supabaseUrl}/functions/v1/dispatch-webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          event_type: "appointment.reminder_day_of",
          payload: {
            appointment_id: appt.id,
            patient_name: patient?.full_name ?? null,
            patient_phone: patient?.phone ?? null,
            doctor_name: doctor?.full_name ?? null,
            start_at: appt.start_at,
            manage_url: manageUrl,
            message: "Tu cita es hoy. Si necesitas reagendar o cancelar, usa el siguiente enlace.",
          },
        }),
      });
      processed++;
    } catch (e) {
      console.error(`Error dispatching day-of reminder for appointment ${appt.id}:`, e);
    }
  }

  return new Response(
    JSON.stringify({ success: true, processed }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
