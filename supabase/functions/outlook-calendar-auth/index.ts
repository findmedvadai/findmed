import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function encodeState(doctorId: string, officeId: string, origin?: string | null): string {
  const base = `${doctorId}:${officeId}`;
  if (!origin) return base;
  const b64 = btoa(origin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${base}:${b64}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OUTLOOK_CLIENT_ID = Deno.env.get("OUTLOOK_CLIENT_ID");
    if (!OUTLOOK_CLIENT_ID) throw new Error("OUTLOOK_CLIENT_ID not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const payload = decodeJwtPayload(token);
    if (!payload?.sub || !payload?.exp || (payload.exp as number) < Math.floor(Date.now() / 1000)) {
      return new Response(JSON.stringify({ error: "Token inválido" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = payload.sub as string;

    const url = new URL(req.url);
    let officeId = url.searchParams.get("office_id");
    let origin = url.searchParams.get("origin");
    if (!officeId) {
      try {
        const body = await req.clone().json();
        officeId = body?.office_id ?? null;
        origin = origin ?? body?.origin ?? null;
      } catch {
        // No body.
      }
    }
    if (!officeId) {
      return new Response(JSON.stringify({ error: "office_id requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: userData } = await supabase
      .from("users")
      .select("doctor_id")
      .eq("id", userId)
      .maybeSingle();
    const { data: isAdmin } = await supabase.rpc("is_admin_or_superadmin", {
      _user_id: userId,
    });

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

    const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/outlook-calendar-callback`;
    const state = encodeState(office.doctor_id, office.id, origin);

    const params = new URLSearchParams({
      client_id: OUTLOOK_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: "offline_access Calendars.ReadWrite",
      response_mode: "query",
      prompt: "consent",
      state,
    });

    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
    return new Response(JSON.stringify({ url: authUrl }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in outlook-calendar-auth:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Error desconocido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
