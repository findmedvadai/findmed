// Sincroniza credenciales del doctor entre auth.users y public.users.
//
// Patrón de actualización: primero public.users (nuestra DB, rollback trivial),
// luego auth.users vía Admin API. Si auth.users falla, deshacemos public.users
// para no dejar las dos tablas desincronizadas — la causa raíz del bug que dio
// origen a esta EF.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/auth.ts";

interface Body {
  doctor_id: string;
  email?: string;
  password?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const auth = await requireAdmin(req, supabase);
  if (!auth.ok) {
    const code = auth.status === 403 ? "forbidden" : "unauthorized";
    const message = auth.status === 403
      ? "Solo un administrador puede cambiar credenciales"
      : "Sesión inválida o expirada";
    return jsonResponse({ error: code, message }, auth.status);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const doctorId = body.doctor_id;
  const newEmail = body.email?.trim().toLowerCase() || undefined;
  const newPassword = body.password?.trim() || undefined;

  if (!doctorId) return jsonResponse({ error: "doctor_id requerido" }, 400);
  if (!newEmail && !newPassword) {
    return jsonResponse({ error: "Provee email o password (al menos uno)" }, 400);
  }

  if (newEmail) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      return jsonResponse(
        { error: "invalid_email", message: "Formato de email inválido" },
        400
      );
    }
  }

  if (newPassword && newPassword.length < 6) {
    return jsonResponse(
      { error: "weak_password", message: "La contraseña debe tener al menos 6 caracteres" },
      400
    );
  }

  // Resolve auth_user_id (= public.users.id, FK a auth.users.id) from doctor_id.
  const { data: userRow, error: userErr } = await supabase
    .from("users")
    .select("id, email, initial_password")
    .eq("doctor_id", doctorId)
    .maybeSingle();

  if (userErr || !userRow) {
    return jsonResponse(
      { error: "user_not_found", message: "No se encontró el usuario asociado al doctor" },
      404
    );
  }

  const authUserId = userRow.id;
  const previousEmail = userRow.email as string | null;
  const previousPassword = userRow.initial_password as string | null;

  // Detect actual changes — el caller puede mandar el mismo email sin querer.
  const willChangeEmail = !!newEmail && newEmail !== previousEmail;
  const willChangePassword = !!newPassword;

  if (!willChangeEmail && !willChangePassword) {
    return jsonResponse({ success: true, no_changes: true });
  }

  // Pre-check: el email nuevo no debe pertenecer a otro usuario en public.users.
  if (willChangeEmail) {
    const { data: collision } = await supabase
      .from("users")
      .select("id")
      .eq("email", newEmail)
      .neq("id", authUserId)
      .maybeSingle();
    if (collision) {
      return jsonResponse(
        { error: "email_taken", message: "Ese email ya está en uso por otro usuario" },
        409
      );
    }
  }

  // Step 1: update public.users.
  const publicUpdates: Record<string, string> = {};
  if (willChangeEmail) publicUpdates.email = newEmail!;
  if (willChangePassword) publicUpdates.initial_password = newPassword!;

  const { error: pubErr } = await supabase
    .from("users")
    .update(publicUpdates)
    .eq("id", authUserId);

  if (pubErr) {
    if (pubErr.code === "23505") {
      return jsonResponse(
        { error: "email_taken", message: "Ese email ya está en uso por otro usuario" },
        409
      );
    }
    console.error("[update-doctor-credentials] public.users update failed:", pubErr);
    return jsonResponse(
      { error: "public_update_failed", message: pubErr.message },
      500
    );
  }

  // Step 2: update auth.users via Admin API.
  const authUpdates: { email?: string; password?: string } = {};
  if (willChangeEmail) authUpdates.email = newEmail!;
  if (willChangePassword) authUpdates.password = newPassword!;

  const { error: authErr } = await supabase.auth.admin.updateUserById(
    authUserId,
    authUpdates
  );

  if (authErr) {
    // Rollback public.users so we don't leave the two tables desynced — that's
    // the exact bug we're fixing.
    const rollback: Record<string, string | null> = {};
    if (willChangeEmail) rollback.email = previousEmail;
    if (willChangePassword) rollback.initial_password = previousPassword;
    await supabase
      .from("users")
      .update(rollback)
      .eq("id", authUserId)
      .then(() => {})
      .catch((e) => console.error("[update-doctor-credentials] rollback failed:", e));

    const msg = (authErr.message ?? "").toLowerCase();
    if (msg.includes("already") || msg.includes("exists") || msg.includes("registered")) {
      return jsonResponse(
        { error: "email_taken", message: "Ese email ya está registrado en el sistema de auth" },
        409
      );
    }
    console.error("[update-doctor-credentials] auth update failed:", authErr);
    return jsonResponse(
      { error: "auth_update_failed", message: authErr.message },
      500
    );
  }

  return jsonResponse({
    success: true,
    email_changed: willChangeEmail,
    password_changed: willChangePassword,
  });
});
