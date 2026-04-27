// Shared helpers for refreshing Google and Outlook OAuth access tokens given
// a doctor's stored refresh token. Returns null on any failure so callers can
// degrade gracefully (e.g. skip external calendar sync).

interface DoctorCalendarRow {
  google_calendar_connected?: boolean | null;
  google_refresh_token_ref?: string | null;
  google_calendar_id?: string | null;
  outlook_calendar_connected?: boolean | null;
  outlook_refresh_token_ref?: string | null;
  outlook_calendar_id?: string | null;
}

export async function getGoogleAccessToken(doctor: DoctorCalendarRow): Promise<string | null> {
  if (!doctor.google_calendar_connected || !doctor.google_refresh_token_ref) return null;
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: doctor.google_refresh_token_ref,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

export async function getOutlookAccessToken(doctor: DoctorCalendarRow): Promise<string | null> {
  if (!doctor.outlook_calendar_connected || !doctor.outlook_refresh_token_ref) return null;
  const clientId = Deno.env.get("OUTLOOK_CLIENT_ID");
  const clientSecret = Deno.env.get("OUTLOOK_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  try {
    const res = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: doctor.outlook_refresh_token_ref,
        grant_type: "refresh_token",
        scope: "offline_access Calendars.ReadWrite",
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.access_token ?? null;
  } catch {
    return null;
  }
}
