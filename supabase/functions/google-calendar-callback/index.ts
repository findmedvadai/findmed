import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// State decoder counterpart of google-calendar-auth. Two formats accepted:
//   * `${doctorId}:${officeId}`                — legacy
//   * `${doctorId}:${officeId}:${b64(origin)}` — current
function decodeState(
  raw: string
): { doctorId: string; officeId: string; origin: string | null } | null {
  const parts = raw.split(":");
  if (parts.length < 2) return null;
  const [doctorId, officeId, b64Origin] = parts;
  if (!doctorId || !officeId) return null;
  let origin: string | null = null;
  if (b64Origin) {
    try {
      const padded = b64Origin.replace(/-/g, "+").replace(/_/g, "/");
      origin = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    } catch {
      origin = null;
    }
  }
  return { doctorId, officeId, origin };
}

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
    const SITE_URL_FALLBACK = Deno.env.get("SITE_URL") || "https://findmed.lovable.app";
    const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-calendar-callback`;

    // Resolve which origin to redirect to: prefer the one encoded in `state`
    // by the frontend that initiated this flow; fall back to SITE_URL.
    let redirectOrigin = SITE_URL_FALLBACK;
    if (state) {
      const decodedState = decodeState(state);
      if (decodedState?.origin) redirectOrigin = decodedState.origin;
    }

    const redirectTo = (path: string) =>
      new Response(null, { status: 302, headers: { Location: `${redirectOrigin}${path}` } });

    if (error) {
      return redirectTo(`/google-calendar-success?error=${encodeURIComponent(`Google rechazó la conexión: ${error}`)}`);
    }
    if (!code || !state) {
      return redirectTo(`/google-calendar-success?error=${encodeURIComponent("Faltan parámetros")}`);
    }

    const decoded = decodeState(state);
    if (!decoded) {
      // Could be a stale OAuth flow started before the multi-office migration.
      return redirectTo(
        `/google-calendar-success?error=${encodeURIComponent(
          "Sesión OAuth caducada por actualización del sistema. Inténtalo de nuevo desde Configuración."
        )}`
      );
    }

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
      return redirectTo(
        `/google-calendar-success?error=${encodeURIComponent(
          "No se recibió refresh token. Revoca el acceso en tu cuenta de Google e inténtalo de nuevo."
        )}`
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Write the refresh token to the office row (NOT the doctors row). The
    // `connected` flag stays false until the doctor picks a calendar from
    // the list returned by google-calendar-list.
    const { error: updateError } = await supabase
      .from("doctor_offices")
      .update({
        google_refresh_token_ref: refresh_token,
        google_calendar_connected: false,
        google_calendar_id: null,
      })
      .eq("id", decoded.officeId)
      .eq("doctor_id", decoded.doctorId);

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
