// Staff actions on patient cases (block B6). Separate from index.ts so tests
// can inject the database, the WHAAPY client and the authorization check.
//
// POST { case_id, action: "take" | "update" | "note" | "retry_pause" | "resolve", ... }
// → 200 { case, warnings[] } | 4xx { error, message }

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyStaffAction, PRIORITIES, type StaffAction } from "../_shared/cases.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import type { WhaapyClient } from "../_shared/whaapy-client.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UPDATE_STATUSES = ["awaiting_assignment", "assigned", "awaiting_patient", "awaiting_provider"];

export interface CaseActionDeps {
  supabase: SupabaseClient;
  whaapy: WhaapyClient;
  authorize: (req: Request) => Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }>;
}

const STATUS_FOR: Record<string, number> = {
  not_found: 404,
  case_closed: 409,
  already_assigned: 409,
  concurrent_change: 409,
};

function parseAction(b: Record<string, unknown>): StaffAction | string {
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  switch (b.action) {
    case "take":
      return { action: "take", reassign: b.reassign === true };
    case "update": {
      const status = str(b.status);
      if (status !== undefined && !UPDATE_STATUSES.includes(status)) return "status inválido";
      const priority = str(b.priority);
      if (priority !== undefined && !(PRIORITIES as readonly string[]).includes(priority)) return "priority inválida";
      if (b.next_action !== undefined && b.next_action !== null && typeof b.next_action !== "string") return "next_action inválido";
      if (b.due_at !== undefined && b.due_at !== null && typeof b.due_at !== "string") return "due_at inválido";
      return {
        action: "update",
        status: status as "awaiting_assignment" | "assigned" | "awaiting_patient" | "awaiting_provider" | undefined,
        priority: priority as (typeof PRIORITIES)[number] | undefined,
        next_action: b.next_action as string | null | undefined,
        due_at: b.due_at as string | null | undefined,
      };
    }
    case "note":
      return typeof b.text === "string" ? { action: "note", text: b.text } : "text requerido";
    case "retry_pause":
      return { action: "retry_pause" };
    case "resolve":
      if (b.outcome !== "resolved" && b.outcome !== "closed") return "outcome debe ser resolved o closed";
      if (typeof b.reason !== "string") return "reason requerido";
      return { action: "resolve", outcome: b.outcome, reason: b.reason, resume_ai: b.resume_ai !== false };
    default:
      return "action inválida";
  }
}

export async function handleCaseActions(req: Request, deps: CaseActionDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const auth = await deps.authorize(req);
  if (!auth.ok) return jsonResponse({ error: auth.status === 403 ? "forbidden" : "unauthorized", message: auth.error }, auth.status);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json", message: "Cuerpo inválido" }, 400);
  }
  if (typeof body.case_id !== "string" || !UUID_RE.test(body.case_id)) {
    return jsonResponse({ error: "invalid_case_id", message: "case_id inválido" }, 400);
  }
  const action = parseAction(body);
  if (typeof action === "string") return jsonResponse({ error: "invalid_action", message: action }, 400);

  const { data: me } = await deps.supabase.from("users").select("email").eq("id", auth.userId).maybeSingle();
  const r = await applyStaffAction(deps.supabase, deps.whaapy, body.case_id, {
    userId: auth.userId,
    email: (me as { email: string | null } | null)?.email ?? null,
  }, action);

  if (!r.ok) return jsonResponse({ error: r.code, message: r.message_es }, STATUS_FOR[r.code] ?? 400);
  return jsonResponse({ case: r.case, warnings: r.warnings });
}
