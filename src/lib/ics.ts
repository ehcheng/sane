/**
 * RFC 5545 .ics file generator. No external dependencies.
 *
 * Timezone strategy:
 * - All timed events are stored in UTC in the database.
 * - We output them with UTC "Z" suffix (universally understood).
 * - X-WR-TIMEZONE hints the user's preferred display timezone to
 *   calendar clients (Apple Calendar, Google Calendar, Outlook).
 * - All-day events use VALUE=DATE (timezone-agnostic per RFC 5545).
 */

import { DEFAULT_EVENT_DURATION_MS } from "./date-utils";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface ICSEvent {
  uid: string;
  title: string;
  eventDate: Date;
  endDate?: Date | null;
  allDay: boolean;
  isTodo?: boolean;
  isDone?: boolean;
  location?: string | null;
  description?: string | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  /** IANA timezone hint for calendar clients (e.g. "America/New_York") */
  timezone?: string | null;
}

interface ICSFeedEvent {
  id: string;
  title: string;
  eventDate: Date;
  endDate?: Date | null;
  allDay: boolean;
  isTodo?: boolean;
  isDone?: boolean;
  location?: string | null;
  details?: string | null;
  description?: string | null;
  childName?: string | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

interface ICSFeedOptions {
  calendarName?: string;
  /** IANA timezone, e.g. "America/Los_Angeles" */
  timezone?: string | null;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Format a Date as UTC iCalendar datetime: "YYYYMMDDTHHMMSSz" */
function formatDateUTC(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Format a Date as iCalendar date-only: "YYYYMMDD" (uses UTC components) */
function formatDateOnly(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** Escape text per RFC 5545 §3.3.11 */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/**
 * RFC 5545 §3.1: Content lines should be no longer than 75 octets.
 * Long lines are folded by inserting CRLF + space.
 */
function foldLine(line: string): string {
  if (Buffer.byteLength(line, "utf-8") <= 75) return line;

  const parts: string[] = [];
  let remaining = line;

  // First line: up to 75 octets
  let cut = 75;
  while (cut > 0 && Buffer.byteLength(remaining.slice(0, cut), "utf-8") > 75) {
    cut--;
  }
  parts.push(remaining.slice(0, cut));
  remaining = remaining.slice(cut);

  // Continuation lines: SPACE prefix counts toward 75 octets, so content max = 74
  while (remaining.length > 0) {
    cut = 74;
    while (cut > 0 && Buffer.byteLength(remaining.slice(0, cut), "utf-8") > 74) {
      cut--;
    }
    parts.push(" " + remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }

  return parts.join("\r\n");
}

/** Add a line to the output, applying RFC 5545 line folding */
function pushLine(lines: string[], line: string): void {
  lines.push(foldLine(line));
}

// ---------------------------------------------------------------------------
// VEVENT builder (shared between single-event and feed)
// ---------------------------------------------------------------------------

function buildVEvent(
  uid: string,
  summary: string,
  eventDate: Date,
  allDay: boolean,
  opts: {
    endDate?: Date | null;
    location?: string | null;
    description?: string | null;
    createdAt?: Date | null;
    updatedAt?: Date | null;
  } = {}
): string[] {
  const lines: string[] = [];
  pushLine(lines, "BEGIN:VEVENT");
  pushLine(lines, `UID:${uid}`);
  pushLine(lines, `DTSTAMP:${formatDateUTC(new Date())}`);

  if (allDay) {
    pushLine(lines, `DTSTART;VALUE=DATE:${formatDateOnly(eventDate)}`);
    const endDate = new Date(eventDate);
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    pushLine(lines, `DTEND;VALUE=DATE:${formatDateOnly(endDate)}`);
  } else {
    pushLine(lines, `DTSTART:${formatDateUTC(eventDate)}`);
    // ICS requires DTEND; use 15min placeholder for events without a known duration
    const computedEnd = opts.endDate ?? new Date(eventDate.getTime() + DEFAULT_EVENT_DURATION_MS);
    pushLine(lines, `DTEND:${formatDateUTC(computedEnd)}`);
  }

  pushLine(lines, `SUMMARY:${escapeText(summary)}`);

  if (opts.location) {
    pushLine(lines, `LOCATION:${escapeText(opts.location)}`);
  }
  if (opts.description) {
    pushLine(lines, `DESCRIPTION:${escapeText(opts.description)}`);
  }
  if (opts.createdAt) {
    pushLine(lines, `CREATED:${formatDateUTC(opts.createdAt)}`);
  }
  if (opts.updatedAt) {
    pushLine(lines, `LAST-MODIFIED:${formatDateUTC(opts.updatedAt)}`);
  }

  pushLine(lines, "END:VEVENT");
  return lines;
}

// ---------------------------------------------------------------------------
// Public API: single event ICS (download)
// ---------------------------------------------------------------------------

export function generateICS(event: ICSEvent): string {
  const lines: string[] = [];
  pushLine(lines, "BEGIN:VCALENDAR");
  pushLine(lines, "VERSION:2.0");
  pushLine(lines, "PRODID:-//SANE//Calendar Event//EN");
  if (event.timezone) {
    pushLine(lines, `X-WR-TIMEZONE:${event.timezone}`);
  }
  pushLine(lines, "CALSCALE:GREGORIAN");
  pushLine(lines, "METHOD:PUBLISH");

  const donePrefix = event.isDone ? "\u2705 " : "";
  const todoPrefix = event.isTodo ? "TO-DO: " : "";
  const summary = `${donePrefix}${todoPrefix}${event.title}`;

  lines.push(
    ...buildVEvent(event.uid, summary, event.eventDate, event.allDay, {
      endDate: event.endDate,
      location: event.location,
      description: event.description,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    })
  );

  pushLine(lines, "END:VCALENDAR");
  return lines.join("\r\n");
}

// ---------------------------------------------------------------------------
// Public API: multi-event feed (subscription)
// ---------------------------------------------------------------------------

export function generateICSFeed(
  events: ICSFeedEvent[],
  options: ICSFeedOptions = {}
): string {
  const { calendarName = "SANE School Events", timezone } = options;

  const lines: string[] = [];
  pushLine(lines, "BEGIN:VCALENDAR");
  pushLine(lines, "VERSION:2.0");
  pushLine(lines, "PRODID:-//SANE//School Events//EN");
  pushLine(lines, `X-WR-CALNAME:${escapeText(calendarName)}`);
  if (timezone) {
    pushLine(lines, `X-WR-TIMEZONE:${timezone}`);
  }
  pushLine(lines, "CALSCALE:GREGORIAN");
  pushLine(lines, "METHOD:PUBLISH");

  for (const event of events) {
    const donePrefix = event.isDone ? "\u2705 " : "";
    const childPrefix = event.childName ? `[${event.childName}] ` : "";
    const todoPrefix = event.isTodo ? "TO-DO: " : "";
    const summary = `${donePrefix}${childPrefix}${todoPrefix}${event.title}`;

    lines.push(
      ...buildVEvent(`${event.id}@sane`, summary, event.eventDate, event.allDay, {
        endDate: event.endDate,
        location: event.location,
        description: event.description,
        createdAt: event.createdAt,
        updatedAt: event.updatedAt,
      })
    );
  }

  pushLine(lines, "END:VCALENDAR");
  return lines.join("\r\n");
}
