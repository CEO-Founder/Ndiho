// Platform time zone helpers. Availability and appointments use one time zone
// (Kigali, UTC+2 all year) so patients and therapists always see the same
// wall-clock times on the server and in every browser. Safe to import client-side.

export const PLATFORM_TIMEZONE = "Africa/Kigali";
export const PLATFORM_TIMEZONE_LABEL = "Kigali time";

export function platformTimezone(): string {
  return PLATFORM_TIMEZONE;
}

/** Offset of `tz` from UTC, in minutes, at the given instant. */
export function tzOffsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** The instant of wall-clock `date` (YYYY-MM-DD) + `minute` after midnight in `tz`. */
export function zonedToUtc(date: string, minute: number, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minute);
  // Two passes settle the offset even across a DST change.
  let utc = guess - tzOffsetMinutes(tz, new Date(guess)) * 60000;
  utc = guess - tzOffsetMinutes(tz, new Date(utc)) * 60000;
  return new Date(utc);
}

/** Wall-clock date (YYYY-MM-DD) of an instant in `tz`. */
export function zonedDate(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Day of week (0 = Sunday) of a YYYY-MM-DD date. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function minuteLabel(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
