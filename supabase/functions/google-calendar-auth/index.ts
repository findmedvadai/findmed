import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGoogleCalendarRedirectUri } from "../_shared/oauth-redirect.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

// State format: `${doctor_id}:${office_id}` plus an optional URL-safe base64
// origin tail (`:b64(origin)`). The origin is the frontend URL that initiated
// the OAuth flow — we'll redirect there on the callback so it works across
// localhost / staging / production without depending on a single SITE_URL env.
function encodeState(doctorId: string, officeId: string, origin?: string | null): string {
  const base = `${doctorId}:${officeId}`;
  if (!origin) return base;
  // base64url-encode the origin so it survives the OAuth round-trip.
  const b64 = btoa(origin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${base}:${b64}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
    if (!GOOGLE_CLIENT_ID) throw new Error("GOOGLE_CLIENT_ID not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const payload = decodeJwtPayload(token);
    if (!payload?.sub || !payload?.exp) {
      return new Response(JSON.stringify({ error: "Token inválido" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const now = Math.floor(Date.now() / 1000);
    if ((payload.exp as number) < now) {
      return new Response(JSON.stringify({ error: "Token expirado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = payload.sub as string;

    // office_id: required. Comes from `?office_id=…` query param OR JSON body.
    // origin: optional URL of the frontend that started the flow — we use it
    // to redirect to the right host on the callback (so OAuth works on
    // localhost during dev without configuring SITE_URL env per environment).
    const url = new URL(req.url);
    let officeId = url.searchParams.get("office_id");
    let origin = url.searchParams.get("origin");
    if (!officeId) {
      try {
        const body = await req.clone().json();
        officeId = body?.office_id ?? null;
        origin = origin ?? body?.origin ?? null;
      } catch {
        // No body, fall through to error.
      }
    }
    if (!officeId) {
      return new Response(JSON.stringify({ error: "office_id requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Resolve the doctor for this user. Admin can connect calendars on behalf
    // of any doctor (passing the office's doctor_id implicitly via office_id);
    // a doctor can only connect their own offices.
    const { data: userData } = await supabase
      .from("users")
      .select("doctor_id")
      .eq("id", userId)
      .maybeSingle();

    const { data: isAdmin } = await supabase.rpc("is_admin_or_superadmin", {
      _user_id: userId,
    });

    // Verify the office exists and belongs to a doctor the caller can act on.
    const { data: office } = await supabase
      .from("doctor_offices")
      .select("id, doctor_id, is_deleted")
      .eq("id", officeId)
      .maybeSingle();

    if (!office || office.is_deleted) {
      return new Response(JSON.stringify({ error: "Consultorio no encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!isAdmin && office.doctor_id !== userData?.doctor_id) {
      return new Response(JSON.stringify({ error: "No autorizado para este consultorio" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Public redirect URI on app.findmed.com.mx (proxied by Vercel to the
    // callback Edge Function). Shared with google-calendar-callback so the
    // value sent to Google is byte-identical in both steps.
    const REDIRECT_URI = getGoogleCalendarRedirectUri();
    const state = encodeState(office.doctor_id, office.id, origin);

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/calendar",
      access_type: "offline",
      prompt: "consent",
      state,
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    return new Response(JSON.stringify({ url: authUrl }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in google-calendar-auth:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Error desconocido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
