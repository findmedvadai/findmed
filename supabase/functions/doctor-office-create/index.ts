// Create a new office for a doctor. Both admin and the owning doctor can
// call this. The (doctor_id, zone_id) unique-among-active partial index on
// `doctor_offices` will reject duplicates with a clear unique-violation error.
//
// Body:
//   doctor_id: uuid (required; for an admin, the target doctor; for a doctor
//                    user, must equal their own doctor_id)
//   name: string (required)
//   address?: string
//   city_id?: uuid
//   zone_id?: uuid
//   appointment_duration_minutes?: integer
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAdminOrDoctor } from "../_shared/auth.ts";

interface Body {
  doctor_id: string;
  name: string;
  address?: string | null;
  city_id?: string | null;
  zone_id?: string | null;
  appointment_duration_minutes?: number;
  display_color?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!body.doctor_id || !body.name?.trim()) {
    return jsonResponse({ error: "doctor_id y name son requeridos" }, 400);
  }

  const auth = await requireAdminOrDoctor(req, supabase, body.doctor_id);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

  // Verify doctor exists and is active.
  const { data: doctor } = await supabase
    .from("doctors")
    .select("id, is_active, is_deleted")
    .eq("id", body.doctor_id)
    .maybeSingle();
  if (!doctor || !doctor.is_active || doctor.is_deleted) {
    return jsonResponse({ error: "Doctor no encontrado o inactivo" }, 404);
  }

  const insert: Record<string, unknown> = {
    doctor_id: body.doctor_id,
    name: body.name.trim(),
    address: body.address ?? null,
    city_id: body.city_id ?? null,
    zone_id: body.zone_id ?? null,
    appointment_duration_minutes: body.appointment_duration_minutes ?? 30,
  };
  if (body.display_color) insert.display_color = body.display_color;

  const { data, error } = await supabase
    .from("doctor_offices")
    .insert(insert)
    .select(
      "id, doctor_id, name, address, city_id, zone_id, appointment_duration_minutes, display_color, is_active, is_deleted"
    )
    .single();

  if (error) {
    if (error.code === "23505") {
      const isNameConflict =
        error.message?.includes("name") || error.details?.includes("name");
      if (isNameConflict) {
        return jsonResponse(
          { error: "name_taken", message: "Ya tienes un consultorio activo con ese nombre." },
          409
        );
      }
      return jsonResponse(
        { error: "zone_taken", message: "Ya tienes un consultorio activo en esa zona." },
        409
      );
    }
    console.error("[doctor-office-create] insert failed:", error);
    return jsonResponse({ error: "No se pudo crear el consultorio", details: error.message }, 500);
  }

  return jsonResponse({ success: true, office: data });
});
