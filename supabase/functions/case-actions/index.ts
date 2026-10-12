// Staff actions on patient cases (/admin/casos): take, update, note,
// retry AI pause, resolve/close (optionally resuming the AI).
//
// Auth: admin/superadmin JWT, verified in code (verify_jwt = false in
// config.toml, same as the other admin functions).
// Secrets: WHAAPY_API_KEY / WHAAPY_API_BASE_URL for the WHAAPY side effects;
// without them the case still works in FindMed and the response warns.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdmin } from "../_shared/auth.ts";
import { getServiceKey } from "../_shared/supabase-keys.ts";
import { createWhaapyClient } from "../_shared/whaapy-client.ts";
import { handleCaseActions } from "./handler.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, getServiceKey());
const whaapy = createWhaapyClient();

Deno.serve((req) =>
  handleCaseActions(req, {
    supabase,
    whaapy,
    authorize: (r) => requireAdmin(r, supabase),
  })
);
