// Testable core of findmed-events-worker (block B7).
//
// One run: claim due outbox rows (SKIP LOCKED + lease, so overlapping runs
// never take the same event), send each one, then retry WHAAPY webhook events
// that were stored but not processed. Stops early to stay inside the Edge
// Function time budget; whatever is left is picked up by the next run.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsonResponse } from "../_shared/cors.ts";
import { type OutboxRow, processOutboxRow } from "../_shared/messaging.ts";
import { processAndMark } from "../_shared/whaapy-events.ts";
import type { WhaapyClient } from "../_shared/whaapy-client.ts";

export const BATCH = 20;
export const LEASE_SECONDS = 120;
const BUDGET_MS = 45_000;

export interface WorkerDeps {
  supabase: SupabaseClient;
  whaapy: WhaapyClient;
  isAuthorized: (req: Request) => boolean;
  now?: () => number;
}

export async function handleWorker(req: Request, deps: WorkerDeps): Promise<Response> {
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);
  if (!deps.isAuthorized(req)) return jsonResponse({ error: "Unauthorized" }, 401);
  const now = deps.now ?? Date.now;
  const started = now();
  const outcomes: Record<string, number> = {};
  const count = (k: string) => (outcomes[k] = (outcomes[k] ?? 0) + 1);

  const { data: claimed, error } = await deps.supabase.rpc("claim_outbox", { p_limit: BATCH, p_lease_seconds: LEASE_SECONDS });
  if (error) {
    console.error("[events-worker] claim failed", error.message);
    return jsonResponse({ error: "claim_failed" }, 500);
  }
  for (const row of (claimed ?? []) as OutboxRow[]) {
    if (now() - started > BUDGET_MS) break; // lease expires → next run retakes it
    try {
      count(await processOutboxRow(deps.supabase, deps.whaapy, row));
    } catch (e) {
      console.error("[events-worker] outbox row failed", row.id, e);
      count("error");
    }
  }

  // Webhook events stored but not processed (inline processing failed or the
  // function was cut off). Older than a minute so we don't race whaapy-inbound.
  const cutoff = new Date(now() - 60_000).toISOString();
  const { data: pending } = await deps.supabase
    .from("whaapy_events")
    .select("id, event_type, payload")
    .is("processed_at", null)
    .lt("received_at", cutoff)
    .order("received_at", { ascending: true })
    .limit(50);
  let events = 0;
  for (const ev of (pending ?? []) as { id: string; event_type: string; payload: never }[]) {
    if (now() - started > BUDGET_MS) break;
    await processAndMark(deps.supabase, deps.whaapy, ev);
    events++;
  }

  const summary = { outbox: outcomes, whaapy_events: events };
  console.log(JSON.stringify({ event: "events_worker", ...summary }));
  return jsonResponse(summary);
}
