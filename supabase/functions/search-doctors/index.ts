import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

  // Update last_used_at (fire-and-forget)
  supabase.from("api_keys").update({ last_used_at: new Date().toISOString() } as any).eq("id", apiKey.id).then(() => {});

  // --- Parse body ---
  let body: { ciudad: string; especialidad: string; zona?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { ciudad, especialidad, zona } = body;

  if (!ciudad || !especialidad) {
    return new Response(
      JSON.stringify({ error: "Missing required fields: ciudad, especialidad" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // --- Normalize search term: strip common suffixes to get root ---
  const normalizeSpecialty = (term: string): string => {
    let t = term.trim().toLowerCase();
    // Remove accents for matching
    t = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    // Strip common suffixes: -logía, -logía, -logo, -loga, -ista, -ia, -ico, -ica
    t = t.replace(/(log[ií]a|logo|loga|ista|[ií]a|ico|ica)$/i, "");
    // Ensure at least 3 chars for meaningful search
    return t.length >= 3 ? t : term.trim().toLowerCase();
  };

  const searchRoot = normalizeSpecialty(especialidad);

  // --- Query doctors with joins ---
  // Step 1: Find doctor IDs matching specialty (using root for flexible match)
  const { data: specialtyMatches, error: specErr } = await supabase
    .from("doctor_specialties")
    .select("doctor_id, specialties!inner(name)")
    .ilike("specialties.name", `%${searchRoot}%`);

  if (specErr) {
    return new Response(
      JSON.stringify({ error: "Query error", details: specErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const doctorIds = (specialtyMatches || []).map((m: any) => m.doctor_id);

  if (doctorIds.length === 0) {
    return new Response(
      JSON.stringify({ success: true, total: 0, doctors: [] }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Helper to query doctors by city (and optionally zone)
  const queryDoctors = async (withZone: boolean) => {
    let q = supabase
      .from("doctors")
      .select("id, full_name, phone, address, cities!inner(name), zones(name)")
      .in("id", doctorIds)
      .eq("is_active", true)
      .eq("is_deleted", false)
      .ilike("cities.name", `%${ciudad}%`);

    if (withZone && zona) {
      q = q.ilike("zones.name", `%${zona}%`);
    }

    return q;
  };

  // Step 2: Query with zone if provided
  let { data: doctors, error: docErr } = await queryDoctors(!!zona);

  if (docErr) {
    return new Response(
      JSON.stringify({ error: "Query error", details: docErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let fallback = false;

  // Step 2b: Fallback — if zone was sent but no results, retry without zone
  if (zona && (!doctors || doctors.length === 0)) {
    const { data: fallbackDoctors, error: fbErr } = await queryDoctors(false);
    if (fbErr) {
      return new Response(
        JSON.stringify({ error: "Query error", details: fbErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    doctors = fallbackDoctors;
    fallback = true;
  }

  // Step 3: Get all specialties for matched doctors
  const matchedIds = (doctors || []).map((d: any) => d.id);
  let specialtiesMap: Record<string, string[]> = {};

  if (matchedIds.length > 0) {
    const { data: allSpecs } = await supabase
      .from("doctor_specialties")
      .select("doctor_id, specialties(name)")
      .in("doctor_id", matchedIds);

    for (const row of allSpecs || []) {
      const did = (row as any).doctor_id;
      const sname = (row as any).specialties?.name;
      if (!specialtiesMap[did]) specialtiesMap[did] = [];
      if (sname) specialtiesMap[did].push(sname);
    }
  }

  // Step 4: Format response
  const result = (doctors || []).map((d: any) => ({
    id: d.id,
    full_name: d.full_name,
    phone: d.phone,
    address: d.address,
    city: d.cities?.name || null,
    zone: d.zones?.name || null,
    specialties: specialtiesMap[d.id] || [],
  }));

  result.sort((a: any, b: any) => (a.zone || "").localeCompare(b.zone || ""));

  const responseBody: any = { success: true, total: result.length, fallback, doctors: result };
  if (fallback) {
    responseBody.fallback_reason = `No se encontraron doctores en la zona '${zona}'. Mostrando todos los doctores de la especialidad en la ciudad.`;
  }

  return new Response(
    JSON.stringify(responseBody),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
