"use client";

import { useMemo, useRef, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useTimezone } from "@/hooks/use-timezone";
import { toDateKey, createDateKeyFormatter, createFormatter } from "@/lib/date-utils";
import { ActivityItem } from "./activity-item";
import type { ActivityFilterValues } from "./activity-filters";

function computeDateRange(preset: string) {
  if (preset === "all") return {};
  const days = preset === "7d" ? 7 : 30;
  const start = new Date();
  start.setDate(start.getDate() - days);
  start.setHours(0, 0, 0, 0);
  return { startDate: start.toISOString() };
}

// ---------------------------------------------------------------------------
// Date helpers for day grouping (timezone-aware via date-utils)
// ---------------------------------------------------------------------------

function getRelativeInfo(
  dateKey: string,
  todayKey: string,
  formatters: {
    fullDate: Intl.DateTimeFormat;
    monthDay: Intl.DateTimeFormat;
    weekday: Intl.DateTimeFormat;
  }
) {
  const today = new Date(todayKey + "T12:00:00");
  const target = new Date(dateKey + "T12:00:00");
  const diffDays = Math.round(
    (target.getTime() - today.getTime()) / 86400000
  );

  const isToday = diffDays === 0;
  const isPast = diffDays < 0;

  let primary: string;
  let secondary: string;

  if (isToday) {
    primary = "Today";
    secondary = formatters.fullDate.format(target);
  } else if (diffDays === -1) {
    primary = "Yesterday";
    secondary = formatters.fullDate.format(target);
  } else if (diffDays === 1) {
    primary = "Tomorrow";
    secondary = formatters.fullDate.format(target);
  } else if (diffDays < 0 && diffDays > -7) {
    primary = formatters.weekday.format(target);
    secondary = formatters.monthDay.format(target);
  } else {
    primary = formatters.fullDate.format(target);
    secondary = "";
  }

  const dayOfWeek = target.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  return { primary, secondary, isToday, isPast, isWeekend };
}

interface ActivityListProps {
  filters: ActivityFilterValues;
  highlightId?: string | null;
  onHighlightNotFound?: () => void;
}

export function ActivityList({
  filters,
  highlightId,
  onHighlightNotFound,
}: ActivityListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tz = useTimezone();
  const dateRange = computeDateRange(filters.datePreset);

  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } =
    trpc.activity.filtered.useInfiniteQuery(
      {
        sender: filters.sender || undefined,
        keyword: filters.keyword || undefined,
        ...dateRange,
      },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      }
    );

  const allEmails = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data]
  );

  const stats = data?.pages[0]?.stats;

  // Memoize formatters so they survive re-renders (recreated only when tz changes)
  const dateKeyFmt = useMemo(() => createDateKeyFormatter(tz), [tz]);
  const formatters = useMemo(() => ({
    fullDate: createFormatter({ weekday: "long", month: "long", day: "numeric" }, tz),
    monthDay: createFormatter({ month: "long", day: "numeric" }, tz),
    weekday: createFormatter({ weekday: "long" }, tz),
  }), [tz]);

  // Group emails by date for day headers
  const todayKey = toDateKey(new Date(), dateKeyFmt);
  const dayGroups = useMemo(() => {
    const grouped = new Map<string, typeof allEmails>();
    for (const email of allEmails) {
      const key = toDateKey(new Date(email.receivedAt ?? email.createdAt), dateKeyFmt);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(email);
    }
    // Newest date first
    return Array.from(grouped.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([dateKey, emails]) => ({ dateKey, emails }));
  }, [allEmails, dateKeyFmt]);

  // Infinite scroll sentinel
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

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

  // Auto-scroll to highlighted email. If the email isn't in the current page
  // set, load more pages. If all pages are exhausted without finding it,
  // signal the parent so it can widen the date filter.
  // Coupled to SettingsShell's spring animation (~300ms) on mobile.
  // If that animation duration changes, update this value.
  const MOBILE_SLIDE_SETTLE_MS = 350;

  useEffect(() => {
    if (!highlightId) return;
    // Scope lookup to this container to avoid finding duplicate IDs in
    // the hidden desktop/mobile layout twin rendered by SettingsShell.
    const selector = `#activity-${CSS.escape(highlightId)}`;
    const el = containerRef.current?.querySelector<HTMLElement>(selector);
    if (el) {
      // Delay scroll so mobile slide-in animation settles before we scroll.
      const scrollTimer = setTimeout(() => {
        // Re-query in case React unmounted/remounted the node during the delay.
        const freshEl = containerRef.current?.querySelector<HTMLElement>(selector);
        freshEl?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, MOBILE_SLIDE_SETTLE_MS);
      el.classList.add("activity-highlight");
      const highlightTimer = setTimeout(
        () => el.classList.remove("activity-highlight"),
        3000
      );
      return () => {
        clearTimeout(scrollTimer);
        clearTimeout(highlightTimer);
      };
    }
    // Still have pages to check: keep loading
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
      return;
    }
    // No more pages and email not found: ask parent to widen the filter
    if (!hasNextPage && !isFetchingNextPage && !isLoading && onHighlightNotFound) {
      onHighlightNotFound();
    }
  }, [highlightId, allEmails, hasNextPage, isFetchingNextPage, isLoading, fetchNextPage, onHighlightNotFound]);

  if (isLoading) {
    return (
      <div ref={containerRef} className="space-y-4 pt-1">
        {/* Stats placeholder */}
        <div className="h-4 w-52 rounded bg-muted/60 animate-pulse" />
        {/* Day group skeletons */}
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2">
            <div className="flex items-baseline gap-2 border-b pb-1.5">
              <div className="h-5 w-24 rounded bg-muted animate-pulse" />
              <div className="h-4 w-32 rounded bg-muted/60 animate-pulse" />
            </div>
            <div className="h-14 w-full rounded-lg border bg-muted/30 animate-pulse" />
            {i < 2 && (
              <div className="h-14 w-full rounded-lg border bg-muted/30 animate-pulse" />
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="space-y-3">
      {/* Stats summary */}
      {stats && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground" data-tour="emails-stats">
          <span>
            <span className="font-medium tabular-nums">{stats.total}</span>{" "}
            all
          </span>
          <span className="text-border">|</span>
          <span>
            <span className="font-medium tabular-nums">{stats.forwarded}</span>{" "}
            actionable
          </span>
          <span className="text-border">|</span>
          <span>
            <span className="font-medium tabular-nums">{stats.other}</span>{" "}
            FYI
          </span>
        </div>
      )}

      {allEmails.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No emails match your filters.
        </p>
      ) : (
        <div className="space-y-6">
          {dayGroups.map((group) => {
            const info = getRelativeInfo(group.dateKey, todayKey, formatters);
            return (
              <section key={group.dateKey}>
                {/* Day header */}
                <div
                  className={cn(
                    "mb-2 flex items-baseline gap-2 border-b pb-1.5",
                    info.isToday && "border-blue-300 dark:border-blue-700",
                    !info.isToday &&
                      (info.isWeekend
                        ? "border-gray-200 dark:border-gray-800 border-dashed"
                        : "border-border")
                  )}
                >
                  {info.isToday && (
                    <span className="relative flex h-2.5 w-2.5 shrink-0 self-center">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-500" />
                    </span>
                  )}
                  <h3
                    className={cn(
                      "text-sm font-semibold",
                      info.isToday && "text-blue-600 dark:text-blue-400",
                      info.isPast &&
                        !info.isToday &&
                        "text-muted-foreground/70",
                      !info.isToday &&
                        !info.isPast &&
                        (info.isWeekend
                          ? "text-gray-400 dark:text-gray-500"
                          : "text-foreground")
                    )}
                  >
                    {info.primary}
                  </h3>
                  {info.secondary && (
                    <span className="text-xs text-muted-foreground">
                      {info.secondary}
                    </span>
                  )}
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground/50">
                    {group.emails.length}
                  </span>
                </div>

                {/* Emails for this day */}
                <div className="space-y-2">
                  {group.emails.map((email) => (
                    <ActivityItem
                      key={email.id}
                      email={email}
                      defaultExpanded={email.id === highlightId}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          <div ref={sentinelRef} className="h-1" />
          {isFetchingNextPage && (
            <p className="py-2 text-center text-sm text-muted-foreground animate-pulse">
              Loading more...
            </p>
          )}
        </div>
      )}
    </div>
  );
}
