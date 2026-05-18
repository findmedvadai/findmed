import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { resolveOfficeForCaller, parseTargetParams } from "../_shared/office-resolver.ts";
import { getGoogleAccessToken } from "../_shared/calendar-tokens.ts";

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "No autorizado" }, 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const payload = decodeJwtPayload(token);
    if (!payload?.sub || !payload?.exp || (payload.exp as number) < Math.floor(Date.now() / 1000)) {
      return jsonResponse({ error: "Token inválido" }, 401);
    }
    const userId = payload.sub as string;

    const { officeId } = parseTargetParams(req);
    if (!officeId) {
      return jsonResponse({ error: "office_id requerido" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const resolved = await resolveOfficeForCaller(supabase, userId, officeId);
    if ("error" in resolved) return jsonResponse({ error: resolved.error }, resolved.status);
    const office = resolved.office;

    if (!office.google_refresh_token_ref) {
      return jsonResponse({ error: "No hay token de Google para este consultorio. Conecta primero." }, 400);
    }

    // Shared helper handles refresh-token rotation and marks the office as
    // disconnected if Google returns invalid_grant (permanent failure).
    const accessToken = await getGoogleAccessToken({ supabase, office });
    if (!accessToken) {
      return jsonResponse({ error: "Error al obtener acceso a Google" }, 400);
    }

    const calRes = await fetch(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=owner",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const calData = await calRes.json();

    const calendars = (calData.items || []).map((c: any) => ({
      id: c.id,
      summary: c.summary,
      primary: c.primary || false,
    }));

    return jsonResponse({ calendars });
  } catch (error) {
    console.error("Error in google-calendar-list:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Error desconocido" }, 500);
  }
});
