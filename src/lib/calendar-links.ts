/**
 * Generate deep links for external calendar services.
 */

import { DEFAULT_EVENT_DURATION_MS } from "./date-utils";

interface CalendarEvent {
  title: string;
  eventDate: Date;
  endDate?: Date | null;
  allDay: boolean;
  isTodo?: boolean;
  location?: string | null;
  description?: string | null;
}

function formatGoogleDate(d: Date, allDay: boolean): string {
  if (allDay) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}${m}${day}`;
  }
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function buildGoogleCalendarUrl(event: CalendarEvent): string {
  const start = formatGoogleDate(event.eventDate, event.allDay);
  let end: string;

  if (event.allDay) {
    const endDate = new Date(event.eventDate);
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    end = formatGoogleDate(endDate, true);
  } else {
    const computedEnd = event.endDate ?? new Date(event.eventDate.getTime() + DEFAULT_EVENT_DURATION_MS);
    end = formatGoogleDate(computedEnd, false);
  }

  const displayTitle = event.isTodo ? `TO-DO: ${event.title}` : event.title;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: displayTitle,
    dates: `${start}/${end}`,
  });

  if (event.location) {
    params.set("location", event.location);
  }
  if (event.description) {
    params.set("details", event.description);
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
