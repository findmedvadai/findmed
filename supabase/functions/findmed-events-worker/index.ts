// Sends FindMed's WhatsApp templates from public.domain_outbox and finishes
// processing of stored WHAAPY webhook events (block B7).
//
// Called by pg_cron every minute, only when there is due work (migration
// 20261013140000). Auth: FINDMED_CRON_SECRET / service key (isServiceRequest);
// verify_jwt = false in config.toml.
// Secrets: WHAAPY_API_KEY, WHAAPY_API_BASE_URL.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isServiceRequest } from "../_shared/service-auth.ts";
import { getServiceKey } from "../_shared/supabase-keys.ts";
import { createWhaapyClient } from "../_shared/whaapy-client.ts";
import { handleWorker } from "./handler.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, getServiceKey());
// Longer than the default: a template send that times out becomes "uncertain".
const whaapy = createWhaapyClient({ timeoutMs: 10_000 });

Deno.serve((req) => handleWorker(req, { supabase, whaapy, isAuthorized: isServiceRequest }));
