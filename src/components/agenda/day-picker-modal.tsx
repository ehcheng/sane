"use client";

import { useState } from "react";
import { Drawer } from "vaul";
import {
  format,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface DayPickerModalProps {
  open: boolean;
  onClose: () => void;
  currentDate: Date;
  onSelect: (date: Date) => void;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * Modal calendar for jump-to-date.
 * Simple month grid with tap-to-select.
 */
export function DayPickerModal({
  open,
  onClose,
  currentDate,
  onSelect,
}: DayPickerModalProps) {
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(currentDate));

  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);
  const calDays = eachDayOfInterval({ start: calStart, end: calEnd });

  const handleSelect = (date: Date) => {
    onSelect(date);
    onClose();
  };

  return (
    <Drawer.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl bg-[var(--agenda-surface)] max-h-[60dvh]">
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-[var(--agenda-divider)]" />
          </div>

          <div className="px-[var(--agenda-gutter)] pb-8">
            <Drawer.Title className="sr-only">Jump to date</Drawer.Title>

            {/* Month navigation */}
            <div className="flex items-center justify-between mb-4">
              <button
                type="button"
                onClick={() => setViewMonth(subMonths(viewMonth, 1))}
                className="w-10 h-10 flex items-center justify-center rounded-lg text-agenda-ink focus-visible:outline-2 focus-visible:outline-agenda-accent"
                aria-label="Previous month"
              >
                <ChevronLeft size={20} />
              </button>
              <span className="text-agenda-title font-atkinson font-bold text-agenda-ink">
                {format(viewMonth, "MMMM yyyy")}
              </span>
              <button
                type="button"
                onClick={() => setViewMonth(addMonths(viewMonth, 1))}
                className="w-10 h-10 flex items-center justify-center rounded-lg text-agenda-ink focus-visible:outline-2 focus-visible:outline-agenda-accent"
                aria-label="Next month"
              >
                <ChevronRight size={20} />
              </button>
            </div>

            {/* Weekday headers */}
            <div className="grid grid-cols-7 mb-1">
              {WEEKDAYS.map((day, i) => (
                <div
                  key={i}
                  className="text-center text-agenda-xs font-inter text-agenda-ink-muted py-1"
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Day grid */}
            <div className="grid grid-cols-7">
              {calDays.map((day) => {
                const inMonth = isSameMonth(day, viewMonth);
                const selected = isSameDay(day, currentDate);
                const todayDay = isToday(day);

                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    onClick={() => handleSelect(day)}
                    disabled={!inMonth}
                    className={`h-10 flex items-center justify-center rounded-full text-agenda-sm font-inter transition-colors focus-visible:outline-2 focus-visible:outline-agenda-accent ${
                      !inMonth
                        ? "text-agenda-ink-muted/30 cursor-default"
                        : selected
                          ? "bg-agenda-accent text-white font-medium"
                          : todayDay
                            ? "text-agenda-accent-ink font-medium"
                            : "text-agenda-ink"
                    }`}
                  >
                    {format(day, "d")}
                  </button>
                );
              })}
            </div>

            {/* Today shortcut */}
            <div className="flex justify-center mt-4">
              <button
                type="button"
                onClick={() => handleSelect(new Date())}
                className="h-[var(--agenda-touch-min)] px-6 rounded-xl border border-[var(--agenda-divider)] font-inter font-medium text-agenda-sm text-agenda-accent-ink focus-visible:outline-2 focus-visible:outline-agenda-accent"
              >
                Go to Today
              </button>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
