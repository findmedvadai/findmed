// Wall-clock helpers for America/Mexico_City (fixed UTC-06:00: Mexico abolished
// DST in 2022). Patient-facing flows exchange a local date ("YYYY-MM-DD") and a
// local time ("HH:mm"); these helpers turn them into absolute instants so that
// overlap checks compare real timestamps instead of minutes-of-day strings.
//
// NOTE: offices outside the CDMX zone (Quintana Roo -05, Sonora/BC -07, the
// northern border with US DST) are not modeled yet — every flow in the app
// still assumes CDMX. Changing that is a separate, app-wide refactor.

export const MX_OFFSET = "-06:00";
const MX_OFFSET_MS = -6 * 60 * 60 * 1000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidLocalDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(date);
}

export function isValidLocalTime(hm: string): boolean {
  return TIME_RE.test(hm);
}

/** "2026-10-12", "09:30" -> epoch ms of that CDMX wall-clock moment. */
export function mxLocalToMs(date: string, hm: string): number {
  return Date.parse(`${date}T${hm}:00${MX_OFFSET}`);
}

/** Epoch ms -> "YYYY-MM-DDTHH:mm:00-06:00" (CDMX wall clock, explicit offset). */
export function msToMxIso(ms: number): string {
  const local = new Date(ms + MX_OFFSET_MS).toISOString(); // shifted, read as wall clock
  return `${local.slice(0, 16)}:00${MX_OFFSET}`;
}

/** [start, end) of a CDMX calendar day as epoch ms. */
export function mxDayBoundsMs(date: string): { startMs: number; endMs: number } {
  const startMs = mxLocalToMs(date, "00:00");
  return { startMs, endMs: startMs + 24 * 60 * 60 * 1000 };
}

/** Today's date in CDMX as "YYYY-MM-DD". */
export function mxToday(now = Date.now()): string {
  return new Date(now + MX_OFFSET_MS).toISOString().slice(0, 10);
}
