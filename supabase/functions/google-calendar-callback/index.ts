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
    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
    const SITE_URL = Deno.env.get("SITE_URL") || "https://findmed.lovable.app";
    const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-calendar-callback`;

    const redirectTo = (path: string) =>
      new Response(null, { status: 302, headers: { Location: `${SITE_URL}${path}` } });

    if (error) {
      return redirectTo(`/google-calendar-success?error=${encodeURIComponent(`Google rechazó la conexión: ${error}`)}`);
    }

    if (!code || !state) {
      return redirectTo(`/google-calendar-success?error=${encodeURIComponent("Faltan parámetros")}`);
    }

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error("Token exchange failed:", tokenData);
      return redirectTo(`/google-calendar-success?error=${encodeURIComponent("No se pudo obtener el token de Google")}`);
    }

    const { refresh_token } = tokenData;

    if (!refresh_token) {
      console.error("No refresh_token returned.");
      return redirectTo(`/google-calendar-success?error=${encodeURIComponent("No se recibió refresh token. Revoca el acceso en tu cuenta de Google e inténtalo de nuevo.")}`);
    }

    // Store refresh token
    const doctorId = state;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { error: updateError } = await supabase
      .from("doctors")
      .update({
        google_refresh_token_ref: refresh_token,
        google_calendar_connected: false,
        google_calendar_id: null,
      })
      .eq("id", doctorId);

    if (updateError) {
      console.error("DB update error:", updateError);
      return redirectTo(`/google-calendar-success?error=${encodeURIComponent("Error al guardar la conexión en la base de datos")}`);
    }

    return redirectTo("/google-calendar-success");
  } catch (err) {
    console.error("Callback error:", err);
    const SITE_URL = Deno.env.get("SITE_URL") || "https://findmed.lovable.app";
    return new Response(null, {
      status: 302,
      headers: { Location: `${SITE_URL}/google-calendar-success?error=${encodeURIComponent("Ocurrió un error inesperado")}` },
    });
  }
});
