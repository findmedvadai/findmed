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

  const email = "admin@findmed.test";
  const password = "Admin123!";

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

  const userId = authData?.user?.id;
  if (!userId) {
    // User already exists, find them
    const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
    const existing = users?.find((u) => u.email === email);
    if (!existing) {
      return new Response(JSON.stringify({ error: "Could not find or create user" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Ensure rows exist
    await supabaseAdmin.from("users").upsert({ id: existing.id, role: "admin" }, { onConflict: "id" });
    await supabaseAdmin.from("user_roles").upsert(
      { user_id: existing.id, role: "admin" },
      { onConflict: "user_id,role" }
    );
    return new Response(JSON.stringify({ message: "User already exists", email, password }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Insert into users and user_roles
  await supabaseAdmin.from("users").insert({ id: userId, role: "admin" });
  await supabaseAdmin.from("user_roles").insert({ user_id: userId, role: "admin" });

  return new Response(JSON.stringify({ message: "Admin user created", email, password }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
