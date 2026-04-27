// Patient flow entry point. Called by the n8n agent with `{ ciudad, especialidad, zona? }`.
//
// Returns an array of (doctor, office) pairs that match all of:
//   * the doctor has the requested specialty
//   * the office is active and not deleted
//   * the office's city matches `ciudad`
//   * the office's zone matches `zona` (if provided)
//
// The "many results" semantics that n8n already counts on come from the
// query naturally: any number of qualifying offices may be returned. When
// nothing matches, we return an empty array — n8n's existing branch for
// "Sin Match" will route the conversation to a human advisor.
//
// We do NOT fall back to city-only when zone-specific yields nothing — that
// would mask "no doctor in this zone" cases the agent should treat as Sin
// Match. Each result row carries office_id / office_name / office_address
// so the agent can hand them back to triage-webhook unambiguously.

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

  // Specialty stem: drop common Spanish suffixes so "ginecología", "ginecólogo",
  // "gineco" all map to a stable root for ILIKE matching.
  const normalizeSpecialty = (term: string): string => {
    let t = term.trim().toLowerCase();
    t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
    t = t.replace(/(log[ií]a|logo|loga|ista|[ií]a|ico|ica)$/i, "");
    return t.length >= 3 ? t : term.trim().toLowerCase();
  };
  const searchRoot = normalizeSpecialty(especialidad);

  // 1. Doctor IDs that have the requested specialty.
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
  const doctorIds = [...new Set((specialtyMatches || []).map((m: any) => m.doctor_id))];
  if (doctorIds.length === 0) {
    return new Response(
      JSON.stringify({ success: true, total: 0, doctors: [] }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 2. City IDs by name.
  const { data: cityRows } = await supabase
    .from("cities")
    .select("id, name")
    .ilike("name", `%${ciudad}%`);
  const cityIds = (cityRows || []).map((c: any) => c.id);
  if (cityIds.length === 0) {
    return new Response(
      JSON.stringify({ success: true, total: 0, doctors: [] }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  const cityMap: Record<string, string> = {};
  for (const c of cityRows || []) cityMap[c.id] = c.name;

  // 3. Zone IDs by name (optional).
  let zoneIds: string[] | null = null;
  if (zona) {
    const { data: zoneRows } = await supabase
      .from("zones")
      .select("id, name")
      .ilike("name", `%${zona}%`)
      .in("city_id", cityIds);
    zoneIds = (zoneRows || []).map((z: any) => z.id);
    if (zoneIds.length === 0) {
      // Zone explicitly requested but not found in any of the candidate
      // cities — short-circuit to "Sin Match". No fallback.
      return new Response(
        JSON.stringify({ success: true, total: 0, doctors: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // 4. Match against active doctor_offices. Filter by:
  //    - doctor in specialty matches
  //    - office active + not deleted
  //    - office.city_id in candidate cities
  //    - office.zone_id in candidate zones (if zona provided)
  // We also filter out offices whose owning doctor is inactive/deleted, since
  // those should never show to patients (the spec says "doctores con 0 consultorios
  // activos no aparecen" but the inverse — active offices of inactive doctors —
  // is also out of bounds).
  let officeQuery = supabase
    .from("doctor_offices")
    .select(
      "id, doctor_id, name, address, city_id, zone_id, " +
        "doctors!inner(id, full_name, phone, is_active, is_deleted)"
    )
    .eq("is_active", true)
    .eq("is_deleted", false)
    .in("doctor_id", doctorIds)
    .in("city_id", cityIds)
    .eq("doctors.is_active", true)
    .eq("doctors.is_deleted", false);

  if (zoneIds && zoneIds.length > 0) {
    officeQuery = officeQuery.in("zone_id", zoneIds);
  }

  const { data: offices, error: officeErr } = await officeQuery;
  if (officeErr) {
    return new Response(
      JSON.stringify({ error: "Query error", details: officeErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  const officeRows = (offices ?? []) as any[];

  if (officeRows.length === 0) {
    return new Response(
      JSON.stringify({ success: true, total: 0, doctors: [] }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 5. Resolve zone names for the matched offices.
  const matchedZoneIds = [...new Set(officeRows.map((o) => o.zone_id).filter(Boolean))];
  const zoneMap: Record<string, string> = {};
  if (matchedZoneIds.length > 0) {
    const { data: zoneRows } = await supabase
      .from("zones")
      .select("id, name")
      .in("id", matchedZoneIds);
    for (const z of zoneRows || []) zoneMap[z.id] = z.name;
  }

  // 6. Specialties for each matched doctor.
  const matchedDoctorIds = [...new Set(officeRows.map((o) => o.doctor_id))];
  const specialtiesMap: Record<string, string[]> = {};
  if (matchedDoctorIds.length > 0) {
    const { data: allSpecs } = await supabase
      .from("doctor_specialties")
      .select("doctor_id, specialties(name)")
      .in("doctor_id", matchedDoctorIds);
    for (const row of allSpecs || []) {
      const did = (row as any).doctor_id;
      const sname = (row as any).specialties?.name;
      if (!specialtiesMap[did]) specialtiesMap[did] = [];
      if (sname) specialtiesMap[did].push(sname);
    }
  }

  // 7. Format response. One row per (doctor, office) pair. The constraint
  //    `(doctor_id, zone_id)` unique among active offices guarantees that
  //    when zona is provided there is at most one office per matching doctor.
  const result = officeRows.map((o) => ({
    // Doctor fields (preserved for backward compatibility with the agent).
    id: o.doctors.id,
    full_name: o.doctors.full_name,
    phone: o.doctors.phone,
    specialties: specialtiesMap[o.doctors.id] || [],
    // Office fields — these are what the agent should pass to triage-webhook.
    office_id: o.id,
    office_name: o.name,
    office_address: o.address,
    address: o.address, // alias for legacy n8n templates that read `address`
    city: cityMap[o.city_id] || null,
    zone: zoneMap[o.zone_id] || null,
  }));

  result.sort((a, b) => (a.zone || "").localeCompare(b.zone || ""));

  return new Response(
    JSON.stringify({ success: true, total: result.length, doctors: result }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
