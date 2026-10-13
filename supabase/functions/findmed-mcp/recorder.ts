// Turns an MCP request record into a public.mcp_requests row (admin AI
// dashboard). Separate from index.ts so it can be tested.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isValidNormalizedPhone, normalizeMxPhone } from "../_shared/phone.ts";
import type { McpRecord } from "./server.ts";

const MAX_RESULT_CHARS = 16_000;

export function toRow(e: McpRecord): Record<string, unknown> {
  const rawPhone = typeof e.arguments?.phone === "string" ? e.arguments.phone : null;
  const phone = rawPhone ? normalizeMxPhone(rawPhone) : null;
  let result: unknown = e.result ?? null;
  if (result !== null) {
    const text = JSON.stringify(result);
    if (text.length > MAX_RESULT_CHARS) result = { truncated: true, preview: text.slice(0, MAX_RESULT_CHARS) };
  }
  return {
    kind: e.kind,
    method: e.method ?? null,
    tool_name: e.tool_name ?? null,
    subject_phone: phone && isValidNormalizedPhone(phone) ? phone : null,
    arguments: e.arguments ?? null,
    ok: e.ok,
    status: e.status ?? null,
    error_code: e.error_code ?? null,
    error_message: e.error_message ?? null,
    duration_ms: e.duration_ms ?? null,
    trace_id: e.trace_id ?? null,
    result,
    client: e.client?.slice(0, 200) ?? null,
  };
}

/** Recorder that never delays the reply: the insert runs in the background. */
export function makeRecorder(supabase: SupabaseClient): (e: McpRecord) => void {
  return (e) => {
    const p = (async () => {
      const { error } = await supabase.from("mcp_requests").insert(toRow(e));
      if (error) console.error("[findmed-mcp] mcp_requests insert failed", error.message);
    })();
    const rt = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
    if (rt) rt.waitUntil(p);
  };
}
