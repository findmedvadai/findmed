// Durable recording of calendar connection lifecycle events.
//
// Writes to `public.calendar_connection_events` — an append-only audit log that
// does NOT rotate with Edge Function logs. This is the store that survives long
// enough to investigate a disconnect that happened weeks ago (see the migration
// 20260701120000_calendar_connection_events.sql for the full rationale).
//
// Both recorders are BEST-EFFORT: a logging failure must never change the
// disconnect/connect outcome the caller was performing. They swallow errors
// (logging them) and never throw.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type Provider = "google" | "outlook";

interface AutoDisconnectArgs {
  provider: Provider;
  officeId: string;
  doctorId?: string | null;
  /** Provider error code that triggered the disconnect (e.g. "invalid_grant"). */
  reasonCode?: string | null;
  /** HTTP status of the failed token refresh. */
  httpStatus?: number | null;
  /** Full provider JSON body, stored verbatim so the actual reason is preserved. */
  providerResponse?: unknown;
  /** Office's stored connect timestamp, so token lifetime is derivable. */
  connectedAt?: string | null;
}

interface ManualDisconnectArgs {
  provider: Provider;
  officeId: string;
  doctorId?: string | null;
  /** Who triggered the manual disconnect. */
  actorUserId?: string | null;
  actorRole?: string | null;
  connectedAt?: string | null;
}

/**
 * Record an automatic disconnect — the provider invalidated the refresh token
 * and the office was flipped to disconnected. Never throws.
 */
export async function recordAutoDisconnect(
  supabase: SupabaseClient,
  args: AutoDisconnectArgs
): Promise<void> {
  try {
    const { error } = await supabase.from("calendar_connection_events").insert({
      provider: args.provider,
      event_type: "auto_disconnect",
      office_id: args.officeId,
      doctor_id: args.doctorId ?? null,
      reason_code: args.reasonCode ?? null,
      http_status: args.httpStatus ?? null,
      provider_response: args.providerResponse ?? null,
      connected_at: args.connectedAt ?? null,
    });
    if (error) {
      console.error("[connection-events] auto_disconnect insert failed:", error);
    }
  } catch (err) {
    console.error("[connection-events] auto_disconnect insert threw:", err);
  }
}

/**
 * Record a manual disconnect — a doctor or admin dropped the connection via
 * doctor-office-update. Never throws.
 */
export async function recordManualDisconnect(
  supabase: SupabaseClient,
  args: ManualDisconnectArgs
): Promise<void> {
  try {
    const { error } = await supabase.from("calendar_connection_events").insert({
      provider: args.provider,
      event_type: "manual_disconnect",
      office_id: args.officeId,
      doctor_id: args.doctorId ?? null,
      reason_code: "manual",
      actor_user_id: args.actorUserId ?? null,
      actor_role: args.actorRole ?? null,
      connected_at: args.connectedAt ?? null,
    });
    if (error) {
      console.error("[connection-events] manual_disconnect insert failed:", error);
    }
  } catch (err) {
    console.error("[connection-events] manual_disconnect insert threw:", err);
  }
}
