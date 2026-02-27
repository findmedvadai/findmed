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

    const { refresh_token } = tokenData;

    if (!refresh_token) {
      console.error("No refresh_token returned. User may have already authorized without revoke.");
      return new Response(
        renderHTML("Error", "No se recibió refresh token. Revoca el acceso en tu cuenta de Google e inténtalo de nuevo."),
        { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    // Store refresh token but DON'T auto-select calendar — let the doctor choose
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
      return new Response(renderHTML("Error", "Error al guardar la conexión en la base de datos"), {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response(
      renderSuccessHTML(),
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

function renderSuccessHTML(): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Conexión exitosa</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8fafc; }
  .card { background: white; border-radius: 12px; padding: 2.5rem; box-shadow: 0 4px 24px rgba(0,0,0,0.08); text-align: center; max-width: 400px; }
  .check { width: 64px; height: 64px; margin: 0 auto 1rem; }
  h1 { margin: 0 0 0.5rem; font-size: 1.5rem; color: #16a34a; }
  p { color: #64748b; line-height: 1.5; }
  .auto-close { font-size: 0.85rem; color: #94a3b8; margin-top: 0.5rem; }
  button { margin-top: 1rem; padding: 0.6rem 1.8rem; border: none; background: #16a34a; color: white; border-radius: 8px; cursor: pointer; font-size: 1rem; }
  button:hover { background: #15803d; }
</style>
</head>
<body>
  <div class="card">
    <svg class="check" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="11" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/>
      <path d="M7 12.5l3 3 7-7" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <h1>¡Conexión exitosa!</h1>
    <p>Tu cuenta de Google ha sido vinculada correctamente.<br/>Ya puedes cerrar esta ventana y seleccionar el calendario que deseas usar.</p>
    <p class="auto-close" id="countdown">Esta ventana se cerrará automáticamente en 5 segundos...</p>
    <button onclick="window.close()">Cerrar ventana</button>
  </div>
  <script>
    try { window.opener?.postMessage("google-calendar-connected", "*"); } catch(e) {}
    let sec = 5;
    const el = document.getElementById("countdown");
    const timer = setInterval(() => {
      sec--;
      if (sec <= 0) { clearInterval(timer); window.close(); }
      else { el.textContent = "Esta ventana se cerrará automáticamente en " + sec + " segundos..."; }
    }, 1000);
  </script>
</body>
</html>`;
}
