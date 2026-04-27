// Outlook Calendar events read endpoint. Mirrors google-calendar-events:
// supports `?office_id=…` (single), `?doctor_id=…` (aggregate, admin or
// owning doctor), or no params (caller doctor's own offices).
//
// Microsoft Graph returns dateTime in UTC by default (no `Prefer` header
// sent); we append `Z` to make the ISO string unambiguous on the client.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  parseTargetParams,
  resolveOfficeForCaller,
  resolveOfficesForDoctor,
  isCallerAdmin,
  getCallerDoctorId,
  type OfficeRow,
} from "../_shared/office-resolver.ts";

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

function toUtcIso(raw: string): string {
  const trimmed = raw.replace(/\.\d+$/, "");
  return /[Z+-]\d{2}:?\d{2}?$/.test(trimmed) ? trimmed : trimmed + "Z";
}

interface ExternalEvent {
  id: string;
  office_id: string;
  office_name: string;
  summary: string;
  start: string;
  end: string;
  description: string | null;
  htmlLink: string | null;
}

async function fetchOfficeEvents(
  office: OfficeRow,
  timeMin: string,
  timeMax: string,
  clientId: string,
  clientSecret: string
): Promise<{ events: ExternalEvent[]; calendar_not_synced?: boolean }> {
  if (
    !office.outlook_calendar_connected ||
    !office.outlook_refresh_token_ref ||
    !office.outlook_calendar_id
  ) {
    return { events: [] };
  }

  const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: office.outlook_refresh_token_ref,
      grant_type: "refresh_token",
      scope: "offline_access Calendars.ReadWrite",
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) {
    console.error("Outlook token refresh failed for office", office.id, tokenData);
    return { events: [], calendar_not_synced: true };
  }

  const calendarId = encodeURIComponent(office.outlook_calendar_id);
  const url =
    `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/calendarView?` +
    new URLSearchParams({
      startDateTime: timeMin,
      endDateTime: timeMax,
      $top: "50",
      $orderby: "start/dateTime",
      $select: "id,subject,start,end,bodyPreview,webLink",
    });

  const eventsRes = await fetch(url, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  if (!eventsRes.ok) return { events: [] };
  const data = await eventsRes.json();

  const events: ExternalEvent[] = (data.value || [])
    .filter((e: any) => e.start?.dateTime)
    .map((e: any) => ({
      id: e.id,
      office_id: office.id,
      office_name: office.name,
      summary: e.subject || "Sin título",
      start: toUtcIso(e.start.dateTime),
      end: e.end?.dateTime ? toUtcIso(e.end.dateTime) : toUtcIso(e.start.dateTime),
      description: e.bodyPreview || null,
      htmlLink: e.webLink || null,
    }));

  return { events };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const OUTLOOK_CLIENT_ID = Deno.env.get("OUTLOOK_CLIENT_ID")!;
    const OUTLOOK_CLIENT_SECRET = Deno.env.get("OUTLOOK_CLIENT_SECRET")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "No autorizado" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const payload = decodeJwtPayload(token);
    if (!payload?.sub || !payload?.exp || (payload.exp as number) < Math.floor(Date.now() / 1000)) {
      return jsonResponse({ error: "Token inválido" }, 401);
    }
    const userId = payload.sub as string;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { officeId, doctorId } = parseTargetParams(req);
    const url = new URL(req.url);
    const timeMin = url.searchParams.get("timeMin");
    const timeMax = url.searchParams.get("timeMax");
    if (!timeMin || !timeMax) return jsonResponse({ error: "timeMin y timeMax requeridos" }, 400);

    let offices: OfficeRow[] = [];
    if (officeId) {
      const r = await resolveOfficeForCaller(supabase, userId, officeId);
      if ("error" in r) return jsonResponse({ error: r.error }, r.status);
      offices = [r.office];
    } else if (doctorId) {
      const r = await resolveOfficesForDoctor(supabase, userId, doctorId);
      if ("error" in r) return jsonResponse({ error: r.error }, r.status);
      offices = r.offices;
    } else {
      const callerDoctorId = await getCallerDoctorId(supabase, userId);
      const admin = await isCallerAdmin(supabase, userId);
      if (!callerDoctorId && !admin) return jsonResponse({ error: "No eres un doctor" }, 403);
      if (callerDoctorId) {
        const r = await resolveOfficesForDoctor(supabase, userId, callerDoctorId);
        if ("error" in r) return jsonResponse({ error: r.error }, r.status);
        offices = r.offices;
      }
    }

    let anyNotSynced = false;
    const results: ExternalEvent[] = [];
    for (const o of offices) {
      const r = await fetchOfficeEvents(o, timeMin, timeMax, OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET);
      if (r.calendar_not_synced) anyNotSynced = true;
      results.push(...r.events);
    }

    return jsonResponse({
      events: results,
      ...(anyNotSynced ? { error: "calendar_not_synced" } : {}),
    });
  } catch (error) {
    console.error("Error in outlook-calendar-events:", error);
    return jsonResponse(
      { events: [], error: error instanceof Error ? error.message : "Error desconocido" },
      200
    );
  }
});
