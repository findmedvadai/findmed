// Single choke point for domain events ("appointment.confirmed", …).
//
// Today it forwards to `dispatch-webhook` (which fans out to the subscribed
// webhooks). The migration to a durable outbox + WHAAPY worker (block B7)
// replaces the body of `emitEvent` only; callers don't change. New code must
// emit through here instead of calling dispatch-webhook inline.
//
// Unlike the inline fire-and-forget fetches it replaces, this awaits the
// dispatch (with a timeout) and logs non-2xx responses, so a failed delivery is
// visible in the function logs instead of disappearing.

import { getServiceKey } from "./supabase-keys.ts";

const DISPATCH_TIMEOUT_MS = 10_000;

export async function emitEvent(eventType: string, payload: Record<string, unknown>): Promise<boolean> {
  const url = Deno.env.get("SUPABASE_URL");
  try {
    const res = await fetch(`${url}/functions/v1/dispatch-webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getServiceKey()}` },
      body: JSON.stringify({ event_type: eventType, payload }),
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[events] dispatch ${eventType} failed: HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[events] dispatch ${eventType} failed:`, err);
    return false;
  }
}

/** Public base URL of the web app (for /gestionar and /reserva links). */
export function appBaseUrl(): string {
  const url = Deno.env.get("APP_URL");
  if (!url) {
    console.warn("[events] APP_URL is not set; falling back to https://app.findmed.com.mx");
    return "https://app.findmed.com.mx";
  }
  return url.replace(/\/+$/, "");
}

export function manageUrlFor(token: string | null | undefined): string | null {
  return token ? `${appBaseUrl()}/gestionar?token=${token}` : null;
}
