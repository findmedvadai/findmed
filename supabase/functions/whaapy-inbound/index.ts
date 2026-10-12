// Receives WHAAPY webhooks (block B7). Phase 1: verify, deduplicate and store
// every event in public.whaapy_events, answering fast (WHAAPY times out at 30 s
// and retries up to 3 times). Processing (delivery receipts for the messaging
// center, handoff/conversation state, WhatsApp button replies) reads from that
// table in later blocks, so a processing bug never loses an event.
//
//   POST https://<project>.supabase.co/functions/v1/whaapy-inbound
// Secret: WHAAPY_WEBHOOK_SECRET (shown by WHAAPY when the webhook is created).
// verify_jwt is false in config.toml: WHAAPY authenticates with its HMAC.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getServiceKey } from "../_shared/supabase-keys.ts";
import { handleWhaapyInbound } from "./handler.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, getServiceKey());

Deno.serve((req) => handleWhaapyInbound(req, { supabase, secret: Deno.env.get("WHAAPY_WEBHOOK_SECRET") ?? "" }));
