import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller is admin
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsErr } = await callerClient.auth.getClaims(
      authHeader.replace("Bearer ", "")
    );
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Check admin role
    const { data: isAdmin } = await adminClient.rpc("is_admin_or_superadmin", {
      _user_id: userId,
    });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      email,
      password,
      full_name,
      phone,
      address,
      city_id,
      zone_id,
      specialty_ids,
    } = body;

    if (!email || !password || !full_name) {
      return new Response(
        JSON.stringify({ error: "email, password and full_name are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Create auth user
    const { data: authUser, error: authErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (authErr) throw authErr;
    const authUserId = authUser.user.id;

    // 2. Create doctor record
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
    if (docErr) throw docErr;

    // 3. Create users record
    const { error: userErr } = await adminClient.from("users").insert({
      id: authUserId,
      role: "doctor",
      doctor_id: doctor.id,
    });
    if (userErr) throw userErr;

    // 4. Create user_roles record
    const { error: roleErr } = await adminClient.from("user_roles").insert({
      user_id: authUserId,
      role: "doctor",
    });
    if (roleErr) throw roleErr;

    // 5. Create doctor_specialties
    if (specialty_ids && specialty_ids.length > 0) {
      const rows = specialty_ids.map((sid: string) => ({
        doctor_id: doctor.id,
        specialty_id: sid,
      }));
      const { error: specErr } = await adminClient
        .from("doctor_specialties")
        .insert(rows);
      if (specErr) throw specErr;
    }

    // 6. Create default schedule settings
    const { error: settingsErr } = await adminClient
      .from("doctor_schedule_settings")
      .insert({ doctor_id: doctor.id });
    if (settingsErr) throw settingsErr;

    // 7. Create default weekly availability (Mon-Fri 09:00-17:00)
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
    if (availErr) throw availErr;

    return new Response(
      JSON.stringify({ doctor_id: doctor.id, auth_user_id: authUserId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err?.message ?? String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
