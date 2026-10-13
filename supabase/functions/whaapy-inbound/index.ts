// Receives WHAAPY webhooks (block B7): verify, deduplicate and store every
// event in public.whaapy_events, then process it (delivery receipts, FindMed
// confirm/cancel buttons — _shared/whaapy-events.ts). Storing comes first, so
// a processing bug never loses an event: findmed-events-worker retries rows
// left unprocessed. WHAAPY times out at 30 s and retries up to 3 times.
//
//   POST https://<project>.supabase.co/functions/v1/whaapy-inbound
// Secret: WHAAPY_WEBHOOK_SECRET (shown by WHAAPY when the webhook is created).
// verify_jwt is false in config.toml: WHAAPY authenticates with its HMAC.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getServiceKey } from "../_shared/supabase-keys.ts";
import { createWhaapyClient } from "../_shared/whaapy-client.ts";
import { handleWhaapyInbound } from "./handler.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, getServiceKey());

const whaapy = createWhaapyClient();

Deno.serve((req) =>
  handleWhaapyInbound(req, { supabase, whaapy, secret: Deno.env.get("WHAAPY_WEBHOOK_SECRET") ?? "" })
);
