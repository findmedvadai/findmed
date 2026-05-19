// Shared helpers for refreshing Google and Outlook OAuth access tokens given
// a doctor office's stored refresh token.
//
// Two failure modes need different handling:
//
//   1. PERMANENT (HTTP 4xx + `error: "invalid_grant"`): the refresh token is
//      revoked/expired/superseded. Without intervention the office stays
//      "connected" in the DB forever and the UI lies. We auto-disconnect the
//      provider on this office so the doctor sees the truth and can reconnect.
//
//   2. TRANSIENT (5xx, network error, throttling): the refresh token is
//      probably fine but the provider is flaky. We log and return null so the
//      current request degrades, but we KEEP the connection in the DB.
//
// Additionally, Microsoft Identity Platform rotates refresh tokens on every
// refresh response — if we don't persist the new refresh_token the stored one
// eventually stops working. Google occasionally rotates too (re-consent). We
// persist `refresh_token` from the response back to the office row whenever
// it differs from the stored value.
//
// All callers must pass `{ supabase, office }` so the helper can perform the
// persistence and auto-disconnect side effects. The office param must include
// `id`; the connection flags and refresh token are read from it.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface CalendarFields {
  google_calendar_connected?: boolean | null;
  google_refresh_token_ref?: string | null;
  google_calendar_id?: string | null;
  outlook_calendar_connected?: boolean | null;
  outlook_refresh_token_ref?: string | null;
  outlook_calendar_id?: string | null;
}

export interface RefreshArgs {
  supabase: SupabaseClient;
  /**
   * Office row that owns the refresh token. `id` is required so we can persist
   * a rotated refresh_token or auto-disconnect on permanent failures. If `id`
   * is null (legacy doctor-level reads from the deprecated `doctors` table),
   * the helper still attempts a refresh but skips the persistence/disconnect
   * side effects — this path should be considered deprecated.
   */
  office: CalendarFields & { id: string | null };
}

type Provider = "google" | "outlook";

async function refreshAccessToken(provider: Provider, args: RefreshArgs): Promise<string | null> {
  const { supabase, office } = args;
  const refreshToken =
    provider === "google" ? office.google_refresh_token_ref : office.outlook_refresh_token_ref;
  const connectedFlag =
    provider === "google" ? office.google_calendar_connected : office.outlook_calendar_connected;

  // No token at all → nothing to refresh. Callers that need connectedFlag check
  // it themselves; we DO allow refresh during the post-OAuth pre-pick state
  // where the token exists but connected=false. That keeps the calendar-list
  // endpoint functional right after the OAuth callback.
  if (!refreshToken) return null;
  // If neither connected nor mid-OAuth, still try — being defensive is cheap.
  void connectedFlag;

  const clientId = Deno.env.get(provider === "google" ? "GOOGLE_CLIENT_ID" : "OUTLOOK_CLIENT_ID");
  const clientSecret = Deno.env.get(
    provider === "google" ? "GOOGLE_CLIENT_SECRET" : "OUTLOOK_CLIENT_SECRET"
  );
  if (!clientId || !clientSecret) {
    console.error(`[calendar-tokens] ${provider} client credentials missing in env`);
    return null;
  }

  const tokenUrl =
    provider === "google"
      ? "https://oauth2.googleapis.com/token"
      : "https://login.microsoftonline.com/common/oauth2/v2.0/token";

  const params: Record<string, string> = {
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  };
  if (provider === "outlook") {
    // Microsoft requires the scope on refresh; without it the new refresh
    // token comes back without the offline_access permission and the next
    // refresh fails.
    params.scope = "offline_access Calendars.ReadWrite";
  }

  let res: Response;
  try {
    res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
  } catch (err) {
    // Transient: network blip. Keep DB state, degrade this request.
    console.error(`[calendar-tokens] ${provider} fetch error (office=${office.id}):`, err);
    return null;
  }

  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    console.error(
      `[calendar-tokens] ${provider} non-JSON response (office=${office.id}, status=${res.status})`
    );
    // Treat as transient — we can't classify without the JSON body.
    return null;
  }

  if (!res.ok) {
    const errorCode = typeof data.error === "string" ? (data.error as string) : null;
    // Permanent failures: refresh token is no longer usable. Auto-disconnect
    // so the UI reflects reality. Codes seen in the wild:
    //   - "invalid_grant" (both Google and Microsoft) — revoked, expired,
    //     superseded by rotation, or password change.
    //   - "invalid_client" — credentials mismatch; this is a config bug, not
    //     a token issue, so we DO NOT auto-disconnect (logging is enough).
    const isPermanent = res.status >= 400 && res.status < 500 && errorCode === "invalid_grant";
    if (isPermanent && office.id) {
      console.warn(
        `[calendar-tokens] ${provider} invalid_grant for office ${office.id} — auto-disconnecting`
      );
      try {
        await supabase
          .from("doctor_offices")
          .update(
            provider === "google"
              ? {
                  google_calendar_connected: false,
                  google_calendar_id: null,
                  google_calendar_name: null,
                  google_refresh_token_ref: null,
                }
              : {
                  outlook_calendar_connected: false,
                  outlook_calendar_id: null,
                  outlook_calendar_name: null,
                  outlook_refresh_token_ref: null,
                }
          )
          .eq("id", office.id);
        // Reflect in the in-memory row too so subsequent code in the same
        // request doesn't keep treating the office as connected.
        if (provider === "google") {
          office.google_calendar_connected = false;
          office.google_calendar_id = null;
          office.google_refresh_token_ref = null;
        } else {
          office.outlook_calendar_connected = false;
          office.outlook_calendar_id = null;
          office.outlook_refresh_token_ref = null;
        }
      } catch (err) {
        console.error(`[calendar-tokens] auto-disconnect persist failed:`, err);
      }
    } else {
      console.error(
        `[calendar-tokens] ${provider} refresh failed (office=${office.id}, status=${res.status}, error=${errorCode}):`,
        data
      );
    }
    return null;
  }

  // Success. Persist rotated refresh_token if the provider returned a new one.
  // Microsoft rotates on every refresh; Google occasionally does.
  const newRefreshToken = typeof data.refresh_token === "string" ? (data.refresh_token as string) : null;
  if (newRefreshToken && newRefreshToken !== refreshToken && office.id) {
    try {
      await supabase
        .from("doctor_offices")
        .update(
          provider === "google"
            ? { google_refresh_token_ref: newRefreshToken }
            : { outlook_refresh_token_ref: newRefreshToken }
        )
        .eq("id", office.id);
      // Update the in-memory row so a second call within the same request
      // uses the new token (otherwise Microsoft would reject the old one).
      if (provider === "google") office.google_refresh_token_ref = newRefreshToken;
      else office.outlook_refresh_token_ref = newRefreshToken;
    } catch (err) {
      // Non-fatal: the access_token returned is still good for this request.
      // Worst case: next refresh tries the old token and fails. Better than
      // failing the current request.
      console.error(
        `[calendar-tokens] failed to persist rotated refresh_token (office=${office.id}):`,
        err
      );
    }
  }

  return typeof data.access_token === "string" ? (data.access_token as string) : null;
}

export function getGoogleAccessToken(args: RefreshArgs): Promise<string | null> {
  return refreshAccessToken("google", args);
}

export function getOutlookAccessToken(args: RefreshArgs): Promise<string | null> {
  return refreshAccessToken("outlook", args);
}
