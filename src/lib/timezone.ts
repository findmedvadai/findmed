import { format, startOfWeek, endOfWeek } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";

export const MEXICO_TZ = "America/Mexico_City";

/** Formats an instant in CDMX local time. Pass `{ locale: es }` via `opts` for Spanish formats. */
export function formatMx(date: Date, fmt: string, opts?: Parameters<typeof format>[2]): string {
  return format(toZonedTime(date, MEXICO_TZ), fmt, opts);
}

/** Returns the CDMX hour (0-23) of an instant. */
export function getMexicoHours(date: Date): number {
  return toZonedTime(date, MEXICO_TZ).getHours();
}

/** Returns the CDMX minute (0-59) of an instant. */
export function getMexicoMinutes(date: Date): number {
  return toZonedTime(date, MEXICO_TZ).getMinutes();
}

/** Compares two instants by their CDMX calendar day, regardless of the browser's TZ. */
export function isSameMexicoDay(a: Date, b: Date): boolean {
  return formatMx(a, "yyyy-MM-dd") === formatMx(b, "yyyy-MM-dd");
}

/**
 * Returns the CDMX week boundaries for the week containing `instant`, expressed
 * as absolute UTC instants. weekStartsOn: 0 = Sunday.
 */
export function getMexicoWeekBounds(instant: Date): { start: Date; end: Date } {
  const cdmxNaive = toZonedTime(instant, MEXICO_TZ);
  const startNaive = startOfWeek(cdmxNaive, { weekStartsOn: 0 });
  const endNaive = endOfWeek(cdmxNaive, { weekStartsOn: 0 });
  return {
    start: fromZonedTime(startNaive, MEXICO_TZ),
    end: fromZonedTime(endNaive, MEXICO_TZ),
  };
}

/**
 * Builds an ISO 8601 timestamp string from a CDMX-local date and time. The result
 * carries the explicit `-06:00` offset so it is unambiguous. Use when the user input
 * is `YYYY-MM-DD` + `HH:mm` in CDMX local time.
 */
export function buildMexicoIso(dateYmd: string, timeHm: string): string {
  return `${dateYmd}T${timeHm}:00-06:00`;
}

/**
 * Normalizes a possibly-naive ISO string from a third-party API into a UTC ISO 8601
 * string with a trailing `Z`. If the input already carries an offset (`Z` or `±HH:MM`)
 * it is returned unchanged after trimming fractional seconds (which `parseISO` from
 * date-fns does not parse reliably with 7-digit precision).
 */
export function toUtcIso(raw: string): string {
  const trimmed = raw.replace(/\.\d+$/, "");
  return /[Z+-]\d{2}:?\d{2}?$/.test(trimmed) ? trimmed : trimmed + "Z";
}
