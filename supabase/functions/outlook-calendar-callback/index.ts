import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getServiceKey } from "../_shared/supabase-keys.ts";
import { appOrigin, resolveOAuthRedirectOrigin, verifyOAuthState } from "../_shared/oauth-state.ts";

// Counterpart of outlook-calendar-auth. The state is a signed, expiring token
// (_shared/oauth-state.ts); a state that fails verification never touches the
// database, and the popup is only redirected to allow-listed origins (until
// the state is verified, only the APP_URL origin is trusted).
serve(async (req) => {
  let redirectOrigin = appOrigin();
  const redirectTo = (path: string) =>
    new Response(null, { status: 302, headers: { Location: `${redirectOrigin}${path}` } });
  const fail = (message: string) =>
    redirectTo(`/outlook-calendar-success?error=${encodeURIComponent(message)}`);

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = getServiceKey();
    const OUTLOOK_CLIENT_ID = Deno.env.get("OUTLOOK_CLIENT_ID")!;
    const OUTLOOK_CLIENT_SECRET = Deno.env.get("OUTLOOK_CLIENT_SECRET")!;
    const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/outlook-calendar-callback`;

    const verified = state ? await verifyOAuthState(state, "outlook") : null;
    // A correctly signed state (even if expired) says where the popup came
    // from; the allow-list is applied again before redirecting there.
    if (verified && (verified.ok || verified.reason === "expired")) {
      redirectOrigin = resolveOAuthRedirectOrigin(verified.data.origin);
    }

    if (error) {
      return fail(`Microsoft rechazó la conexión: ${error}`);
    }
    if (!code || !state) {
      return fail("Faltan parámetros");
    }
    if (!verified?.ok) {
      console.warn("[outlook-calendar-callback] state rejected:", verified?.reason ?? "missing");
      return fail(
        verified?.reason === "expired"
          ? "La conexión tardó demasiado y expiró. Inténtalo de nuevo desde Configuración."
          : "El enlace de conexión no es válido. Inténtalo de nuevo desde Configuración."
      );
    }
    const decoded = verified.data;

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
      return fail("No se pudo obtener el token de Microsoft");
    }
    const { refresh_token } = tokenData;
    if (!refresh_token) {
      console.error("No refresh_token returned.");
      return fail("No se recibió refresh token. Inténtalo de nuevo.");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Note: in the legacy single-office flow, connecting Outlook would
    // disconnect Google to avoid two providers writing into the same calendar.
    // Per-office now this constraint is handled at the office level — each
    // office can only have ONE provider at a time, so we clear the Google
    // fields on this same office.
    const { error: updateError } = await supabase
      .from("doctor_offices")
      .update({
        outlook_refresh_token_ref: refresh_token,
        outlook_calendar_connected: false,
        outlook_calendar_id: null,
        google_calendar_connected: false,
        google_calendar_id: null,
        google_refresh_token_ref: null,
      })
      .eq("id", decoded.officeId)
      .eq("doctor_id", decoded.doctorId);

    if (updateError) {
      console.error("DB update error:", updateError);
      return fail("Error al guardar la conexión en la base de datos");
    }

    return redirectTo("/outlook-calendar-success");
  } catch (err) {
    console.error("Callback error:", err);
    return fail("Ocurrió un error inesperado");
  }
});
