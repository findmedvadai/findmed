// Admin messaging center (/admin/mensajeria): WHAAPY template catalog,
// event → template mapping, owner per event, manual resend.
// Auth: admin/superadmin JWT verified in code (verify_jwt = false in config.toml).
// Secrets: WHAAPY_API_KEY, WHAAPY_API_BASE_URL.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdmin } from "../_shared/auth.ts";
import { getServiceKey } from "../_shared/supabase-keys.ts";
import { createWhaapyClient } from "../_shared/whaapy-client.ts";
import { handleMessagingAdmin } from "./handler.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, getServiceKey());
const whaapy = createWhaapyClient({ timeoutMs: 10_000 });

Deno.serve((req) => handleMessagingAdmin(req, { supabase, whaapy, authorize: (r) => requireAdmin(r, supabase) }));
