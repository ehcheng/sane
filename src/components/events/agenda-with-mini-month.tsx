"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { MiniMonthGrid } from "./mini-month-grid";
import { CalendarAgendaView, AgendaEvent } from "./calendar-agenda-view";
import { todayDateKey } from "@/lib/date-utils";

interface AgendaWithMiniMonthProps {
  year: number;
  month: number; // 0-indexed
  events: AgendaEvent[];
  allChildIds: string[];
  hasMore: boolean;
  isFetchingMore: boolean;
  onLoadMore: () => void;
  rangeStart: string;
  /** Increment to trigger a scroll-to-today from parent */
  scrollToTodaySeq?: number;
  /** IANA timezone for date calculations */
  tz: string;
}

export function AgendaWithMiniMonth({
  year,
  month,
  events,
  allChildIds,
  hasMore,
  isFetchingMore,
  onLoadMore,
  rangeStart,
  scrollToTodaySeq,
  tz,
}: AgendaWithMiniMonthProps) {
  // scrollSeq=1 on mount → instant scroll to today; user clicks increment further → smooth scroll
  const [selectedDay, setSelectedDay] = useState<string | null>(() => todayDateKey(tz));
  const [scrollSeq, setScrollSeq] = useState(1);

  // Parent signals "scroll to today" (e.g. clicking Agenda button while already on agenda).
  // Skip on initial mount so we don't interfere with the built-in scrollSeq=1 mount scroll.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (scrollToTodaySeq && scrollToTodaySeq > 0) {
      setSelectedDay(todayDateKey(tz));
      setScrollSeq((s) => s + 1);
    }
  }, [scrollToTodaySeq, tz]);

  const handleDayClick = useCallback((dateKey: string) => {
    setSelectedDay(dateKey);
    setScrollSeq((s) => s + 1);
  }, []);

  return (
    <div className="flex flex-col gap-4 md:flex-row md:gap-6">
      {/* Mini-month sidebar — desktop only */}
      <div className="hidden shrink-0 md:sticky md:top-[9rem] md:block md:w-[220px] md:self-start">
        <div className="rounded-lg border bg-card p-3">
          <MiniMonthGrid
            year={year}
            month={month}
            events={events}
            allChildIds={allChildIds}
            selectedDay={selectedDay}
            onDayClick={handleDayClick}
            tz={tz}
          />
        </div>
      </div>

      {/* Agenda */}
      <div className="min-w-0 flex-1">
        <CalendarAgendaView
          events={events}
          allChildIds={allChildIds}
          hasMore={hasMore}
          isFetchingMore={isFetchingMore}
          onLoadMore={onLoadMore}
          rangeStart={rangeStart}
          scrollToDate={selectedDay}
          scrollSeq={scrollSeq}
          tz={tz}
        />
      </div>
    </div>
  );
}
