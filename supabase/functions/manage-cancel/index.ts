// Patient cancels from /gestionar?token=… The manage token is the
// authorization; the transition (guarded status change, calendar cleanup,
// notification, events) lives in _shared/appointment-actions.ts.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getServiceKey } from "../_shared/supabase-keys.ts";
import { applyPatientAction, httpStatusFor } from "../_shared/appointment-actions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, getServiceKey());

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const { token } = body;
  if (!token) return json(400, { error: "Token requerido" });

  const { data: manageToken } = await supabase
    .from("appointment_manage_tokens")
    .select("id, appointment_id, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!manageToken) return json(404, { error: "Token inválido" });
  if (new Date(manageToken.expires_at) < new Date()) return json(410, { error: "Este enlace ha expirado" });

  const result = await applyPatientAction(supabase, {
    appointmentId: manageToken.appointment_id,
    action: "cancel",
    channel: "web",
    manageToken: token,
  });
  if (!result.ok) return json(httpStatusFor(result.code), { error: result.message_es, code: result.code });
  return json(200, { success: true, message: "Cita cancelada exitosamente" });
});
