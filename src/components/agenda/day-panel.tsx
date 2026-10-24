"use client";

import { useMemo } from "react";
import {
  format,
  isToday,
  isTomorrow,
  isYesterday,
  isSameYear,
} from "date-fns";
import { EventRow } from "./event-row";
import type { AgendaEvent, AgendaChild } from "./types";

interface DayPanelProps {
  date: Date;
  events: AgendaEvent[];
  children: AgendaChild[];
  variant?: "normal" | "muted";
  onEventTap: (event: AgendaEvent) => void;
}

/**
 * A single day section: day header + event list.
 * "Today" uses hero-size type; other days use day-header size.
 */
export function DayPanel({
  date,
  events,
  children: allChildren,
  variant = "normal",
  onEventTap,
}: DayPanelProps) {
  const muted = variant === "muted";

  const { dayLabel, dateSubtitle, isHero } = useMemo(() => {
    const hero = isToday(date);
    const tomorrow = isTomorrow(date);
    const yesterday = isYesterday(date);
    const sameYear = isSameYear(date, new Date());

    let dayLabel: string;
    if (hero) dayLabel = "Today";
    else if (tomorrow) dayLabel = "Tomorrow";
    else if (yesterday) dayLabel = "Yesterday";
    else dayLabel = format(date, "EEEE");

    if (!hero && !tomorrow && !yesterday) {
      return {
        dayLabel,
        dateSubtitle: format(date, "MMMM d" + (sameYear ? "" : ", yyyy")),
        isHero: false,
      };
    }

    return { dayLabel, dateSubtitle: format(date, "EEEE, MMMM d"), isHero: hero };
  }, [date]);

  return (
    <section aria-label={`Events for ${dayLabel}, ${dateSubtitle}`}>
      {/* Day header */}
      <div
        className={`px-[var(--agenda-gutter)] pt-8 pb-3 ${
          muted ? "opacity-70" : ""
        }`}
      >
        <h2
          className={`font-atkinson leading-[var(--agenda-leading-tight)] ${
            isHero
              ? "text-agenda-hero font-bold text-agenda-ink"
              : muted
                ? "text-agenda-day font-normal text-agenda-ink-muted"
                : "text-agenda-day font-bold text-agenda-ink"
          }`}
        >
          {dayLabel}
        </h2>
        <p
          className={`font-atkinson text-agenda-ink-muted mt-0.5 ${
            isHero ? "text-agenda-title" : "text-agenda-base"
          }`}
        >
          {dateSubtitle}
        </p>
      </div>

      {/* Event list */}
      {events.length === 0 ? (
        <div className="px-[var(--agenda-gutter)] py-6 text-agenda-base text-agenda-ink-muted font-atkinson">
          No events
        </div>
      ) : (
        <div role="list">
          {events.map((event, i) => (
            <div key={event.id} role="listitem">
              {i > 0 && (
                <div
                  className="mx-[var(--agenda-gutter)] border-t border-[var(--agenda-divider)]"
                  aria-hidden="true"
                />
              )}
              <EventRow
                event={event}
                children={allChildren}
                muted={muted}
                onTap={onEventTap}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
