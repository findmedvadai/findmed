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

const base = Deno.env.get("SUPABASE_URL")!.replace(/\/+$/, "");
const has = (name: string) => !!Deno.env.get(name);
const integration = {
  mcpUrl: `${base}/functions/v1/findmed-mcp`,
  webhookUrl: `${base}/functions/v1/whaapy-inbound`,
  secrets: {
    FINDMED_MCP_TOKEN: has("FINDMED_MCP_TOKEN"),
    WHAAPY_API_KEY: has("WHAAPY_API_KEY"),
    WHAAPY_WEBHOOK_SECRET: has("WHAAPY_WEBHOOK_SECRET"),
    FINDMED_CRON_SECRET: has("FINDMED_CRON_SECRET"),
  },
};

Deno.serve((req) =>
  handleMessagingAdmin(req, { supabase, whaapy, integration, authorize: (r) => requireAdmin(r, supabase) })
);
