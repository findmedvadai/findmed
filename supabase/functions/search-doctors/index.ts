// Doctor/office search for the patient flow. Body: `{ ciudad, especialidad, zona? }`,
// authenticated with an `fm_` API key (Authorization: Bearer fm_...).
//
// The matching logic lives in `_shared/care-search.ts` (also used by the
// FindMed MCP). This function is the legacy HTTP adapter: it keeps the original
// response fields (`success`, `total`, `doctors[]` with doctor + office data)
// and adds:
//   * `result`: "none" | "one" | "many" — never infer it from `total` alone;
//   * `reason` when result is "none": unknown_city | ambiguous_city |
//     unknown_zone | unknown_specialty | no_active_offices. An empty catalog
//     match is NOT "FindMed can't help": the caller should ask again, widen
//     with the patient's consent, or hand off to a person;
//   * `city_candidates` when the city is ambiguous.
// DB failures return 500 `query_error` instead of an empty list.
// Each row carries office_id so the caller can pass it to triage-webhook.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getServiceKey } from "../_shared/supabase-keys.ts";
import { verifyApiKey } from "../_shared/api-key.ts";
import { searchCareOptions } from "../_shared/care-search.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, getServiceKey());
  if (!(await verifyApiKey(req, supabase))) return json(401, { error: "Unauthorized" });

  let body: { ciudad?: string; especialidad?: string; zona?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const { ciudad, especialidad, zona } = body;
  if (!ciudad || !especialidad) {
    return json(400, { error: "Missing required fields: ciudad, especialidad" });
  }

  const found = await searchCareOptions(supabase, { ciudad, especialidad, zona });
  if (!found.ok) {
    console.error("[search-doctors] query failed at:", found.message);
    return json(500, { error: "query_error" });
  }

  const doctors = found.options.map((o) => ({
    // Doctor fields (kept for backward compatibility).
    id: o.doctor_id,
    full_name: o.doctor_name,
    phone: o.doctor_phone,
    specialties: o.specialties,
    // Office fields — what the caller must pass to triage-webhook.
    office_id: o.office_id,
    office_name: o.office_name,
    office_address: o.office_address,
    address: o.office_address, // alias for legacy templates that read `address`
    city: o.city,
    zone: o.zone,
  }));

  return json(200, {
    success: true,
    result: found.result,
    reason: found.reason ?? null,
    total: doctors.length,
    doctors,
    city: found.city?.name ?? null,
    city_candidates: found.city_candidates?.map((c) => c.name) ?? [],
    zones: found.zones.map((z) => z.name),
    matched_specialties: found.matched_specialties,
  });
});
