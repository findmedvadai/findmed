import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { getServiceKey, getPublishableKey } from "../_shared/supabase-keys.ts";
import { provisionDoctor } from "./provision.ts";

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
    const serviceRoleKey = getServiceKey();
    const anonKey = getPublishableKey();

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

    // Validate BEFORE creating anything: a malformed list used to throw after
    // the auth user existed, leaving a half-created doctor.
    const specialtyIds: unknown = specialty_ids ?? [];
    if (!Array.isArray(specialtyIds) || specialtyIds.some((s) => typeof s !== "string" || !s)) {
      return jsonResponse(
        { error: "invalid_input", message: "La lista de especialidades no es válida", field: "specialty_ids" },
        400
      );
    }

    // All or nothing: any failing step undoes the whole sign-up and the admin
    // gets a clear message (see provision.ts, F11).
    const result = await provisionDoctor(adminClient, adminClient.auth.admin, {
      email,
      password,
      full_name,
      phone: phone || null,
      address: address || null,
      city_id: city_id || null,
      zone_id: zone_id || null,
      specialty_ids: [...new Set(specialtyIds as string[])],
    });
    if (!result.ok) {
      return jsonResponse({ error: result.error, message: result.message }, result.status);
    }

    return jsonResponse(
      { success: true, doctor_id: result.doctorId, auth_user_id: result.authUserId, office_id: result.officeId },
      200
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[create-doctor] unhandled:", err);
    return jsonResponse({ error: "internal_error", message }, 500);
  }
});
