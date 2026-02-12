import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function normalizePhone(raw: string): string {
  // Strip everything except digits and leading +
  let digits = raw.replace(/[^\d+]/g, "");
  // If it starts with +, keep it; otherwise assume MX
  if (digits.startsWith("+")) return digits;
  // Remove leading 0 if present
  if (digits.startsWith("0")) digits = digits.slice(1);
  // If 10 digits, assume MX country code
  if (digits.length === 10) return `+52${digits}`;
  // If 12 digits starting with 52, add +
  if (digits.length === 12 && digits.startsWith("52")) return `+${digits}`;
  return `+${digits}`;
}

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
    return new Response("ok", { headers: corsHeaders });
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

  let body: {
    doctor_id: string;
    patient_name: string;
    patient_phone: string;
    symptoms?: string;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { doctor_id, patient_name, patient_phone, symptoms } = body;

  if (!doctor_id || !patient_name || !patient_phone) {
    return new Response(
      JSON.stringify({ error: "Missing required fields: doctor_id, patient_name, patient_phone" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Validate doctor exists and is active
  const { data: doctor, error: doctorError } = await supabase
    .from("doctors")
    .select("id, full_name")
    .eq("id", doctor_id)
    .eq("is_active", true)
    .maybeSingle();

  if (doctorError || !doctor) {
    return new Response(
      JSON.stringify({ error: "Doctor not found or inactive" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Normalize phone and upsert patient
  const phone = normalizePhone(patient_phone);

  // Try to find existing patient by phone
  const { data: existingPatient } = await supabase
    .from("patients")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();

  let patientId: string;

  if (existingPatient) {
    // Update name if changed
    await supabase
      .from("patients")
      .update({ full_name: patient_name })
      .eq("id", existingPatient.id);
    patientId = existingPatient.id;
  } else {
    const { data: newPatient, error: insertError } = await supabase
      .from("patients")
      .insert({ full_name: patient_name, phone })
      .select("id")
      .single();

    if (insertError || !newPatient) {
      return new Response(
        JSON.stringify({ error: "Failed to create patient", details: insertError?.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    patientId = newPatient.id;
  }

  // Create reservation session (expires in 72 hours)
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

  const { data: session, error: sessionError } = await supabase
    .from("reservation_sessions")
    .insert({
      doctor_id,
      patient_id: patientId,
      token,
      symptoms: symptoms || null,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (sessionError || !session) {
    return new Response(
      JSON.stringify({ error: "Failed to create reservation session", details: sessionError?.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Build the reserve URL using the APP_URL secret or fallback
  const baseUrl = Deno.env.get("APP_URL") || "https://id-preview--f06cae85-4014-499a-b2cc-40cce2aba6c6.lovable.app";
  const reserveUrl = `${baseUrl}/reserva?token=${token}`;

  return new Response(
    JSON.stringify({
      success: true,
      reserve_url: reserveUrl,
      session_id: session.id,
      token,
      expires_at: expiresAt,
      patient_id: patientId,
      doctor_name: doctor.full_name,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
