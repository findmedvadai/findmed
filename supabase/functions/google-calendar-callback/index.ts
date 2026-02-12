import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state"); // doctor_id
    const error = url.searchParams.get("error");

    if (error) {
      return new Response(renderHTML("Error", `Google rechazó la conexión: ${error}`), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (!code || !state) {
      return new Response(renderHTML("Error", "Faltan parámetros"), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-calendar-callback`;

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
      return new Response(renderHTML("Error", "No se pudo obtener el token de Google"), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const { refresh_token, access_token } = tokenData;

    if (!refresh_token) {
      console.error("No refresh_token returned. User may have already authorized without revoke.");
      return new Response(
        renderHTML("Error", "No se recibió refresh token. Revoca el acceso en tu cuenta de Google e inténtalo de nuevo."),
        { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    // Fetch calendar list to let doctor choose (we'll use primary for now)
    const calendarRes = await fetch(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=owner",
      { headers: { Authorization: `Bearer ${access_token}` } }
    );
    const calendarData = await calendarRes.json();
    const primaryCalendar = calendarData.items?.find((c: any) => c.primary) || calendarData.items?.[0];
    const calendarId = primaryCalendar?.id || "primary";

    // Store refresh token as a Supabase secret-like reference
    // We'll store it directly in a secure column for simplicity
    const doctorId = state;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { error: updateError } = await supabase
      .from("doctors")
      .update({
        google_calendar_connected: true,
        google_calendar_id: calendarId,
        google_refresh_token_ref: refresh_token,
      })
      .eq("id", doctorId);

    if (updateError) {
      console.error("DB update error:", updateError);
      return new Response(renderHTML("Error", "Error al guardar la conexión en la base de datos"), {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response(
      renderHTML("¡Conectado!", "Tu Google Calendar ha sido conectado exitosamente. Puedes cerrar esta ventana."),
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  } catch (err) {
    console.error("Callback error:", err);
    return new Response(renderHTML("Error", "Ocurrió un error inesperado"), {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
});

function renderHTML(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8fafc; }
  .card { background: white; border-radius: 12px; padding: 2rem; box-shadow: 0 4px 24px rgba(0,0,0,0.08); text-align: center; max-width: 400px; }
  h1 { margin: 0 0 0.5rem; font-size: 1.5rem; }
  p { color: #64748b; }
  button { margin-top: 1rem; padding: 0.5rem 1.5rem; border: none; background: #0f172a; color: white; border-radius: 8px; cursor: pointer; font-size: 1rem; }
</style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    <button onclick="window.close()">Cerrar ventana</button>
  </div>
</body>
</html>`;
}
