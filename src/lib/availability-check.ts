// Frontend twin of supabase/functions/_shared/availability-check.ts. Used by
// dialogs that want to warn the user *before* hitting the Edge Function.
//
// Returns whether the requested [start, end) interval falls within any
// enabled weekly availability block for the office in CDMX local time.
import { supabase } from "@/integrations/supabase/client";
import { formatMx } from "@/lib/timezone";

export interface AvailabilityResult {
  withinAvailability: boolean;
  blocksForWeekday: { start_time: string; end_time: string }[];
  weekday: number;
}

const WEEKDAY_LABELS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export function weekdayLabel(weekday: number): string {
  return WEEKDAY_LABELS[weekday] ?? "";
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

const WD_MAP: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export async function checkAvailability(
  officeId: string,
  startAt: Date,
  endAt: Date
): Promise<AvailabilityResult> {
  // CDMX-local weekday + time. We use formatMx with "EEE" since the weekday
  // index in date-fns is locale-dependent.
  const wdStart = WD_MAP[formatMx(startAt, "EEE")] ?? 0;
  const wdEnd = WD_MAP[formatMx(endAt, "EEE")] ?? 0;
  const startMinutes = timeToMinutes(formatMx(startAt, "HH:mm"));
  const endMinutes = timeToMinutes(formatMx(endAt, "HH:mm"));

  if (wdEnd !== wdStart) {
    return { withinAvailability: false, blocksForWeekday: [], weekday: wdStart };
  }

  const { data } = await supabase
    .from("doctor_weekly_availability")
    .select("start_time, end_time")
    .eq("office_id", officeId)
    .eq("weekday", wdStart)
    .eq("is_enabled", true);

  const list = (data ?? []) as { start_time: string; end_time: string }[];
  const within = list.some((b) => {
    const bs = timeToMinutes(b.start_time);
    const be = timeToMinutes(b.end_time);
    return startMinutes >= bs && endMinutes <= be;
  });

  return { withinAvailability: within, blocksForWeekday: list, weekday: wdStart };
}
