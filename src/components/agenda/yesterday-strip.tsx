"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { DayPanel } from "./day-panel";
import type { AgendaEvent, AgendaChild } from "./types";

interface YesterdayStripProps {
  items: AgendaEvent[];
  count: number;
  allChildren: AgendaChild[];
  onEventTap: (event: AgendaEvent) => void;
}

const STORAGE_KEY = "sane.yesterday.expanded";

/**
 * Carry-forward strip: collapsed pill showing count of incomplete items.
 * Tap expands inline above "Today" with muted day-section layout.
 */
export function YesterdayStrip({
  items,
  count,
  allChildren,
  onEventTap,
}: YesterdayStripProps) {
  const [expanded, setExpanded] = useState(false);

  // Restore collapse state from sessionStorage
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored === "true") setExpanded(true);
    } catch {
      // sessionStorage unavailable
    }
  }, []);

  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // sessionStorage unavailable
      }
      return next;
    });
  }, []);

  const groupedByDate = useMemo(() => groupByDate(items), [items]);

  if (count === 0) return null;

  const label = `${count} incomplete from the last 2 weeks`;

  return (
    <div>
      {/* Collapsed pill */}
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-2 w-full px-[var(--agenda-gutter)] py-3 text-left min-h-[var(--agenda-touch-min)] focus-visible:outline-2 focus-visible:outline-agenda-accent"
        aria-expanded={expanded}
        aria-controls="carry-forward-section"
      >
        <span className="text-agenda-sm font-inter text-agenda-accent-ink">
          ← {label}
        </span>
      </button>

      {/* Expanded section */}
      {expanded && (
        <div id="carry-forward-section">
          {groupedByDate.map(({ date, events }) => (
            <DayPanel
              key={date.toISOString()}
              date={date}
              events={events}
              children={allChildren}
              variant="normal"
              onEventTap={onEventTap}
            />
          ))}
          <div
            className="mx-[var(--agenda-gutter)] border-t border-[var(--agenda-divider)]"
            aria-hidden="true"
          />
        </div>
      )}
    </div>
  );
}

function groupByDate(
  items: AgendaEvent[]
): Array<{ date: Date; events: AgendaEvent[] }> {
  const map = new Map<string, { date: Date; events: AgendaEvent[] }>();
  for (const item of items) {
    const dateKey = new Date(item.startsAt).toISOString().slice(0, 10);
    let group = map.get(dateKey);
    if (!group) {
      group = { date: new Date(dateKey + "T12:00:00Z"), events: [] };
      map.set(dateKey, group);
    }
    group.events.push(item);
  }
  return Array.from(map.values()).sort(
    (a, b) => a.date.getTime() - b.date.getTime()
  );
}
