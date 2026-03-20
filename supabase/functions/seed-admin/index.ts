import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { role = "admin" } = await req.json().catch(() => ({ role: "admin" }));

  const isDoctor = role === "doctor";
  const email = isDoctor ? "doctor@findmed.test" : "admin@findmed.com";
  const password = isDoctor ? "Doctor123!" : "Admin123!";

  // Create auth user
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError && !authError.message.includes("already been registered")) {
    return new Response(JSON.stringify({ error: authError.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let userId = authData?.user?.id;

  if (!userId) {
    const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
    const existing = users?.find((u) => u.email === email);
    if (!existing) {
      return new Response(JSON.stringify({ error: "Could not find or create user" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    userId = existing.id;
  }

  if (isDoctor) {
    // Create doctor record
    const { data: doctor } = await supabaseAdmin.from("doctors").upsert(
      { full_name: "Dr. Test Doctor", phone: "+525551234567" },
      { onConflict: "id" }
    ).select("id").single();

    const doctorId = doctor?.id;
    await supabaseAdmin.from("users").upsert({ id: userId, role: "doctor", doctor_id: doctorId }, { onConflict: "id" });
    await supabaseAdmin.from("user_roles").upsert({ user_id: userId, role: "doctor" }, { onConflict: "user_id,role" });
  } else {
    await supabaseAdmin.from("users").upsert({ id: userId, role: "admin" }, { onConflict: "id" });
    await supabaseAdmin.from("user_roles").upsert({ user_id: userId, role: "admin" }, { onConflict: "user_id,role" });
  }

  return new Response(JSON.stringify({ message: `${role} user ready`, email, password }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
