import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "unauthorized", message: "Sesión inválida" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsErr } = await callerClient.auth.getClaims(
      authHeader.replace("Bearer ", "")
    );
    if (claimsErr || !claimsData?.claims) {
      return jsonResponse({ error: "unauthorized", message: "Token inválido" }, 401);
    }
    const userId = claimsData.claims.sub as string;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: isAdmin } = await adminClient.rpc("is_admin_or_superadmin", {
      _user_id: userId,
    });
    if (!isAdmin) {
      return jsonResponse(
        { error: "forbidden", message: "Solo un administrador puede crear doctores" },
        403
      );
    }

    let body = await req.json();
    if (typeof body === "string") body = JSON.parse(body);

    const {
      password,
      full_name,
      phone,
      address,
      city_id,
      zone_id,
      specialty_ids,
    } = body;
    const email = (body.email ?? "").trim().toLowerCase();

    // Required fields validation with field-level info.
    if (!email) {
      return jsonResponse(
        { error: "missing_fields", message: "Falta el email del doctor", field: "email" },
        400
      );
    }
    if (!password) {
      return jsonResponse(
        { error: "missing_fields", message: "Falta la contraseña inicial", field: "password" },
        400
      );
    }
    if (!full_name) {
      return jsonResponse(
        { error: "missing_fields", message: "Falta el nombre completo", field: "full_name" },
        400
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return jsonResponse(
        { error: "invalid_email", message: "El formato del email no es válido (ej. doctor@findmed.com)" },
        400
      );
    }

    if (typeof password !== "string" || password.length < 6) {
      return jsonResponse(
        { error: "weak_password", message: "La contraseña debe tener al menos 6 caracteres" },
        400
      );
    }

    // 1. Create auth user — common failures: email_exists, weak_password.
    const { data: authUser, error: authErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (authErr) {
      const msg = (authErr.message ?? "").toLowerCase();
      const code = (authErr as { code?: string }).code ?? "";
      if (code === "email_exists" || msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
        return jsonResponse(
          { error: "email_taken", message: "Ese email ya está registrado en el sistema" },
          409
        );
      }
      if (code === "weak_password" || msg.includes("password")) {
        return jsonResponse(
          { error: "weak_password", message: "La contraseña no cumple los requisitos mínimos" },
          400
        );
      }
      console.error("[create-doctor] auth.admin.createUser failed:", authErr);
      return jsonResponse(
        { error: "internal_error", message: "No se pudo crear la cuenta de auth: " + authErr.message },
        500
      );
    }
    const authUserId = authUser.user.id;

    // 2. doctors row
    const { data: doctor, error: docErr } = await adminClient
      .from("doctors")
      .insert({
        full_name,
        phone: phone || null,
        address: address || null,
        city_id: city_id || null,
        zone_id: zone_id || null,
      })
      .select("id")
      .single();
    if (docErr) {
      // Best-effort: deshacer el usuario de auth para no dejar huérfano.
      await adminClient.auth.admin.deleteUser(authUserId).catch((e) =>
        console.error("[create-doctor] rollback auth user failed:", e)
      );
      console.error("[create-doctor] insert doctors failed:", docErr);
      return jsonResponse(
        { error: "internal_error", message: "No se pudo crear el registro del doctor" },
        500
      );
    }

    // 3. users row
    const { error: userErr } = await adminClient.from("users").insert({
      id: authUserId,
      role: "doctor",
      doctor_id: doctor.id,
      email,
      initial_password: password,
    });
    if (userErr) {
      await adminClient.auth.admin.deleteUser(authUserId).catch(() => {});
      await adminClient.from("doctors").delete().eq("id", doctor.id).then(() => {});
      console.error("[create-doctor] insert users failed:", userErr);
      return jsonResponse(
        { error: "internal_error", message: "No se pudo registrar el usuario del doctor" },
        500
      );
    }

    // 4. user_roles row
    const { error: roleErr } = await adminClient.from("user_roles").insert({
      user_id: authUserId,
      role: "doctor",
    });
    if (roleErr) {
      console.error("[create-doctor] insert user_roles failed:", roleErr);
      // No hacemos rollback aquí — el doctor ya está creado y funcional;
      // user_roles es secundario para auditoría.
    }

    // 5. doctor_specialties
    if (specialty_ids && specialty_ids.length > 0) {
      const rows = specialty_ids.map((sid: string) => ({
        doctor_id: doctor.id,
        specialty_id: sid,
      }));
      const { error: specErr } = await adminClient
        .from("doctor_specialties")
        .insert(rows);
      if (specErr) console.error("[create-doctor] insert specialties failed:", specErr);
    }

    // 6. default schedule settings
    const { error: settingsErr } = await adminClient
      .from("doctor_schedule_settings")
      .insert({ doctor_id: doctor.id });
    if (settingsErr) console.error("[create-doctor] insert settings failed:", settingsErr);

    // 7. default Mon-Fri 09:00-17:00
    const weekdays = [1, 2, 3, 4, 5].map((wd) => ({
      doctor_id: doctor.id,
      weekday: wd,
      start_time: "09:00",
      end_time: "17:00",
      is_enabled: true,
    }));
    const { error: availErr } = await adminClient
      .from("doctor_weekly_availability")
      .insert(weekdays);
    if (availErr) console.error("[create-doctor] insert availability failed:", availErr);

    return jsonResponse(
      { success: true, doctor_id: doctor.id, auth_user_id: authUserId },
      200
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[create-doctor] unhandled:", err);
    return jsonResponse({ error: "internal_error", message }, 500);
  }
});
