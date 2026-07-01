// Update an existing office. Same auth model as create: admin or owning doctor.
// Only mutable office metadata can change here — calendar OAuth tokens come
// from the OAuth flow, not this endpoint.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAdminOrDoctor } from "../_shared/auth.ts";
import { recordManualDisconnect } from "../_shared/connection-events.ts";

interface Body {
  office_id: string;
  name?: string;
  address?: string | null;
  city_id?: string | null;
  zone_id?: string | null;
  appointment_duration_minutes?: number;
  display_color?: string;
  is_active?: boolean;
  // Calendar disconnects are also done here so the doctor can drop a stale
  // connection without going through OAuth revocation.
  disconnect_google?: boolean;
  disconnect_outlook?: boolean;
  google_calendar_id?: string | null;
  outlook_calendar_id?: string | null;
  google_calendar_connected?: boolean;
  outlook_calendar_connected?: boolean;
  // Persisted friendly name so the trigger of the calendar Select can render
  // the real name immediately instead of fetching the list on every page load.
  google_calendar_name?: string | null;
  outlook_calendar_name?: string | null;
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
  if (!body.office_id) return jsonResponse({ error: "office_id requerido" }, 400);

  const { data: office } = await supabase
    .from("doctor_offices")
    .select(
      "id, doctor_id, is_deleted, google_calendar_connected, outlook_calendar_connected, " +
        "google_connected_at, outlook_connected_at"
    )
    .eq("id", body.office_id)
    .maybeSingle();
  if (!office || office.is_deleted) {
    return jsonResponse({ error: "Consultorio no encontrado" }, 404);
  }

  const auth = await requireAdminOrDoctor(req, supabase, office.doctor_id);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.address !== undefined) updates.address = body.address;
  if (body.city_id !== undefined) updates.city_id = body.city_id;
  if (body.zone_id !== undefined) updates.zone_id = body.zone_id;
  if (body.appointment_duration_minutes !== undefined)
    updates.appointment_duration_minutes = body.appointment_duration_minutes;
  if (body.display_color !== undefined) updates.display_color = body.display_color;
  if (body.is_active !== undefined) updates.is_active = body.is_active;

  // Selecting a specific calendar after OAuth.
  if (body.google_calendar_id !== undefined) updates.google_calendar_id = body.google_calendar_id;
  if (body.outlook_calendar_id !== undefined) updates.outlook_calendar_id = body.outlook_calendar_id;
  if (body.google_calendar_connected !== undefined)
    updates.google_calendar_connected = body.google_calendar_connected;
  if (body.outlook_calendar_connected !== undefined)
    updates.outlook_calendar_connected = body.outlook_calendar_connected;
  if (body.google_calendar_name !== undefined)
    updates.google_calendar_name = body.google_calendar_name;
  if (body.outlook_calendar_name !== undefined)
    updates.outlook_calendar_name = body.outlook_calendar_name;

  // Connect-time capture: stamp `*_connected_at` at the moment a connection
  // goes live (calendar picked → connected flips true). Only stamp on the
  // not-connected → connected transition (or to backfill a legacy connection
  // whose timestamp is still NULL) so switching calendars on an already-live
  // connection — same OAuth token — does not reset the measured lifetime.
  const nowIso = new Date().toISOString();
  if (
    body.google_calendar_connected === true &&
    (office.google_calendar_connected !== true || office.google_connected_at == null)
  ) {
    updates.google_connected_at = nowIso;
  }
  if (
    body.outlook_calendar_connected === true &&
    (office.outlook_calendar_connected !== true || office.outlook_connected_at == null)
  ) {
    updates.outlook_connected_at = nowIso;
  }

  // Hard disconnect: clears refresh token + connected flag + calendar id + name
  // + connect timestamp.
  if (body.disconnect_google) {
    updates.google_calendar_connected = false;
    updates.google_calendar_id = null;
    updates.google_calendar_name = null;
    updates.google_refresh_token_ref = null;
    updates.google_connected_at = null;
  }
  if (body.disconnect_outlook) {
    updates.outlook_calendar_connected = false;
    updates.outlook_calendar_id = null;
    updates.outlook_calendar_name = null;
    updates.outlook_refresh_token_ref = null;
    updates.outlook_connected_at = null;
  }

  if (Object.keys(updates).length === 0) {
    return jsonResponse({ error: "Nada que actualizar" }, 400);
  }

  const { data, error } = await supabase
    .from("doctor_offices")
    .update(updates)
    .eq("id", body.office_id)
    .select(
      "id, doctor_id, name, address, city_id, zone_id, appointment_duration_minutes, display_color, " +
        "google_calendar_connected, google_calendar_id, google_calendar_name, " +
        "outlook_calendar_connected, outlook_calendar_id, outlook_calendar_name, " +
        "is_active, is_deleted"
    )
    .single();

  if (error) {
    if (error.code === "23505") {
      return jsonResponse(
        { error: "zone_taken", message: "Ya tienes un consultorio activo en esa zona." },
        409
      );
    }
    console.error("[doctor-office-update] update failed:", error);
    return jsonResponse({ error: "No se pudo actualizar el consultorio", details: error.message }, 500);
  }

  // Durably record manual disconnects (best-effort; never blocks the response).
  // Disambiguates a doctor/admin-initiated disconnect from a provider
  // auto-disconnect when investigating a dead office later. `connected_at` is
  // snapshotted from the pre-update office row so token lifetime is derivable.
  const actorRole = auth.isAdmin ? "admin" : "doctor";
  if (body.disconnect_google) {
    await recordManualDisconnect(supabase, {
      provider: "google",
      officeId: office.id,
      doctorId: office.doctor_id,
      actorUserId: auth.userId,
      actorRole,
      connectedAt: office.google_connected_at ?? null,
    });
  }
  if (body.disconnect_outlook) {
    await recordManualDisconnect(supabase, {
      provider: "outlook",
      officeId: office.id,
      doctorId: office.doctor_id,
      actorUserId: auth.userId,
      actorRole,
      connectedAt: office.outlook_connected_at ?? null,
    });
  }

  return jsonResponse({ success: true, office: data });
});
