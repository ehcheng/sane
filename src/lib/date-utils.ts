/**
 * Timezone-aware date utilities for frontend display.
 *
 * All helpers accept an IANA timezone string (e.g. "America/New_York") and
 * use native Intl.DateTimeFormat under the hood. No external dependencies.
 */

/**
 * Creates a reusable Intl.DateTimeFormat for producing "YYYY-MM-DD" date keys.
 * Use this with useMemo to avoid creating a new formatter on every call in loops.
 */
export function createDateKeyFormatter(tz: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/**
 * Returns "YYYY-MM-DD" for a Date in the given timezone.
 * Accepts either an IANA timezone string (convenience, creates a one-off formatter)
 * or a pre-built formatter from createDateKeyFormatter (efficient for loops).
 */
export function toDateKey(d: Date, tzOrFmt: string | Intl.DateTimeFormat): string {
  const fmt = typeof tzOrFmt === "string" ? createDateKeyFormatter(tzOrFmt) : tzOrFmt;
  return fmt.format(d);
}

/** Shorthand for toDateKey(new Date(), tz). */
export function todayDateKey(tz: string): string {
  return toDateKey(new Date(), tz);
}

/**
 * Creates an Intl.DateTimeFormat with the given options and timezone baked in.
 * Passes `undefined` as the locale so the user's browser locale applies.
 */
export function createFormatter(
  opts: Intl.DateTimeFormatOptions,
  tz: string
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: tz });
}

/**
 * Extracts date/datetime parts from a Date in the given timezone,
 * formatted for use as `<input type="date">` or `<input type="datetime-local">` values.
 *
 * - includeTime=false: returns "YYYY-MM-DD"
 * - includeTime=true:  returns "YYYY-MM-DDTHH:mm"
 */
export function toLocalInputValue(
  d: Date,
  tz: string,
  includeTime: boolean
): string {
  const dateKey = toDateKey(d, tz);
  if (!includeTime) return dateKey;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${dateKey}T${hour}:${minute}`;
}

/**
 * Converts a user-timezone date string + time string to a UTC ISO string.
 *
 * dateStr: "YYYY-MM-DD"
 * time:    "HH:mm"
 * tz:      IANA timezone (e.g. "America/New_York")
 *
 * Strategy: construct the wall-clock datetime in the target timezone by
 * computing the UTC offset at that instant and adjusting accordingly.
 */
export function localTimeToUTC(
  dateStr: string,
  time: string,
  tz: string
): string {
  // Parse a rough UTC approximation first
  const naive = new Date(`${dateStr}T${time}:00Z`);

  // Determine the UTC offset of `tz` at that approximate instant.
  // Intl gives us the wall-clock parts; difference from UTC = offset.
  const utcParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(naive);

  const tzParts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(naive);

  const getPart = (parts: Intl.DateTimeFormatPart[], type: string) =>
    parts.find((p) => p.type === type)?.value ?? "0";

  const utcMs = Date.UTC(
    +getPart(utcParts, "year"),
    +getPart(utcParts, "month") - 1,
    +getPart(utcParts, "day"),
    +getPart(utcParts, "hour"),
    +getPart(utcParts, "minute"),
    +getPart(utcParts, "second")
  );

  const tzMs = Date.UTC(
    +getPart(tzParts, "year"),
    +getPart(tzParts, "month") - 1,
    +getPart(tzParts, "day"),
    +getPart(tzParts, "hour"),
    +getPart(tzParts, "minute"),
    +getPart(tzParts, "second")
  );

  // offset = tzMs - utcMs (positive when tz is ahead of UTC)
  const offsetMs = tzMs - utcMs;

  // The user entered dateStr+time as wall-clock in tz.
  // UTC = wall-clock - offset
  const result = new Date(naive.getTime() - offsetMs);
  return result.toISOString();
}

/**
 * Converts a user-entered date (and optional time) into a UTC ISO string.
 * Centralizes the all-day vs. timed branching used across event create/edit forms.
 *
 * - All-day events: stored as noon UTC (timezone-agnostic anchor).
 * - Timed events: input is "YYYY-MM-DDTHH:mm", interpreted in the user's timezone.
 *
 * Returns null if the input is invalid (caller should show an error toast).
 */
/** Default duration (ms) for timed events without an endDate in calendar exports (ICS, Google Calendar). */
export const DEFAULT_EVENT_DURATION_MS = 15 * 60 * 1000;

/**
 * Formats a time or time range using the given Intl formatter.
 * Returns just the start time if endDate is absent, or "start – end" if present.
 */
export function formatTimeRange(
  formatter: Intl.DateTimeFormat,
  start: Date,
  endDate?: Date | string | null,
  separator = "\u2009\u2013\u2009"
): string {
  if (!endDate) return formatter.format(start);
  const end = typeof endDate === "string" ? new Date(endDate) : endDate;
  return `${formatter.format(start)}${separator}${formatter.format(end)}`;
}

/** Returns true when end time (HH:MM) is at or before start time (wraps past midnight). */
export function endTimeWrapsToNextDay(start: string, end: string): boolean {
  if (!start || !end) return false;
  return end <= start;
}

/** Given "YYYY-MM-DD", returns the next calendar day in the same format. */
export function nextDayDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function resolveEventDate(
  input: string,
  allDay: boolean,
  tz: string
): string | null {
  if (allDay) {
    const dateStr = input.slice(0, 10);
    const d = new Date(dateStr + "T12:00:00Z");
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const tIdx = input.indexOf("T");
  if (tIdx === -1) return null;
  const datePart = input.slice(0, tIdx);
  const timePart = input.slice(tIdx + 1);
  if (!datePart || !timePart) return null;
  const iso = localTimeToUTC(datePart, timePart, tz);
  return isNaN(new Date(iso).getTime()) ? null : iso;
}
