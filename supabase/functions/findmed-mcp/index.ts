// FindMed MCP endpoint consumed by the WHAAPY agent.
//   POST/DELETE https://<project>.supabase.co/functions/v1/findmed-mcp
//   Authorization: Bearer <FINDMED_MCP_TOKEN>
//
// Secrets (set with `supabase secrets set`, never in the repo):
//   FINDMED_MCP_TOKEN — shared bearer configured in WHAAPY's MCP connector.
//   MCP_CHAT_ACTIONS_ENABLED — "true" publishes commit_appointment_action (default off, A4).
// verify_jwt is false in config.toml: the bearer is not a Supabase JWT.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getServiceKey } from "../_shared/supabase-keys.ts";
import { handleMcpRequest } from "./server.ts";
import { buildTools } from "./tools.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, getServiceKey());
const tools = buildTools({ chatActions: Deno.env.get("MCP_CHAT_ACTIONS_ENABLED") === "true" });

Deno.serve((req) =>
  handleMcpRequest(req, {
    token: Deno.env.get("FINDMED_MCP_TOKEN") ?? "",
    supabase,
    tools,
  })
);
