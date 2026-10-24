"use client";

import { useMemo } from "react";
import { getEventChildDisplay } from "@/lib/child-colors";
import { cn } from "@/lib/utils";
import { toDateKey, createDateKeyFormatter } from "@/lib/date-utils";

export interface MiniMonthEvent {
  id: string;
  eventDate: string | Date;
  children: Array<{ id: string; name: string }>;
}

interface MiniMonthGridProps {
  year: number;
  month: number; // 0-indexed
  events: MiniMonthEvent[];
  allChildIds: string[];
  selectedDay: string | null;
  onDayClick: (dateKey: string) => void;
  /** IANA timezone for date calculations */
  tz: string;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export function MiniMonthGrid({
  year,
  month,
  events,
  allChildIds,
  selectedDay,
  onDayClick,
  tz,
}: MiniMonthGridProps) {
  const dateKeyFmt = useMemo(() => createDateKeyFormatter(tz), [tz]);
  const todayKey = useMemo(() => toDateKey(new Date(), dateKeyFmt), [dateKeyFmt]);

  const { weeks, eventsByDate } = useMemo(() => {
    const byDate = new Map<string, MiniMonthEvent[]>();
    for (const ev of events) {
      const d = new Date(ev.eventDate);
      const key = toDateKey(d, dateKeyFmt);
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key)!.push(ev);
    }

    const firstDay = new Date(year, month, 1);
    const startOffset = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const weeks: Array<Array<{ day: number; dateKey: string } | null>> = [];
    let currentWeek: Array<{ day: number; dateKey: string } | null> = [];

    for (let i = 0; i < startOffset; i++) currentWeek.push(null);

    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      currentWeek.push({ day: d, dateKey });
      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    }

    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) currentWeek.push(null);
      weeks.push(currentWeek);
    }

    return { weeks, eventsByDate: byDate };
  }, [year, month, events, dateKeyFmt]);

  return (
    <div className="select-none">
      {/* Weekday headers */}
      <div className="grid grid-cols-7 text-center text-[11px] font-medium text-muted-foreground">
        {WEEKDAYS.map((label, i) => (
          <div key={i} className={cn("py-1", (i === 0 || i === 6) && "opacity-50")}>
            {label}
          </div>
        ))}
      </div>

      {/* Day grid */}
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7">
          {week.map((cell, di) => {
            if (!cell) {
              return <div key={`${wi}-${di}`} className="h-8" />;
            }

            const isToday = cell.dateKey === todayKey;
            const isSelected = cell.dateKey === selectedDay;
            const dayEvents = eventsByDate.get(cell.dateKey) ?? [];
            const isWeekend = di === 0 || di === 6;

            return (
              <button
                key={cell.dateKey}
                type="button"
                onClick={() => onDayClick(cell.dateKey)}
                className={cn(
                  "flex h-8 flex-col items-center justify-center rounded-md transition-colors hover:bg-accent/50",
                  isSelected && "ring-2 ring-blue-500 ring-inset"
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full text-xs",
                    isToday
                      ? "bg-blue-600 font-bold text-white"
                      : isWeekend
                        ? "text-muted-foreground/60"
                        : "text-foreground"
                  )}
                >
                  {cell.day}
                </span>

                {/* Event dots */}
                {dayEvents.length > 0 && (
                  <div className="flex items-center gap-px">
                    {dayEvents.slice(0, 3).map((ev) => {
                      const { accentColor: color } = getEventChildDisplay(ev.children, allChildIds);
                      return (
                        <span
                          key={ev.id}
                          className={cn("block h-1 w-1 rounded-full", color.dot)}
                        />
                      );
                    })}
                    {dayEvents.length > 3 && (
                      <span className="text-[7px] leading-none text-muted-foreground">
                        +{dayEvents.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
