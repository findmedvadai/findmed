// Upper bound for every call to an external provider (Google Calendar,
// Microsoft Graph, OAuth token endpoints). Deno's fetch has no default
// timeout: a provider that hangs would hold the Edge Function until the
// platform kills it, after the appointment row was already written, and the
// patient would see an error for a booking that exists. All those calls are
// already inside try/catch that treat a failure as "calendar not synced" /
// "not verified", so an abort degrades exactly like a network error.

export const EXTERNAL_TIMEOUT_MS = 10_000;

export function externalTimeout(ms = EXTERNAL_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(ms);
}
