// Admin edits a patient from /admin: insurance (insurer, policy number,
// "Sin seguro") and, with action "contact", the titular's name and phone and
// the name of who is attended in an appointment. See handler.ts.
//
// Auth: admin/superadmin JWT verified in code with requireAdmin
// (verify_jwt = false in config.toml, same as the other admin functions).
// Secrets: WHAAPY_API_KEY (optional) for the WHAAPY contact sync.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdmin } from "../_shared/auth.ts";
import { getServiceKey } from "../_shared/supabase-keys.ts";
import { createWhaapyClient } from "../_shared/whaapy-client.ts";
import { handlePatientInsurance } from "./handler.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, getServiceKey());
const whaapy = createWhaapyClient();

Deno.serve((req) =>
  handlePatientInsurance(req, {
    supabase,
    authorize: (r) => requireAdmin(r, supabase),
    whaapy,
  })
);
