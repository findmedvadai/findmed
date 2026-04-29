// Returns true when [start_at, end_at) is fully covered by at least one
// enabled `doctor_weekly_availability` block of the given office on the
// requested weekday. Used as a soft check — callers that want to allow
// override surface a warning to the user instead of rejecting.
//
// CDMX is the canonical timezone for availability blocks. We derive the
// weekday and HH:mm of start/end from the appointment's instant in CDMX.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface AvailabilityCheckResult {
  withinAvailability: boolean;
  /** All enabled blocks for the requested weekday (for displaying to the user). */
  blocksForWeekday: { start_time: string; end_time: string }[];
  weekday: number;
}

function toCdmxParts(iso: string): { weekday: number; minutes: number } {
  const date = new Date(iso);
  // Build CDMX-local weekday + HH:mm via Intl, since Deno's Date methods are
  // local-to-runtime which is unreliable.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const wdName = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const h = parseInt(parts.find((p) => p.type === "hour")!.value, 10);
  const m = parseInt(parts.find((p) => p.type === "minute")!.value, 10);
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { weekday: wdMap[wdName] ?? 0, minutes: h * 60 + m };
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export async function checkAvailability(
  supabase: SupabaseClient,
  officeId: string,
  startAt: string,
  endAt: string
): Promise<AvailabilityCheckResult> {
  const start = toCdmxParts(startAt);
  const end = toCdmxParts(endAt);

  // If start and end fall on different CDMX weekdays (rare overnight case)
  // we treat as outside availability — current weekly schema doesn't model
  // overnight blocks anyway.
  const weekday = start.weekday;
  if (end.weekday !== start.weekday) {
    return { withinAvailability: false, blocksForWeekday: [], weekday };
  }

  const { data: blocks } = await supabase
    .from("doctor_weekly_availability")
    .select("start_time, end_time")
    .eq("office_id", officeId)
    .eq("weekday", weekday)
    .eq("is_enabled", true);

  const list = (blocks ?? []) as { start_time: string; end_time: string }[];

  const within = list.some((b) => {
    const bs = timeToMinutes(b.start_time);
    const be = timeToMinutes(b.end_time);
    return start.minutes >= bs && end.minutes <= be;
  });

  return { withinAvailability: within, blocksForWeekday: list, weekday };
}
