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

  // Find the existing admin user
  const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
  const admin = users?.find((u) => u.email === "admin@findmed.test");

  if (!admin) {
    return new Response(JSON.stringify({ error: "Admin user not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Update email and password
  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(admin.id, {
    email: "admin@findmed.com",
    password: "Admin123!",
    email_confirm: true,
  });

  if (updateError) {
    return new Response(JSON.stringify({ error: updateError.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Update users table
  await supabaseAdmin.from("users").update({ email: "admin@findmed.com" }).eq("id", admin.id);

  return new Response(JSON.stringify({ message: "Admin updated", email: "admin@findmed.com" }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
