// Patient search for the admin "create appointment" dialog.
// Matches by full_name (ILIKE) or by phone (last 10 digits).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const auth = await requireAdmin(req, supabase);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

  let body: { query?: string; limit?: number };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const rawQuery = (body.query ?? "").trim();
  const limit = Math.min(Math.max(body.limit ?? 8, 1), 25);

  if (rawQuery.length < 2) {
    return jsonResponse({ patients: [] });
  }

  const phoneDigits = rawQuery.replace(/\D/g, "");
  // We OR by name (ILIKE) and phone (suffix match) so the admin can paste either.
  const filters: string[] = [`full_name.ilike.%${rawQuery}%`];
  if (phoneDigits.length >= 4) {
    filters.push(`phone.ilike.%${phoneDigits}%`);
  }

  const { data, error } = await supabase
    .from("patients")
    .select("id, full_name, phone")
    .or(filters.join(","))
    .order("full_name", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[admin-search-patients] query failed:", error);
    return jsonResponse({ error: "Search failed" }, 500);
  }

  return jsonResponse({ patients: data ?? [] });
});
