"use client";

import { useMemo } from "react";
import { useTimezone } from "@/hooks/use-timezone";
import { createFormatter } from "@/lib/date-utils";
import { ChildNameList } from "./child-name";
import type { AgendaEvent, AgendaChild } from "./types";

/** Cache time formatters by timezone to avoid repeated Intl construction. */
const timeFormatterCache = new Map<string, Intl.DateTimeFormat>();
function getTimeFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = timeFormatterCache.get(tz);
  if (!fmt) {
    fmt = createFormatter({ hour: "numeric", minute: "2-digit", hour12: true }, tz);
    timeFormatterCache.set(tz, fmt);
  }
  return fmt;
}

interface EventRowProps {
  event: AgendaEvent;
  children: AgendaChild[];
  muted?: boolean;
  onTap: (event: AgendaEvent) => void;
}

/**
 * Single event row in the agenda view.
 *
 * Layout: fixed-width time column on the left, title + metadata on the right.
 * No card chrome, borders, or shadows. Separated by divider lines at the parent level.
 *
 * Accessibility: full-width tappable area, min 64px tall.
 * Screen reader: "{time}, {title}, for {child names}, at {location}, {completed status}"
 */
export function EventRow({ event, children: allChildren, muted = false, onTap }: EventRowProps) {
  const tz = useTimezone();
  const isDone = event.isDone;
  const isPastDueTodo = event.isTodo && !event.endsAt && !isDone && new Date(event.startsAt) < new Date();

  const eventChildren = useMemo(
    () => event.children
      .map((ec) => allChildren.find((c) => c.id === ec.id))
      .filter((c): c is AgendaChild => c !== undefined),
    [event.children, allChildren]
  );

  // Format time display
  const timeLabel = getTimeLabel(event, tz);

  // Build screen-reader text
  const childNames = eventChildren.map((c) => c.name).join(", ");
  const srText = [
    timeLabel.replace(/\n/g, " "),
    event.title,
    childNames ? `for ${childNames}` : null,
    event.location ? `at ${event.location}` : null,
    isDone ? "completed" : null,
  ]
    .filter(Boolean)
    .join(", ");

  const doneClasses = isDone ? "line-through opacity-50" : "";
  const mutedClasses = muted ? "opacity-70" : "";

  return (
    <button
      type="button"
      onClick={() => onTap(event)}
      className={`flex w-full text-left gap-3 px-[var(--agenda-gutter)] py-3 min-h-[var(--agenda-touch-primary)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-agenda-accent ${mutedClasses}`}
      aria-label={srText}
    >
      {/* Time column */}
      <div
        className="flex-shrink-0 pt-0.5 font-inter text-agenda-sm text-agenda-ink-muted tabular-nums text-right"
        style={{ width: "var(--agenda-time-col)" }}
        aria-hidden="true"
      >
        {timeLabel.split("\n").map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>

      {/* Content column */}
      <div className="flex-1 min-w-0">
        {/* Title */}
        <div className={`text-agenda-title font-atkinson font-bold leading-[var(--agenda-leading-tight)] ${doneClasses}`}>
          {isPastDueTodo && (
            <span className="text-agenda-pending mr-1" aria-hidden="true">
              •
            </span>
          )}
          {event.title}
        </div>

        {/* Metadata line: child names + location */}
        {(eventChildren.length > 0 || event.location) && (
          <div className={`mt-0.5 ${isDone ? "opacity-50" : ""}`}>
            <ChildNameList
              children={eventChildren}
              location={event.location}
              muted={muted}
            />
          </div>
        )}
      </div>
    </button>
  );
}

function getTimeLabel(event: AgendaEvent, tz: string): string {
  if (event.allDay) return "All-day";

  const d = new Date(event.startsAt);
  const parts = getTimeFormatter(tz).formatToParts(d);

  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const period = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").toUpperCase();

  return `${hour}:${minute}\n${period}`;
}
