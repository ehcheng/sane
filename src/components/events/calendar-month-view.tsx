"use client";

import { useEffect, useMemo, useState } from "react";
import { useIsNarrowViewport } from "@/hooks/use-mobile";
import { Badge } from "@/components/ui/badge";
import { X, MapPin, CheckCircle2, ChevronRight, Zap } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { getChildColor, getEventChildDisplay } from "@/lib/child-colors";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { EventActionButtons, EventEditForm } from "./event-actions";
import { FormattedSummary, EventLinks, type EventLink } from "./formatted-summary";
import { toDateKey, createFormatter, createDateKeyFormatter, formatTimeRange } from "@/lib/date-utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface SourceEmail {
  processedEmailId?: string;
  subject: string;
  fromName: string | null;
  fromAddress: string;
}

export interface MonthEvent {
  id: string;
  title: string;
  eventDate: string | Date;
  endDate?: string | Date | null;
  allDay: boolean;
  isTodo?: boolean;
  location: string | null;
  details: string | null;
  sourceEmails: string | null;
  processedEmailId: string | null;
  children: Array<{ id: string; name: string }>;
  processedEmail: { forwarded: boolean; aiSummary: string | null; aiLinks: string | null; fromAddress: string; fromName: string | null; subject: string } | null;
  userFeedback?: string | null;
  userFeedbackReason?: string | null;
  actionable?: boolean;
  isDone?: boolean;
  doneByName?: string | null;
}

interface CalendarMonthViewProps {
  year: number;
  month: number; // 0-indexed
  events: MonthEvent[];
  allChildIds: string[];
  /** If set, auto-select this date key (YYYY-MM-DD) */
  autoSelectDay?: string | null;
  /** Change this value to re-trigger autoSelectDay even if the date hasn't changed */
  autoSelectSeq?: number;
  /** IANA timezone for date display */
  tz: string;
}

const WEEKDAYS_FULL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_SHORT = ["S", "M", "T", "W", "T", "F", "S"];

const DESKTOP_MAX_VISIBLE = 3;

export function CalendarMonthView({
  year,
  month,
  events,
  allChildIds,
  autoSelectDay,
  autoSelectSeq,
  tz,
}: CalendarMonthViewProps) {
  const dateKeyFmt = useMemo(() => createDateKeyFormatter(tz), [tz]);
  const timeFormatter = useMemo(
    () => createFormatter({ hour: "numeric", minute: "2-digit" }, tz),
    [tz]
  );
  const dayDetailFormatter = useMemo(
    () => createFormatter({ weekday: "long", month: "long", day: "numeric" }, tz),
    [tz]
  );

  const { data: globalStatus } = trpc.user.globalMonitoringStatus.useQuery();
  const showEmailSummary = globalStatus?.showEmailSummaryInEvents ?? false;

  const todayKey = useMemo(() => toDateKey(new Date(), dateKeyFmt), [dateKeyFmt]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // Use narrow viewport for Sheet vs inline detail panel
  const isMobileView = useIsNarrowViewport();

  // Apply autoSelectDay when triggered (seq changes to re-fire even if same date)
  useEffect(() => {
    if (autoSelectDay) setSelectedDay(autoSelectDay);
  }, [autoSelectDay, autoSelectSeq]);

  const { weeks, eventsByDate } = useMemo(() => {
    const byDate = new Map<string, MonthEvent[]>();
    for (const ev of events) {
      const d = new Date(ev.eventDate);
      const key = toDateKey(d, dateKeyFmt);
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key)!.push(ev);
    }

    Array.from(byDate.values()).forEach((evs) => {
      evs.sort((a: MonthEvent, b: MonthEvent) => {
        if (a.allDay && !b.allDay) return -1;
        if (!a.allDay && b.allDay) return 1;
        return new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime();
      });
    });

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

  const handleDayClick = (dateKey: string) => {
    setSelectedDay((prev) => (prev === dateKey ? null : dateKey));
  };

  const selectedEvents = selectedDay ? eventsByDate.get(selectedDay) ?? [] : [];

  // Find which week row the selected day is in, to insert detail panel after it
  const selectedWeekIndex = selectedDay
    ? weeks.findIndex((week) => week.some((cell) => cell?.dateKey === selectedDay))
    : -1;

  return (
    <div className="overflow-x-auto">
      {/* Weekday headers */}
      <div className="grid min-w-0 grid-cols-7 border-b text-center text-xs font-medium text-muted-foreground">
        {WEEKDAYS_FULL.map((full, i) => (
          <div key={full} className={cn("py-2", (i === 0 || i === 6) && "opacity-60")}>
            <span className="hidden sm:inline">{full}</span>
            <span className="sm:hidden">{WEEKDAYS_SHORT[i]}</span>
          </div>
        ))}
      </div>

      {/* Calendar grid with inline detail panels */}
      {weeks.map((week, wi) => (
        <div key={wi}>
          {/* Week row */}
          <div className="grid min-w-0 grid-cols-7">
            {week.map((cell, di) => {
              const isWeekend = di === 0 || di === 6;
              if (!cell) {
                return (
                  <div
                    key={`${wi}-${di}`}
                    className={cn(
                      "min-h-[4rem] border-b border-r p-0.5 last:border-r-0 sm:min-h-[5.5rem] sm:p-1",
                      isWeekend ? "bg-gray-100 dark:bg-gray-900/40" : "bg-muted/20"
                    )}
                  />
                );
              }

              const dayEvents = eventsByDate.get(cell.dateKey) ?? [];
              const isToday = cell.dateKey === todayKey;
              const isSelected = cell.dateKey === selectedDay;
              const overflow = dayEvents.length - DESKTOP_MAX_VISIBLE;

              return (
                <button
                  key={cell.dateKey}
                  type="button"
                  onClick={() => handleDayClick(cell.dateKey)}
                  className={cn(
                    "flex min-h-[4rem] flex-col border-b border-r p-0.5 text-left transition-colors hover:bg-accent/50 last:border-r-0 sm:min-h-[5.5rem] sm:p-1",
                    isWeekend && !isToday && !isSelected && "bg-gray-50 dark:bg-gray-900/30",
                    isToday && "bg-blue-100 dark:bg-blue-950/40",
                    isSelected && "bg-blue-50 ring-2 ring-inset ring-blue-500 dark:bg-blue-950/30"
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs sm:h-7 sm:w-7 sm:text-sm",
                      isToday
                        ? "bg-blue-600 font-bold text-white"
                        : isWeekend
                          ? "text-gray-400 dark:text-gray-500"
                          : "text-foreground"
                    )}
                  >
                    {cell.day}
                  </span>

                  {dayEvents.length > 0 && (
                    <>
                      {/* Desktop: inline event chips */}
                      <div className="mt-0.5 hidden flex-col gap-px sm:flex">
                        {dayEvents.slice(0, DESKTOP_MAX_VISIBLE).map((ev) => {
                          const { accentColor: color } = getEventChildDisplay(ev.children, allChildIds);
                          const time = ev.allDay
                            ? null
                            : formatTimeRange(timeFormatter, new Date(ev.eventDate), ev.endDate, "\u2013");
                          return (
                            <div
                              key={ev.id}
                              className={cn(
                                "flex items-center gap-1 truncate rounded px-1 py-px text-[10px] leading-tight",
                                color.bg,
                                color.text
                              )}
                              title={ev.title}
                            >
                              <span
                                className={cn(
                                  "h-1.5 w-1.5 shrink-0 rounded-full",
                                  color.dot
                                )}
                              />
                              <span className={cn("truncate", ev.isDone && "line-through text-muted-foreground")}>
                                {ev.isDone && (
                                  <span className="font-medium text-green-600">✓ </span>
                                )}
                                {ev.isTodo && (
                                  <span className="font-medium text-amber-600 dark:text-amber-400">TD: </span>
                                )}
                                {!ev.actionable && !ev.isTodo && (
                                  <span className="font-medium text-muted-foreground">FYI: </span>
                                )}
                                {time && (
                                  <span className="font-medium">{time} </span>
                                )}
                                {ev.title}
                              </span>
                            </div>
                          );
                        })}
                        {overflow > 0 && (
                          <span className="px-1 text-[10px] font-medium text-muted-foreground">
                            +{overflow} more
                          </span>
                        )}
                      </div>

                      {/* Mobile: colored dots + count */}
                      <div className="mt-1 flex items-center justify-center gap-1 sm:hidden">
                        {dayEvents.slice(0, 3).map((ev) => {
                          const { accentColor: color } = getEventChildDisplay(ev.children, allChildIds);
                          return (
                            <span
                              key={ev.id}
                              className={cn(
                                "block h-[5px] w-[5px] rounded-full",
                                color.dot
                              )}
                            />
                          );
                        })}
                        {dayEvents.length > 3 && (
                          <span className="text-[9px] leading-none text-muted-foreground">
                            +{dayEvents.length - 3}
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </button>
              );
            })}
          </div>

          {/* Desktop: Inline day detail panel */}
          {!isMobileView && selectedWeekIndex === wi && selectedDay && selectedEvents.length > 0 && (
            <DayDetailPanel
              dateKey={selectedDay}
              events={selectedEvents}
              allChildIds={allChildIds}
              onClose={() => setSelectedDay(null)}
              timeFormatter={timeFormatter}
              dayDetailFormatter={dayDetailFormatter}
              showEmailSummary={showEmailSummary}
            />
          )}
        </div>
      ))}

      {/* Mobile: Bottom sheet day detail */}
      {isMobileView && (
        <Sheet
          open={!!selectedDay && selectedEvents.length > 0}
          onOpenChange={(open) => { if (!open) setSelectedDay(null); }}
        >
          <SheetContent side="bottom" className="rounded-t-2xl px-2 pb-safe max-h-[80dvh] overflow-y-auto">
            <SheetHeader className="px-4">
              <SheetTitle className="text-base">
                {selectedDay && dayDetailFormatter.format(new Date(selectedDay + "T12:00:00"))}
              </SheetTitle>
            </SheetHeader>
            <div className="mt-3 space-y-2 px-2 pb-4">
              {selectedEvents.map((ev) => (
                <DayDetailEvent
                  key={ev.id}
                  event={ev}
                  allChildIds={allChildIds}
                  timeFormatter={timeFormatter}
                  showEmailSummary={showEmailSummary}
                />
              ))}
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DayDetailPanel — full event details for a selected day
// ---------------------------------------------------------------------------

function DayDetailPanel({
  dateKey,
  events,
  allChildIds,
  onClose,
  timeFormatter,
  dayDetailFormatter,
  showEmailSummary,
}: {
  dateKey: string;
  events: MonthEvent[];
  allChildIds: string[];
  onClose: () => void;
  timeFormatter: Intl.DateTimeFormat;
  dayDetailFormatter: Intl.DateTimeFormat;
  showEmailSummary: boolean;
}) {
  const label = dayDetailFormatter.format(new Date(dateKey + "T12:00:00"));

  return (
    <div className="border-b border-x bg-muted/20 px-3 py-3 sm:px-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{label}</h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {events.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No events on this day.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {events.map((ev) => (
            <DayDetailEvent key={ev.id} event={ev} allChildIds={allChildIds} timeFormatter={timeFormatter} showEmailSummary={showEmailSummary} />
          ))}
        </div>
      )}
    </div>
  );
}

function DayDetailEvent({
  event,
  allChildIds,
  timeFormatter,
  showEmailSummary,
}: {
  event: MonthEvent;
  allChildIds: string[];
  timeFormatter: Intl.DateTimeFormat;
  showEmailSummary: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const { badgeChildren, accentColor: color } = getEventChildDisplay(event.children, allChildIds);
  const time = useMemo(() => {
    if (event.isTodo) return "To-do";
    if (event.allDay) return "All day";
    return formatTimeRange(timeFormatter, new Date(event.eventDate), event.endDate);
  }, [event.isTodo, event.allDay, event.eventDate, event.endDate, timeFormatter]);
  const summary = event.processedEmail?.aiSummary;
  const { data: user } = trpc.user.me.useQuery();
  const parsedLinks: EventLink[] = useMemo(() => {
    if (!user?.showLinksInSummary || !event.processedEmail?.aiLinks) return [];
    try { return JSON.parse(event.processedEmail.aiLinks) as EventLink[]; } catch { return []; }
  }, [user?.showLinksInSummary, event.processedEmail?.aiLinks]);

  const sourceEmails: SourceEmail[] = useMemo(() => {
    if (event.sourceEmails) {
      try { return JSON.parse(event.sourceEmails) as SourceEmail[]; } catch { /* fall through */ }
    }
    if (event.processedEmail?.subject) {
      return [{
        subject: event.processedEmail.subject,
        fromName: event.processedEmail.fromName,
        fromAddress: event.processedEmail.fromAddress,
      }];
    }
    return [];
  }, [event.sourceEmails, event.processedEmail]);

  if (editing) {
    return (
      <div className="relative overflow-hidden rounded-md border bg-background">
        <div
          className={cn("absolute left-0 top-0 bottom-0 w-1", color.dot)}
        />
        <div className="pl-4 pr-3 py-2">
          <EventEditForm
            event={event}
            onCancel={() => setEditing(false)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-xl border bg-background shadow-sm">
      {/* Child color accent bar */}
      <div
        className={cn("absolute left-0 top-0 bottom-0 w-1 rounded-l-xl", color.dot)}
      />

      {/* Collapsed: title + time + badges — single tap to expand */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-2 pl-4 pr-2 py-2.5 text-left transition-colors active:bg-accent/30 md:hover:bg-accent/30"
      >
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-medium", event.isDone && "line-through text-muted-foreground")}>
            {event.isDone && (
              <CheckCircle2 className="inline-block h-3.5 w-3.5 text-green-600 mr-1 -mt-0.5" />
            )}
            {event.isTodo && (
              <span className="text-amber-600 dark:text-amber-400">TO-DO: </span>
            )}
            {event.title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span className={event.isTodo ? "text-amber-600/70 dark:text-amber-400/70" : ""}>{time}</span>
            {event.actionable && (
              <span title="Actionable event"><Zap className="h-3 w-3 text-blue-500 dark:text-blue-400" /></span>
            )}
            {badgeChildren.map((child) => {
              const childColor = getChildColor(child.id, allChildIds);
              return (
                <Badge
                  key={child.id}
                  variant="secondary"
                  className={cn(
                    "px-1.5 py-0 text-[10px]",
                    childColor.bg,
                    childColor.text
                  )}
                >
                  {child.name}
                </Badge>
              );
            })}
          </div>
        </div>
        <motion.div
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
        >
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40" />
        </motion.div>
      </button>

      {/* Expanded: location + summary + links + source emails + actions */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="overflow-hidden"
          >
            <div className="border-t border-dashed px-4 pb-3 pt-2.5 space-y-2.5">
              {event.location && (
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 opacity-70" />
                  <span>{event.location}</span>
                </div>
              )}
              {event.details && (
                <div className="rounded-md bg-amber-50/60 dark:bg-amber-950/20 px-2.5 py-2">
                  <FormattedSummary text={event.details} />
                </div>
              )}
              {showEmailSummary && summary && (
                <div className="rounded-md bg-muted/40 px-3 py-2.5">
                  <FormattedSummary text={summary} />
                </div>
              )}
              {parsedLinks.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Links</p>
                  <EventLinks links={parsedLinks} />
                </div>
              )}
              {sourceEmails.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    From email{sourceEmails.length > 1 ? "s" : ""}
                  </p>
                  <div className="rounded-md border border-border/50 overflow-hidden">
                    {sourceEmails.map((src, i) => {
                      const content = (
                        <>
                          {src.subject}
                          <span className="ml-1.5 text-muted-foreground">
                            {src.fromName ?? src.fromAddress}
                          </span>
                        </>
                      );
                      return (
                        <div
                          key={i}
                          className={`flex gap-1.5 px-2 py-1 text-xs font-normal leading-relaxed ${
                            i % 2 === 0 ? "bg-muted/30" : ""
                          }`}
                        >
                          <span className="mt-px shrink-0 text-muted-foreground/50">&#x2022;</span>
                          {src.processedEmailId ? (
                            <a
                              href={`/settings?emailId=${src.processedEmailId}&fromEvent=${encodeURIComponent(event.title)}#email-log`}
                              className="text-foreground/90 underline-offset-2 hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {content}
                            </a>
                          ) : (
                            <span className="text-foreground/90">{content}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <EventActionButtons
                event={event}
                onEdit={() => setEditing(true)}
                className="flex flex-wrap gap-1 md:gap-0.5"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
