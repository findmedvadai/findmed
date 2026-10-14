// Admin edits a patient's insurance (insurer, policy number, "Sin seguro")
// from the appointment detail in /admin.
//
// Auth: admin/superadmin JWT verified in code with requireAdmin
// (verify_jwt = false in config.toml, same as the other admin functions).
// No extra secrets.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdmin } from "../_shared/auth.ts";
import { getServiceKey } from "../_shared/supabase-keys.ts";
import { handlePatientInsurance } from "./handler.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, getServiceKey());

Deno.serve((req) =>
  handlePatientInsurance(req, {
    supabase,
    authorize: (r) => requireAdmin(r, supabase),
  })
);
