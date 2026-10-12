// Slots for the patient reservation and /gestionar reschedule pages.
// Body: { office_id, date } (or legacy { doctor_id, date }). Returns
// { slots: ["09:00", …], duration_minutes, within_48h, availability_status }.
//
// The computation lives in _shared/day-slots.ts (also used by the FindMed MCP):
// weekly blocks of the office, minus the doctor's blocked days, the doctor's
// live appointments in ANY office (D2), busy events of the connected calendar,
// and past/too-close slots. `availability_status` says whether the connected
// calendar could be checked ("verified") or not ("external_calendar_unverified").

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getServiceKey } from "../_shared/supabase-keys.ts";
import { computeDaySlots } from "../_shared/day-slots.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, getServiceKey());

  let body: { office_id?: string; doctor_id?: string; date?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  let { office_id } = body;
  const { doctor_id, date } = body;
  if (!date || (!office_id && !doctor_id)) {
    return json(400, { error: "office_id (o doctor_id legacy) y date requeridos" });
  }

  // Legacy callers (sessions created before multi-office) send doctor_id only:
  // resolve to that doctor's oldest active office.
  if (!office_id && doctor_id) {
    const { data: legacyOffice } = await supabase
      .from("doctor_offices")
      .select("id")
      .eq("doctor_id", doctor_id)
      .eq("is_active", true)
      .eq("is_deleted", false)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    office_id = legacyOffice?.id;
  }
  if (!office_id) return json(200, { slots: [], availability_status: "office_unavailable" });

  const r = await computeDaySlots(supabase, office_id, date);
  if (!r.ok) return json(400, { error: "date debe tener formato YYYY-MM-DD" });
  const { slots, duration_minutes, within_48h, availability_status } = r.value;
  return json(200, { slots, duration_minutes, within_48h, availability_status });
});
