"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "@/components/ui/use-toast";
import { buildGoogleCalendarUrl } from "@/lib/calendar-links";
import { getEventChildDisplay } from "@/lib/child-colors";
import { cn } from "@/lib/utils";
import { useTimezone } from "@/hooks/use-timezone";
import { toDateKey, createFormatter, createDateKeyFormatter, toLocalInputValue, resolveEventDate, formatTimeRange } from "@/lib/date-utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RawEvent = {
  id: string;
  title: string;
  eventDate: string | Date;
  endDate?: string | Date | null;
  allDay: boolean;
  isTodo?: boolean;
  location: string | null;
  processedEmailId: string | null;
  children: Array<{ id: string; name: string }>;
  processedEmail: { forwarded: boolean; aiSummary: string | null; aiLinks: string | null; fromAddress: string; fromName: string | null; subject: string } | null;
  isDone?: boolean;
  doneByName?: string | null;
};

interface DayGroup {
  dateKey: string;
  label: string; // e.g. "Mon, Feb 16"
  isToday: boolean;
  events: DisplayEvent[];
}

interface DisplayEvent extends RawEvent {
  /** If this event spans multiple consecutive days, show "(Feb 16–20)" */
  multiDayLabel: string | null;
  /** Formatted time for non-all-day events */
  timeLabel: string | null;
}

// ---------------------------------------------------------------------------
// Grouping logic
// ---------------------------------------------------------------------------

interface Formatters {
  dayHeader: Intl.DateTimeFormat;
  time: Intl.DateTimeFormat;
  shortDate: Intl.DateTimeFormat;
  dateKey: Intl.DateTimeFormat;
}

function buildDayGroups(events: RawEvent[], fmt: Formatters): DayGroup[] {
  const todayStr = toDateKey(new Date(), fmt.dateKey);

  // 1. Detect multi-day sequences: same title on consecutive calendar days
  //    Build a map of title -> sorted list of date keys
  const titleDates = new Map<string, Set<string>>();
  for (const ev of events) {
    const key = ev.title.trim().toLowerCase();
    if (!titleDates.has(key)) titleDates.set(key, new Set());
    titleDates.get(key)!.add(toDateKey(new Date(ev.eventDate), fmt.dateKey));
  }

  // For each title, find the contiguous date range
  const titleRangeLabel = new Map<string, string>();
  Array.from(titleDates.entries()).forEach(([title, dateKeys]) => {
    if (dateKeys.size < 2) return;
    const sorted = Array.from(dateKeys).sort();
    // Check if they form a contiguous sequence
    let contiguous = true;
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1]!);
      prev.setDate(prev.getDate() + 1);
      if (toDateKey(prev, fmt.dateKey) !== sorted[i]) {
        contiguous = false;
        break;
      }
    }
    if (contiguous && sorted.length >= 2) {
      const start = fmt.shortDate.format(new Date(sorted[0]!));
      const end = fmt.shortDate.format(new Date(sorted[sorted.length - 1]!));
      titleRangeLabel.set(title, `(${start}\u2013${end})`);
    }
  });

  // 2. Group events by date in user's timezone
  const grouped = new Map<string, DisplayEvent[]>();
  for (const ev of events) {
    const d = new Date(ev.eventDate);
    const dateStr = toDateKey(d, fmt.dateKey);
    const titleKey = ev.title.trim().toLowerCase();

    const displayEvent: DisplayEvent = {
      ...ev,
      multiDayLabel: titleRangeLabel.get(titleKey) ?? null,
      timeLabel: ev.allDay ? null : formatTimeRange(fmt.time, d, ev.endDate),
    };

    if (!grouped.has(dateStr)) grouped.set(dateStr, []);
    grouped.get(dateStr)!.push(displayEvent);
  }

  // 3. Sort events within each day: all-day first, then by time
  Array.from(grouped.values()).forEach((evs) => {
    evs.sort((a: DisplayEvent, b: DisplayEvent) => {
      if (a.allDay && !b.allDay) return -1;
      if (!a.allDay && b.allDay) return 1;
      return new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime();
    });
  });

  // 4. Build day groups sorted by date
  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateStr, evs]) => ({
      dateKey: dateStr,
      label: fmt.dayHeader.format(new Date(dateStr + "T12:00:00")),
      isToday: dateStr === todayStr,
      events: evs,
    }));
}

// ---------------------------------------------------------------------------
// ActionTooltip — wraps an action button with a 500ms delayed tooltip
// ---------------------------------------------------------------------------

function ActionTooltip({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip delayDuration={500}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

import { FormattedSummary } from "./formatted-summary";

// ---------------------------------------------------------------------------
// EventRow (individual event within a day)
// ---------------------------------------------------------------------------

function EventRow({ event, allChildIds, showEmailSummary }: { event: DisplayEvent; allChildIds: string[]; showEmailSummary: boolean }) {
  const utils = trpc.useUtils();
  const tz = useTimezone();
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(event.title);
  const [editDate, setEditDate] = useState(() => {
    const d = new Date(event.eventDate);
    return toLocalInputValue(d, tz, !event.allDay);
  });

  const updateMutation = trpc.events.update.useMutation({
    onSuccess: () => {
      utils.events.upcoming.invalidate();
      setEditing(false);
      toast({ title: "Event updated" });
    },
    onError: (err) =>
      toast({
        title: "Failed to update event",
        description: err.message,
        variant: "destructive",
      }),
  });

  const deleteMutation = trpc.events.delete.useMutation({
    onSuccess: () => {
      utils.events.upcoming.invalidate();
      toast({ title: "Event deleted" });
    },
    onError: (err) =>
      toast({
        title: "Failed to delete event",
        description: err.message,
        variant: "destructive",
      }),
  });

  const handleSave = () => {
    const eventDateIso = resolveEventDate(editDate, event.allDay, tz);
    if (!eventDateIso) {
      toast({ title: "Invalid date", variant: "destructive" });
      return;
    }
    updateMutation.mutate({
      id: event.id,
      title: editTitle,
      eventDate: eventDateIso,
    });
  };

  const summary = event.processedEmail?.aiSummary;
  const showSummary = showEmailSummary && summary;

  if (editing) {
    return (
      <div className="flex flex-col gap-2 rounded-md border p-2">
        <Input
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          placeholder="Event title"
          className="h-8 text-sm"
        />
        <Input
          type={event.allDay ? "date" : "datetime-local"}
          value={editDate}
          onChange={(e) => setEditDate(e.target.value)}
          className="h-8 text-sm"
        />
        {showSummary && (
          <div className="rounded bg-muted/50 px-2 py-1.5">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Email Summary
            </p>
            <FormattedSummary text={summary} />
          </div>
        )}
        <div className="flex gap-2">
          <Button
            size="sm"
            className="h-7"
            onClick={handleSave}
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? "Saving..." : "Save"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={() => {
              setEditing(false);
              setEditTitle(event.title);
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-start justify-between gap-2 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div
            className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
              event.processedEmail?.forwarded ? "bg-green-500" : "bg-gray-400"
            }`}
          />
          <div className="min-w-0 flex-1">
            <span className={cn("text-sm leading-tight", event.isDone && "line-through text-muted-foreground")}>
              {event.isDone && (
                <span className="font-medium text-green-600">✓ </span>
              )}
              {event.timeLabel && (
                <span className="font-medium text-muted-foreground">
                  {event.timeLabel}{" "}
                </span>
              )}
              {event.isTodo && (
                <span className="font-medium text-amber-600 dark:text-amber-400">TO-DO: </span>
              )}
              {showSummary ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="font-medium text-left hover:text-blue-600 hover:underline cursor-pointer">
                      {event.title}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="bottom" align="start" className="w-80 sm:w-96 max-h-72 overflow-y-auto">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Email Summary
                    </p>
                    <FormattedSummary text={summary} />
                  </PopoverContent>
                </Popover>
              ) : (
                <span className="font-medium">{event.title}</span>
              )}
              {event.multiDayLabel && (
                <span className="ml-1 text-xs text-muted-foreground">
                  {event.multiDayLabel}
                </span>
              )}
            </span>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {event.location && <span>{event.location}</span>}
              {getEventChildDisplay(event.children, allChildIds).badgeChildren.map((child) => (
                <Badge key={child.id} variant="secondary" className="text-[10px] px-1.5 py-0">
                  {child.name}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* Action buttons — visible on hover */}
      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <ActionTooltip label="Download .ics">
          <a href={`/api/events/${event.id}/ics`} download>
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" type="button" tabIndex={-1}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
            </Button>
          </a>
        </ActionTooltip>
        <ActionTooltip label="Add to Google Calendar">
          <a
            href={buildGoogleCalendarUrl({
              title: event.title,
              eventDate: new Date(event.eventDate),
              endDate: event.endDate ? new Date(event.endDate) : null,
              allDay: event.allDay,
              isTodo: event.isTodo,
              location: event.location,
              description: summary,
            })}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" type="button" tabIndex={-1}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </Button>
          </a>
        </ActionTooltip>
        <ActionTooltip label="Edit">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => setEditing(true)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
          </Button>
        </ActionTooltip>
        <AlertDialog>
          <ActionTooltip label="Delete">
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 text-destructive hover:text-destructive"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
              </Button>
            </AlertDialogTrigger>
          </ActionTooltip>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete event?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove &ldquo;{event.title}&rdquo;.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteMutation.mutate({ id: event.id })}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DaySection (a single day with its events)
// ---------------------------------------------------------------------------

function DaySection({ group, allChildIds, showEmailSummary }: { group: DayGroup; allChildIds: string[]; showEmailSummary: boolean }) {
  return (
    <div>
      <div
        className={`sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-1 py-1.5 backdrop-blur-sm ${
          group.isToday ? "border-blue-200" : ""
        }`}
      >
        <span
          className={`text-xs font-semibold uppercase tracking-wide ${
            group.isToday ? "text-blue-600" : "text-muted-foreground"
          }`}
        >
          {group.label}
        </span>
        {group.isToday && (
          <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4">
            Today
          </Badge>
        )}
      </div>
      <div className="divide-y divide-dashed divide-muted/50 pl-2">
        {group.events.map((ev) => (
          <EventRow key={ev.id} event={ev} allChildIds={allChildIds} showEmailSummary={showEmailSummary} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UpcomingEventsCard (main export)
// ---------------------------------------------------------------------------

/** How many day-groups to render per batch as the user scrolls */
const PAGE_SIZE = 5;

export function UpcomingEventsCard() {
  const [expanded, setExpanded] = useState(false);
  const [renderedCount, setRenderedCount] = useState(PAGE_SIZE);
  const tz = useTimezone();

  const fmt = useMemo<Formatters>(() => ({
    dayHeader: createFormatter({ weekday: "short", month: "short", day: "numeric" }, tz),
    time: createFormatter({ hour: "numeric", minute: "2-digit" }, tz),
    shortDate: createFormatter({ month: "short", day: "numeric" }, tz),
    dateKey: createDateKeyFormatter(tz),
  }), [tz]);

  const { data: globalStatus } = trpc.user.globalMonitoringStatus.useQuery();
  const showEmailSummary = globalStatus?.showEmailSummaryInEvents ?? false;

  // Always fetch 30 days to avoid refetch on toggle
  const { data: events, isLoading } = trpc.events.upcoming.useQuery({
    days: 30,
  });
  const { data: childrenData } = trpc.children.list.useQuery();
  const allChildIds = useMemo(
    () => (childrenData ?? []).map((c) => c.id),
    [childrenData],
  );

  const dayGroups = useMemo(() => {
    if (!events) return [];
    return buildDayGroups(events, fmt);
  }, [events, fmt]);

  const visibleGroups = useMemo(
    () => dayGroups.slice(0, renderedCount),
    [dayGroups, renderedCount],
  );

  const hasMore = dayGroups.length > visibleGroups.length;

  // Load more day groups when the sentinel scrolls into view
  const loadMore = useCallback(() => {
    setRenderedCount((prev) => Math.min(prev + PAGE_SIZE, dayGroups.length));
  }, [dayGroups.length]);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    const root = scrollRef.current;
    if (!el || !root) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry?.isIntersecting) loadMore(); },
      { root, rootMargin: "80px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Upcoming Events</CardTitle>
            <CardDescription>
              Dates and deadlines from school emails
            </CardDescription>
          </div>
          {dayGroups.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Reduce" : "Expand"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Loading...
          </p>
        ) : dayGroups.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No upcoming events found.
          </p>
        ) : (
          <TooltipProvider>
            <div
              ref={scrollRef}
              className="overflow-y-auto"
              style={{ maxHeight: expanded ? "546px" : "338px" }}
            >
              <div className="space-y-2">
                {visibleGroups.map((group) => (
                  <DaySection key={group.dateKey} group={group} allChildIds={allChildIds} showEmailSummary={showEmailSummary} />
                ))}
              </div>
              {/* Sentinel triggers loading more day groups on scroll */}
              {hasMore && <div ref={sentinelRef} className="h-1" />}
            </div>
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  );
}
