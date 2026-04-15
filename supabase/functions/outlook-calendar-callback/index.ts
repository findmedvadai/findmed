import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state"); // doctor_id
    const error = url.searchParams.get("error");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const OUTLOOK_CLIENT_ID = Deno.env.get("OUTLOOK_CLIENT_ID")!;
    const OUTLOOK_CLIENT_SECRET = Deno.env.get("OUTLOOK_CLIENT_SECRET")!;
    const SITE_URL = Deno.env.get("SITE_URL") || "https://findmed.lovable.app";
    const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/outlook-calendar-callback`;

    const redirectTo = (path: string) =>
      new Response(null, { status: 302, headers: { Location: `${SITE_URL}${path}` } });

    if (error) {
      return redirectTo(`/outlook-calendar-success?error=${encodeURIComponent(`Microsoft rechazó la conexión: ${error}`)}`);
    }

    if (!code || !state) {
      return redirectTo(`/outlook-calendar-success?error=${encodeURIComponent("Faltan parámetros")}`);
    }

    // Exchange code for tokens
    const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: OUTLOOK_CLIENT_ID,
        client_secret: OUTLOOK_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
        scope: "offline_access Calendars.ReadWrite",
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error("Token exchange failed:", tokenData);
      return redirectTo(`/outlook-calendar-success?error=${encodeURIComponent("No se pudo obtener el token de Microsoft")}`);
    }

    const { refresh_token } = tokenData;

    if (!refresh_token) {
      console.error("No refresh_token returned.");
      return redirectTo(`/outlook-calendar-success?error=${encodeURIComponent("No se recibió refresh token. Inténtalo de nuevo.")}`);
    }

    // Store refresh token and disconnect Google if connected
    const doctorId = state;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { error: updateError } = await supabase
      .from("doctors")
      .update({
        outlook_refresh_token_ref: refresh_token,
        outlook_calendar_connected: false,
        outlook_calendar_id: null,
        // Disconnect Google
        google_calendar_connected: false,
        google_calendar_id: null,
        google_refresh_token_ref: null,
      })
      .eq("id", doctorId);

    if (updateError) {
      console.error("DB update error:", updateError);
      return redirectTo(`/outlook-calendar-success?error=${encodeURIComponent("Error al guardar la conexión en la base de datos")}`);
    }

    return redirectTo("/outlook-calendar-success");
  } catch (err) {
    console.error("Callback error:", err);
    const SITE_URL = Deno.env.get("SITE_URL") || "https://findmed.lovable.app";
    return new Response(null, {
      status: 302,
      headers: { Location: `${SITE_URL}/outlook-calendar-success?error=${encodeURIComponent("Ocurrió un error inesperado")}` },
    });
  }
});
