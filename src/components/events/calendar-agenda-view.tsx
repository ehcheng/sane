"use client";

import { useMemo, useRef, useEffect, useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Calendar, CheckCircle2, ChevronRight, MapPin, Zap } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { getChildColor, getEventChildDisplay } from "@/lib/child-colors";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { EventActionButtons, EventEditForm } from "./event-actions";
import { FormattedSummary, EventLinks, type EventLink } from "./formatted-summary";
import { toDateKey as toDateKeyTz, createFormatter, createDateKeyFormatter, formatTimeRange } from "@/lib/date-utils";

export interface SourceEmail {
  processedEmailId?: string;
  subject: string;
  fromName: string | null;
  fromAddress: string;
}

export interface AgendaEvent {
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

interface CalendarAgendaViewProps {
  events: AgendaEvent[];
  allChildIds: string[];
  hasMore: boolean;
  isFetchingMore: boolean;
  onLoadMore: () => void;
  /** ISO date string — used to determine if "Today" should be injected */
  rangeStart?: string;
  /** When set, scroll the agenda to this dateKey (YYYY-MM-DD) */
  scrollToDate?: string | null;
  /** Increment to re-trigger scroll even when scrollToDate hasn't changed */
  scrollSeq?: number;
  /** IANA timezone for date display */
  tz: string;
}

interface AgendaFormatters {
  fullDate: Intl.DateTimeFormat;
  monthDay: Intl.DateTimeFormat;
  weekday: Intl.DateTimeFormat;
}

function getRelativeInfo(
  dateKey: string,
  todayKey: string,
  fmt: AgendaFormatters
) {
  const today = new Date(todayKey + "T12:00:00");
  const target = new Date(dateKey + "T12:00:00");
  const diffDays = Math.round(
    (target.getTime() - today.getTime()) / 86400000
  );

  const isToday = diffDays === 0;
  const isTomorrow = diffDays === 1;
  const isPast = diffDays < 0;

  let primary: string;
  let secondary: string;

  if (isToday) {
    primary = "Today";
    secondary = fmt.fullDate.format(target);
  } else if (isTomorrow) {
    primary = "Tomorrow";
    secondary = fmt.fullDate.format(target);
  } else if (diffDays === -1) {
    primary = "Yesterday";
    secondary = fmt.fullDate.format(target);
  } else if (diffDays > 1 && diffDays < 7) {
    primary = fmt.weekday.format(target);
    secondary = fmt.monthDay.format(target);
  } else {
    primary = fmt.fullDate.format(target);
    secondary = "";
  }

  const dayOfWeek = target.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  return { primary, secondary, isToday, isTomorrow, isPast, isWeekend };
}

interface DayGroup {
  dateKey: string;
  events: AgendaEvent[];
}

export function CalendarAgendaView({
  events,
  allChildIds,
  hasMore,
  isFetchingMore,
  onLoadMore,
  rangeStart,
  scrollToDate,
  scrollSeq,
  tz,
}: CalendarAgendaViewProps) {
  const dateKeyFmt = useMemo(() => createDateKeyFormatter(tz), [tz]);
  const fmt = useMemo<AgendaFormatters>(() => ({
    fullDate: createFormatter({ weekday: "long", month: "long", day: "numeric" }, tz),
    monthDay: createFormatter({ month: "long", day: "numeric" }, tz),
    weekday: createFormatter({ weekday: "long" }, tz),
  }), [tz]);
  const timeFormatterTz = useMemo(
    () => createFormatter({ hour: "numeric", minute: "2-digit" }, tz),
    [tz]
  );

  const { data: globalStatus } = trpc.user.globalMonitoringStatus.useQuery();
  const showEmailSummary = globalStatus?.showEmailSummaryInEvents ?? false;

  const todayKey = useMemo(() => toDateKeyTz(new Date(), dateKeyFmt), [dateKeyFmt]);

  const dayGroups = useMemo(() => {
    const grouped = new Map<string, AgendaEvent[]>();
    for (const ev of events) {
      const key = toDateKeyTz(new Date(ev.eventDate), dateKeyFmt);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(ev);
    }

    Array.from(grouped.values()).forEach((evs) => {
      evs.sort((a: AgendaEvent, b: AgendaEvent) => {
        if (a.allDay && !b.allDay) return -1;
        if (!a.allDay && b.allDay) return 1;
        return (
          new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime()
        );
      });
    });

    let groups = Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateKey, evs]): DayGroup => ({ dateKey, events: evs }));

    // Always show "Today" as a temporal anchor when viewing the current range
    if (!grouped.has(todayKey) && groups.length > 0) {
      const rangeStartKey = rangeStart
        ? toDateKeyTz(new Date(rangeStart), dateKeyFmt)
        : todayKey;
      if (todayKey >= rangeStartKey) {
        const todayGroup: DayGroup = { dateKey: todayKey, events: [] };
        const insertIdx = groups.findIndex((g) => g.dateKey > todayKey);
        if (insertIdx === -1) {
          groups = [...groups, todayGroup];
        } else {
          groups = [
            ...groups.slice(0, insertIdx),
            todayGroup,
            ...groups.slice(insertIdx),
          ];
        }
      }
    }

    return groups;
  }, [events, todayKey, rangeStart, dateKeyFmt]);

  // Infinite scroll sentinel
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMore = useCallback(() => {
    if (hasMore && !isFetchingMore) onLoadMore();
  }, [hasMore, isFetchingMore, onLoadMore]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadMore();
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  // Keep dayGroups in a ref so the scroll effect can read the latest value
  // without re-triggering when new events arrive (e.g. during backfill polling).
  const dayGroupsRef = useRef(dayGroups);
  dayGroupsRef.current = dayGroups;

  // Scroll to a specific date. scrollSeq=1 is the initial mount (instant),
  // scrollSeq>1 is a user click in the mini-month (smooth animation).
  useEffect(() => {
    if (!scrollToDate || !scrollSeq) return;

    const doScroll = () => {
      let target = document.getElementById(`day-${scrollToDate}`);
      if (!target) {
        const nextGroup = dayGroupsRef.current.find((g) => g.dateKey >= scrollToDate);
        if (nextGroup) {
          target = document.getElementById(`day-${nextGroup.dateKey}`);
        }
      }
      if (!target) return;

      // Measure total height of sticky elements above the content
      const stickyEls = document.querySelectorAll<HTMLElement>(
        'header[class*="sticky"], div[class*="sticky top-"]'
      );
      let stickyHeight = 0;
      stickyEls.forEach((el) => {
        stickyHeight += el.getBoundingClientRect().height;
      });
      // Small breathing room
      stickyHeight += 8;

      const targetTop = target.getBoundingClientRect().top + window.scrollY;
      const behavior = scrollSeq <= 1 ? "instant" : "smooth";
      window.scrollTo({ top: targetTop - stickyHeight, behavior });
    };

    if (scrollSeq <= 1) {
      // Defer initial scroll past Next.js navigation scroll handling
      // to avoid the framework resetting our scroll position
      const raf = requestAnimationFrame(doScroll);
      return () => cancelAnimationFrame(raf);
    }
    doScroll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToDate, scrollSeq]);

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 rounded-full bg-muted/50 p-4">
          <Calendar className="h-8 w-8 text-muted-foreground/50" />
        </div>
        <p className="text-sm font-medium text-muted-foreground">
          No upcoming events
        </p>
        <p className="mt-1 text-xs text-muted-foreground/60">
          Events from school emails will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {dayGroups.map((group) => {
        const info = getRelativeInfo(group.dateKey, todayKey, fmt);
        return (
          <section key={group.dateKey} id={`day-${group.dateKey}`}>
            {/* Day header */}
            <div
              className={cn(
                "mb-3 flex items-baseline gap-2 border-b pb-2",
                info.isToday && "border-blue-300 dark:border-blue-700",
                !info.isToday && (info.isWeekend ? "border-gray-200 dark:border-gray-800 border-dashed" : "border-border")
              )}
            >
              {info.isToday && (
                <span className="relative flex h-2.5 w-2.5 shrink-0 self-center">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-500" />
                </span>
              )}
              <h2
                className={cn(
                  "text-[15px] font-semibold tracking-tight",
                  info.isToday && "text-blue-600 dark:text-blue-400",
                  info.isTomorrow && "text-foreground",
                  info.isPast && "text-muted-foreground/70",
                  !info.isToday &&
                    !info.isTomorrow &&
                    !info.isPast &&
                    (info.isWeekend ? "text-gray-400 dark:text-gray-500" : "text-foreground")
                )}
              >
                {info.primary}
              </h2>
              {info.secondary && (
                <span className="text-sm text-muted-foreground">
                  {info.secondary}
                </span>
              )}
              {group.events.length > 0 && (
                <span className="ml-auto text-xs tabular-nums text-muted-foreground/50">
                  {group.events.length}
                </span>
              )}
            </div>

            {/* Event cards */}
            {group.events.length > 0 ? (
              <div className="space-y-2">
                {group.events.map((ev) => (
                  <AgendaEventCard
                    key={ev.id}
                    event={ev}
                    allChildIds={allChildIds}
                    timeFormatter={timeFormatterTz}
                    showEmailSummary={showEmailSummary}
                  />
                ))}
              </div>
            ) : info.isToday ? (
              <p className="py-3 text-center text-sm italic text-muted-foreground/50">
                No events scheduled
              </p>
            ) : null}
          </section>
        );
      })}

      <div ref={sentinelRef} className="h-1" />
      {isFetchingMore && (
        <p className="py-4 text-center text-sm text-muted-foreground animate-pulse">
          Loading more events...
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgendaEventCard — expandable card with child color accent bar
// ---------------------------------------------------------------------------

function AgendaEventCard({
  event,
  allChildIds,
  timeFormatter,
  showEmailSummary,
}: {
  event: AgendaEvent;
  allChildIds: string[];
  timeFormatter: Intl.DateTimeFormat;
  showEmailSummary: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const { badgeChildren, accentColor: color } = getEventChildDisplay(event.children, allChildIds);
  const timeLabel = useMemo(() => {
    if (event.allDay) return null;
    return formatTimeRange(timeFormatter, new Date(event.eventDate), event.endDate);
  }, [event.allDay, event.eventDate, event.endDate, timeFormatter]);
  const summary = event.processedEmail?.aiSummary;
  const { data: user } = trpc.user.me.useQuery();
  const parsedLinks: EventLink[] = useMemo(() => {
    if (!user?.showLinksInSummary || !event.processedEmail?.aiLinks) return [];
    try { return JSON.parse(event.processedEmail.aiLinks) as EventLink[]; } catch { return []; }
  }, [user?.showLinksInSummary, event.processedEmail?.aiLinks]);

  const sourceEmails: SourceEmail[] = useMemo(() => {
    // Prefer self-contained sourceEmails JSON; fall back to processedEmail relation
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
      <div className="relative overflow-hidden rounded-xl border bg-card shadow-sm">
        <div
          className={cn(
            "absolute left-0 top-0 bottom-0 w-1 rounded-l-xl",
            color.dot
          )}
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
    <div className="relative overflow-hidden rounded-xl border bg-card shadow-sm">
      {/* Child color accent bar */}
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 w-1 rounded-l-xl",
          color.dot
        )}
      />

      {/* Main row — single tap to expand */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-2 py-3 pl-4 pr-2 text-left transition-colors active:bg-accent/30 md:hover:bg-accent/30"
      >
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-medium leading-snug", event.isDone && "line-through text-muted-foreground")}>
            {event.isDone && (
              <CheckCircle2 className="inline-block h-3.5 w-3.5 text-green-600 mr-1 -mt-0.5" />
            )}
            {event.isTodo && (
              <span className="text-amber-600 dark:text-amber-400">TO-DO: </span>
            )}
            {event.title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            {event.isTodo ? (
              <span className="text-xs font-medium text-amber-600/70 dark:text-amber-400/70">
                To-do
              </span>
            ) : timeLabel ? (
              <span className="text-xs text-muted-foreground">{timeLabel}</span>
            ) : (
              <span className="text-xs font-medium text-muted-foreground/70">
                All day
              </span>
            )}
            {event.location && !expanded && (
              <>
                <span className="text-muted-foreground/30">&middot;</span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground truncate max-w-[200px]">
                  <MapPin className="h-3 w-3 shrink-0 opacity-60" />
                  {event.location}
                </span>
              </>
            )}
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
          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/40" />
        </motion.div>
      </button>

      {/* Expanded details + actions */}
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
              {showEmailSummary && event.processedEmail && summary && (
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
