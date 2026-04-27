import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

  // Find session by token. office_id is the assigned office for this triage
  // — we surface its name and address to the patient on the reservation page.
  const { data: session, error: sessionError } = await supabase
    .from("reservation_sessions")
    .select("id, doctor_id, office_id, patient_id, symptoms, expires_at, used_at")
    .eq("token", token)
    .maybeSingle();

  if (sessionError || !session) {
    return new Response(JSON.stringify({ error: "Token inválido" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Check if already used
  if (session.used_at) {
    return new Response(JSON.stringify({ error: "Este enlace ya fue utilizado" }), {
      status: 410,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Check expiration
  if (new Date(session.expires_at) < new Date()) {
    return new Response(JSON.stringify({ error: "Este enlace ha expirado" }), {
      status: 410,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Doctor name (display only; the address now comes from the office).
  const { data: doctor } = await supabase
    .from("doctors")
    .select("full_name")
    .eq("id", session.doctor_id)
    .maybeSingle();

  // Office that the agent assigned during triage. Falls back gracefully when
  // a legacy session predates the office migration.
  let officeName: string | null = null;
  let officeAddress: string | null = null;
  if (session.office_id) {
    const { data: office } = await supabase
      .from("doctor_offices")
      .select("name, address")
      .eq("id", session.office_id)
      .maybeSingle();
    officeName = office?.name ?? null;
    officeAddress = office?.address ?? null;
  }

  const { data: patient } = await supabase
    .from("patients")
    .select("full_name")
    .eq("id", session.patient_id)
    .maybeSingle();

  return new Response(
    JSON.stringify({
      session_id: session.id,
      doctor_id: session.doctor_id,
      office_id: session.office_id,
      patient_id: session.patient_id,
      doctor_name: doctor?.full_name ?? "Doctor",
      // Kept for backward compatibility with existing /reserva markup; same value
      // as office_address.
      doctor_address: officeAddress,
      office_name: officeName,
      office_address: officeAddress,
      patient_name: patient?.full_name ?? "Paciente",
      symptoms: session.symptoms,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
