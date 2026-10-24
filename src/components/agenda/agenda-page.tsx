"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { addDays, startOfDay, isToday } from "date-fns";
import { trpc } from "@/lib/trpc";
import { useTimezone } from "@/hooks/use-timezone";
import { toDateKey } from "@/lib/date-utils";
import { getAgendaChildColor } from "@/lib/agenda-child-colors";
import { TopBar } from "./top-bar";
import { DayPanel } from "./day-panel";
import { YesterdayStrip } from "./yesterday-strip";
import { EventDetailView } from "./event-detail-view";
import { FilterSheet } from "./filter-sheet";
import { MenuDrawer } from "./menu-drawer";
import { DayPickerModal } from "./day-picker-modal";
import type { AgendaEvent, AgendaChild, AgendaFilter } from "./types";

const DAYS_BEFORE = 0;
const DAYS_AFTER = 14;
const FILTER_STORAGE_KEY = "sane.filter";

/**
 * Top-level agenda page component.
 * Single vertical scroll with all days stacked.
 * Swiping is reserved for the event detail view.
 */
export function AgendaPage() {
  const tz = useTimezone();
  const today = useMemo(() => startOfDay(new Date()), []);

  const days = useMemo(() => {
    const result: Date[] = [];
    for (let i = -DAYS_BEFORE; i <= DAYS_AFTER; i++) {
      result.push(addDays(today, i));
    }
    return result;
  }, [today]);

  // Filter state
  const [filter, setFilter] = useState<AgendaFilter>(() => {
    try {
      const stored = localStorage.getItem(FILTER_STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch {}
    return { childIds: null, showCompleted: true, actionableOnly: false };
  });

  useEffect(() => {
    try { localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filter)); } catch {}
  }, [filter]);

  // UI state
  const [detailState, setDetailState] = useState<{
    events: AgendaEvent[];
    index: number;
  } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [dayPickerOpen, setDayPickerOpen] = useState(false);

  const fromDate = today.toISOString();
  const toDate = addDays(today, DAYS_AFTER).toISOString();

  const agendaQuery = trpc.events.agenda.useQuery(
    {
      from: fromDate,
      to: toDate,
      childIds: filter.childIds ?? undefined,
      showCompleted: filter.showCompleted,
      actionableOnly: filter.actionableOnly,
    },
    { refetchInterval: 60_000 }
  );

  const childrenQuery = trpc.children.list.useQuery();

  const allChildren: AgendaChild[] = useMemo(() => {
    const kids = childrenQuery.data ?? [];
    const allIds = kids.map((c) => c.id);
    return kids.map((c) => {
      const colors = getAgendaChildColor(c.id, allIds);
      return {
        id: c.id,
        name: c.name.split(" ")[0],
        color: colors.color,
        colorInk: colors.colorInk,
        colorInkDark: colors.colorInkDark,
      };
    });
  }, [childrenQuery.data]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, AgendaEvent[]>();
    for (const event of agendaQuery.data?.events ?? []) {
      const key = toDateKey(new Date(event.startsAt), tz);
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    return map;
  }, [agendaQuery.data?.events, tz]);

  // Days that have events (only render non-empty days after today)
  const visibleDays = useMemo(() => {
    return days.filter((day) => {
      if (isToday(day)) return true; // always show today
      const key = toDateKey(day, tz);
      return (eventsByDate.get(key)?.length ?? 0) > 0;
    });
  }, [days, eventsByDate, tz]);

  const hasActiveFilter = filter.childIds !== null || !filter.showCompleted || filter.actionableOnly;
  const showFilterIcon = allChildren.length > 1;

  const handleEventTap = useCallback(
    (event: AgendaEvent) => {
      const events = agendaQuery.data?.events ?? [];
      const index = events.findIndex((e) => e.id === event.id);
      setDetailState({ events, index: Math.max(0, index) });
    },
    [agendaQuery.data?.events]
  );

  // Scroll to a date section
  const goToDate = useCallback((date: Date) => {
    const key = toDateKey(date, tz);
    const el = document.getElementById(`day-${key}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [tz]);

  return (
    <div className="agenda h-dvh flex flex-col overflow-hidden pt-safe">
      <TopBar
        currentDayLabel="Agenda"
        hasActiveFilter={showFilterIcon && hasActiveFilter}
        onMenuOpen={() => setMenuOpen(true)}
        onFilterOpen={() => setFilterOpen(true)}
        onDayTap={() => setDayPickerOpen(true)}
      />

      {/* Single vertical scroll */}
      <div className="flex-1 overflow-y-auto">
        {/* Carry-forward strip */}
        {agendaQuery.data && (
          <YesterdayStrip
            items={agendaQuery.data.carryForward}
            count={agendaQuery.data.carryForwardCount}
            allChildren={allChildren}
            onEventTap={handleEventTap}
          />
        )}

        {/* All days stacked vertically */}
        {visibleDays.map((day) => {
          const dateKey = toDateKey(day, tz);
          const dayEvents = eventsByDate.get(dateKey) ?? [];

          return (
            <div key={dateKey} id={`day-${dateKey}`}>
              <DayPanel
                date={day}
                events={dayEvents}
                children={allChildren}
                onEventTap={handleEventTap}
              />
            </div>
          );
        })}

        {/* Bottom safe area */}
        <div className="h-20" />
      </div>

      {/* Detail view (full-screen, swipeable between events) */}
      {detailState && (
        <EventDetailView
          events={detailState.events}
          initialIndex={detailState.index}
          allChildren={allChildren}
          onBack={() => setDetailState(null)}
          onEventUpdated={() => setDetailState(null)}
        />
      )}

      {showFilterIcon && (
        <FilterSheet
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          filter={filter}
          onFilterChange={setFilter}
          children={allChildren}
        />
      )}

      <MenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />

      <DayPickerModal
        open={dayPickerOpen}
        onClose={() => setDayPickerOpen(false)}
        currentDate={today}
        onSelect={goToDate}
      />
    </div>
  );
}
