// Triage catalog admin (Configuración → Catálogos → Triaje): validated writes
// to triage_findmed / triage_specialty_map, change log (triage_changes) and the
// "Probar triaje" panel, which runs the real engine (_shared/triage.ts).
//
// Auth: admin/superadmin JWT verified in code (verify_jwt = false in
// config.toml, same as the other admin functions). No extra secrets.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdmin } from "../_shared/auth.ts";
import { getServiceKey } from "../_shared/supabase-keys.ts";
import { handleTriageAdmin } from "./handler.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, getServiceKey());

Deno.serve((req) => handleTriageAdmin(req, { supabase, authorize: (r) => requireAdmin(r, supabase) }));
