// Public redirect URI for the Google Calendar OAuth flow.
//
// Points to app.findmed.com.mx (the production frontend domain) instead of the
// internal *.supabase.co host so that Google's consent screen shows the FindMed
// domain to the user. Vercel proxies this path back to the
// `google-calendar-callback` Edge Function via a rewrite in `vercel.json`.
//
// CRITICAL: this exact string is sent to Google in BOTH places:
//   1. google-calendar-auth   → when building the authorization URL.
//   2. google-calendar-callback → when exchanging code→token.
// Both functions import this single constant precisely so the two values can
// never drift; any difference between them triggers `redirect_uri_mismatch`.
//
// The frontend origin (localhost / staging / prod) travels in the OAuth
// `state`, NOT in the redirect_uri, so a single production redirect URI works
// for every environment: the callback redirects back to the origin from state.
//
// Optional override: set the `GOOGLE_OAUTH_REDIRECT_URI` Edge Function secret
// (project-level, so both functions read the same value) to change the domain
// without a code deploy. Defaults to the production proxy URL.
const DEFAULT_GOOGLE_CALENDAR_REDIRECT_URI =
  "https://app.findmed.com.mx/oauth/google/callback";

export function getGoogleCalendarRedirectUri(): string {
  return (
    Deno.env.get("GOOGLE_OAUTH_REDIRECT_URI") ??
    DEFAULT_GOOGLE_CALENDAR_REDIRECT_URI
  );
}
