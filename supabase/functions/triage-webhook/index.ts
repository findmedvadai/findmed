import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeMxPhone, mxPhoneLookupVariants } from "../_shared/phone.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Token generator for `reservation_sessions.token` only — a 72h triage link,
// distinct from the patient-facing /gestionar manage token (which lives in
// _shared/manage-token.ts and writes to a different table).
function generateSessionToken(): string {
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

  // --- API Key validation ---
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

  // Hash the raw key and verify against api_keys table
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

  // Update last_used_at (fire-and-forget)
  supabase.from("api_keys").update({ last_used_at: new Date().toISOString() } as any).eq("id", apiKey.id).then(() => {});

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

  // Normalize phone and upsert patient. We canonicalize to `+52XXXXXXXXXX`
  // for inserts but look up by both Mexican variants (`+52` / `+521`) so we
  // don't create duplicates against rows from older flows.
  const phone = normalizeMxPhone(patient_phone);
  const phoneVariants = mxPhoneLookupVariants(phone);

  const { data: existingMatches } = await supabase
    .from("patients")
    .select("id")
    .in("phone", phoneVariants)
    .order("created_at", { ascending: true })
    .limit(1);
  const existingPatient = existingMatches?.[0];

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
  const token = generateSessionToken();
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
  const baseUrl = Deno.env.get("APP_URL") || "https://findmed.lovable.app";
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
