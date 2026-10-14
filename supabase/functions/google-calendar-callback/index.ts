import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGoogleCalendarRedirectUri } from "../_shared/oauth-redirect.ts";
import { getServiceKey } from "../_shared/supabase-keys.ts";
import { appOrigin, resolveOAuthRedirectOrigin, verifyOAuthState } from "../_shared/oauth-state.ts";

// Counterpart of google-calendar-auth. The state is a signed, expiring token
// (_shared/oauth-state.ts); a state that fails verification never touches the
// database, and the popup is only redirected to allow-listed origins (until
// the state is verified, only the APP_URL origin is trusted).
serve(async (req) => {
  let redirectOrigin = appOrigin();
  const redirectTo = (path: string) =>
    new Response(null, { status: 302, headers: { Location: `${redirectOrigin}${path}` } });
  const fail = (message: string) =>
    redirectTo(`/google-calendar-success?error=${encodeURIComponent(message)}`);

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = getServiceKey();
    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
    // MUST match the redirect_uri sent by google-calendar-auth exactly, or
    // Google rejects the exchange with redirect_uri_mismatch. Both import the
    // same shared constant to guarantee that.
    const REDIRECT_URI = getGoogleCalendarRedirectUri();

    const verified = state ? await verifyOAuthState(state, "google") : null;
    // A correctly signed state (even if expired) says where the popup came
    // from; the allow-list is applied again before redirecting there.
    if (verified && (verified.ok || verified.reason === "expired")) {
      redirectOrigin = resolveOAuthRedirectOrigin(verified.data.origin);
    }

    if (error) {
      return fail(`Google rechazó la conexión: ${error}`);
    }
    if (!code || !state) {
      return fail("Faltan parámetros");
    }
    if (!verified?.ok) {
      console.warn("[google-calendar-callback] state rejected:", verified?.reason ?? "missing");
      return fail(
        verified?.reason === "expired"
          ? "La conexión tardó demasiado y expiró. Inténtalo de nuevo desde Configuración."
          : "El enlace de conexión no es válido. Inténtalo de nuevo desde Configuración."
      );
    }
    const decoded = verified.data;

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
      return fail("No se pudo obtener el token de Google");
    }
    const { refresh_token } = tokenData;
    if (!refresh_token) {
      console.error("No refresh_token returned.");
      return fail("No se recibió refresh token. Revoca el acceso en tu cuenta de Google e inténtalo de nuevo.");
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
      return fail("Error al guardar la conexión en la base de datos");
    }

    return redirectTo("/google-calendar-success");
  } catch (err) {
    console.error("Callback error:", err);
    return fail("Ocurrió un error inesperado");
  }
});
