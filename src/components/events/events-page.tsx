"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus, Calendar, List, Loader2, CalendarX2, CheckCircle2, AlertCircle, XCircle, X, Filter } from "lucide-react";
import { keepPreviousData } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { CalendarMonthView } from "./calendar-month-view";
import { AgendaWithMiniMonth } from "./agenda-with-mini-month";
import { CreateEventDialog } from "./create-event-dialog";
import { PullToRefresh } from "@/components/ui/pull-to-refresh";
import { getChildColor } from "@/lib/child-colors";
import { useTour } from "@/components/tour/use-tour";
import { useTimezone } from "@/hooks/use-timezone";
import { todayDateKey as todayKey, createFormatter } from "@/lib/date-utils";
import type { BackfillProgress, BackfillStatus } from "@/lib/backfill-types";

function parseMonth(param: string | null): { year: number; month: number } {
  if (param) {
    const [y, m] = param.split("-").map(Number);
    if (y && m && m >= 1 && m <= 12) return { year: y, month: m - 1 };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

// ---------------------------------------------------------------------------
// Skeleton loaders
// ---------------------------------------------------------------------------

/** Shown as the Suspense fallback before useSearchParams hydrates */
export function EventsPageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="h-8 w-32 rounded bg-muted animate-pulse" />
        <div className="h-9 w-28 rounded-md bg-muted animate-pulse" />
      </div>
      <div className="flex items-center gap-2">
        <div className="h-8 w-40 rounded-md bg-muted animate-pulse" />
        <div className="h-8 w-52 rounded-md bg-muted animate-pulse" />
      </div>
      <AgendaSkeleton />
    </div>
  );
}

function AgendaSkeleton() {
  return (
    <div className="space-y-6 pt-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-2">
          <div className="flex items-baseline gap-2 border-b pb-2">
            <div className="h-5 w-28 rounded bg-muted animate-pulse" />
            <div className="h-4 w-40 rounded bg-muted/60 animate-pulse" />
          </div>
          <div className="h-[4.25rem] w-full rounded-lg border bg-muted/30 animate-pulse" />
          {i < 2 && (
            <div className="h-[4.25rem] w-full rounded-lg border bg-muted/30 animate-pulse" />
          )}
        </div>
      ))}
    </div>
  );
}

function MonthSkeleton() {
  return (
    <div>
      <div className="grid grid-cols-7 border-b">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="py-2 text-center">
            <div className="mx-auto h-4 w-6 rounded bg-muted animate-pulse" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: 35 }).map((_, i) => (
          <div
            key={i}
            className="min-h-[3.5rem] border-b border-r p-1 sm:min-h-[5.5rem]"
          >
            <div className="h-6 w-6 rounded-full bg-muted/50 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline backfill progress banner (shown above events during backfill)
// ---------------------------------------------------------------------------

function BackfillInlineProgress({
  progress,
  status,
  isFading,
  onCancel,
}: {
  progress: BackfillProgress;
  status: BackfillStatus;
  isFading: boolean;
  onCancel?: () => void;
}) {
  const isComplete = status === "completed" || progress.phase === "complete";
  const isFailed = status === "failed";
  const isCancelled = status === "cancelled";
  const isCancelling = status === "cancelling";
  const isActive = status === "active" || isCancelling;
  const pct =
    progress.total && progress.total > 0
      ? Math.round(((progress.current ?? 0) / progress.total) * 100)
      : 0;

  if (isFailed) {
    return (
      <div
        className={cn(
          "rounded-lg border border-red-200 bg-red-50 p-3 transition-opacity duration-500 dark:border-red-800 dark:bg-red-950",
          isFading && "opacity-0"
        )}
      >
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
          <p className="text-sm font-medium text-red-900 dark:text-red-100">
            Email scan encountered an error
          </p>
        </div>
      </div>
    );
  }

  if (isCancelled) {
    return (
      <div
        className={cn(
          "rounded-lg border border-amber-200 bg-amber-50 p-3 transition-opacity duration-500 dark:border-amber-800 dark:bg-amber-950",
          isFading && "opacity-0"
        )}
      >
        <div className="flex items-center gap-2">
          <XCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
            {progress.message ?? "Scan cancelled"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-opacity duration-500",
        isComplete
          ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950"
          : "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950",
        isFading && "opacity-0"
      )}
    >
      <div className="flex items-center gap-2">
        {isComplete ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
        ) : (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600 dark:text-blue-400" />
        )}
        <p
          className={cn(
            "text-sm font-medium",
            isComplete
              ? "text-green-900 dark:text-green-100"
              : "text-blue-900 dark:text-blue-100"
          )}
        >
          {isComplete
            ? (progress.message ?? "Scan complete!")
            : isCancelling
              ? "Cancelling..."
              : (progress.message ?? "Scanning emails...")}
        </p>
        {isActive && !isCancelling && onCancel && (
          <button
            onClick={() => {
              if (window.confirm("Cancel the email scan? Emails already processed will be kept.")) {
                onCancel();
              }
            }}
            className="ml-auto shrink-0 rounded p-0.5 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200"
            title="Cancel scan"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {isCancelling && (
          <span className="ml-auto text-xs text-blue-600 dark:text-blue-400">Cancelling...</span>
        )}
      </div>

      {/* Progress bar — show when we have a total and not yet complete */}
      {!isComplete && progress.total && progress.total > 0 && (
        <div className="mt-2 pl-6">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-200 dark:bg-blue-800">
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-300 dark:bg-blue-400"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-blue-700 dark:text-blue-300">
            {progress.current} of {progress.total} emails
            {(progress.eventsFound ?? 0) > 0 && (
              <> &middot; {progress.eventsFound} event{progress.eventsFound === 1 ? "" : "s"} found</>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

function EmptyEventsState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <CalendarX2 className="mb-4 h-10 w-10 text-muted-foreground/60" />
      <h2 className="text-lg font-semibold">No events found yet</h2>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        As new school emails arrive, events will appear here automatically.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EventsPage
// ---------------------------------------------------------------------------

export function EventsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tz = useTimezone();

  const { data: user } = trpc.user.me.useQuery();
  const defaultView = user?.defaultEventsView === "month" ? "month" : "agenda";

  const monthFormatter = useMemo(
    () => createFormatter({ month: "long", year: "numeric" }, tz),
    [tz]
  );

  // URL-driven state
  const viewParam = searchParams.get("view");
  const view = viewParam ? (viewParam === "month" ? "month" : "agenda") : defaultView;
  const { year, month } = parseMonth(searchParams.get("month"));
  const childIdParam = searchParams.get("childId") ?? "";

  // Backfill status — poll while active, stop when done
  const isSetupRedirect = searchParams.get("setup") === "1";
  const utils = trpc.useUtils();
  const prevBackfillStatusRef = useRef<string | undefined>();
  const [completionVisible, setCompletionVisible] = useState(false);
  const [backfillWasActive, setBackfillWasActive] = useState(false);
  // Track whether we've ever seen "active" during this setup redirect.
  // Before seeing active, treat "idle" as still-pending (worker hasn't picked up job yet).
  const seenActiveRef = useRef(false);

  const { data: backfillData } = trpc.email.backfillStatus.useQuery(undefined, {
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "active" || status === "cancelling") return 2000;
      // Keep polling on setup redirect until we've seen active→completed
      if (isSetupRedirect && !seenActiveRef.current) return 2000;
      return false;
    },
  });

  const cancelBackfill = trpc.email.cancelBackfill.useMutation();

  const backfillStatus = backfillData?.status;
  if (backfillStatus === "active") seenActiveRef.current = true;
  const backfillActive =
    backfillStatus === "active" ||
    backfillStatus === "cancelling" ||
    // Setup redirect: treat as active until we've seen the job start
    (isSetupRedirect && !seenActiveRef.current);
  const showBanner = backfillActive || completionVisible;

  // Actionable-only filter — persisted in localStorage
  const [actionableOnly, setActionableOnly] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("sane:actionableOnly") === "true";
  });
  const toggleActionable = useCallback((checked: boolean) => {
    setActionableOnly(checked);
    localStorage.setItem("sane:actionableOnly", String(checked));
  }, []);

  const [createOpen, setCreateOpen] = useState(false);
  // Counter incremented to trigger auto-select today in month view
  const [autoSelectTodaySeq, setAutoSelectTodaySeq] = useState(0);
  // Counter to signal AgendaWithMiniMonth to scroll to today
  const [scrollToTodaySeq, setScrollToTodaySeq] = useState(0);

  // Helpers to update URL params
  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      router.replace(`/events?${params.toString()}`, { scroll: false });
    },
    [searchParams, router]
  );

  const setMonth = useCallback(
    (y: number, m: number) => {
      setParam("month", `${y}-${String(m + 1).padStart(2, "0")}`);
    },
    [setParam]
  );

  const navigateMonth = useCallback(
    (delta: number) => {
      const d = new Date(year, month + delta, 1);
      setMonth(d.getFullYear(), d.getMonth());
    },
    [year, month, setMonth]
  );

  const goToToday = useCallback(() => {
    const now = new Date();
    setMonth(now.getFullYear(), now.getMonth());
  }, [setMonth]);

  // Listen for nav re-click (clicking Events nav while already on Events page)
  useEffect(() => {
    const handler = () => {
      goToToday();
      setScrollToTodaySeq((s) => s + 1);
    };
    window.addEventListener("nav-reclick", handler);
    return () => window.removeEventListener("nav-reclick", handler);
  }, [goToToday]);

  // Data: children for filtering/colors
  const { data: childrenData } = trpc.children.list.useQuery();
  const children = childrenData ?? [];
  const allChildIds = useMemo(() => children.map((c) => c.id), [children]);

  // Compute date range for the current view
  const { startDate, endDate } = useMemo(() => {
    if (view === "month") {
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0, 23, 59, 59);
      return {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      };
    }
    // Start from first of month so mini-month dots have data for the
    // full month. End 90 days from today (or end of month, whichever is later).
    const start = new Date(year, month, 1);
    const now = new Date();
    const endFromToday = new Date(now);
    endFromToday.setDate(endFromToday.getDate() + 90);
    const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59);
    const end = endFromToday > endOfMonth ? endFromToday : endOfMonth;
    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    };
  }, [view, year, month]);

  const {
    data: eventsData,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    isLoading: isEventsLoading,
  } = trpc.events.list.useInfiniteQuery(
    {
      startDate,
      endDate,
      ...(childIdParam ? { childId: childIdParam } : {}),
      ...(actionableOnly ? { actionableOnly: true } : {}),
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: keepPreviousData,
      refetchInterval: backfillActive ? 3000 : false,
    }
  );

  const allEvents = useMemo(
    () => eventsData?.pages.flatMap((p) => p.items) ?? [],
    [eventsData]
  );

  // Hide actionable toggle when all events are already actionable
  const hasNonActionable = eventsData?.pages[0]?.hasNonActionable ?? false;

  // Track that backfill was ever active during this page visit
  useEffect(() => {
    if (backfillStatus === "active") setBackfillWasActive(true);
  }, [backfillStatus]);

  // Handle backfill completion: invalidate events, show completion banner, clean URL
  useEffect(() => {
    const prev = prevBackfillStatusRef.current;
    prevBackfillStatusRef.current = backfillStatus;

    if (
      (prev === "active" || prev === "cancelling") &&
      (backfillStatus === "completed" || backfillStatus === "failed" || backfillStatus === "cancelled")
    ) {
      // Invalidate events so the final batch appears immediately
      utils.events.list.invalidate();
      setCompletionVisible(true);

      // Clean up ?setup=1 param
      const params = new URLSearchParams(searchParams.toString());
      params.delete("setup");
      router.replace(`/events?${params.toString()}`, { scroll: false });

      // Auto-fade the completion banner after 4s
      const timer = setTimeout(() => setCompletionVisible(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [backfillStatus, searchParams, router, utils]);

  const handleAddEvent = useCallback(() => {
    setCreateOpen(true);
  }, []);

  const handlePullRefresh = useCallback(async () => {
    await utils.events.list.invalidate();
  }, [utils]);

  // FTU tour: fire once events query resolves and wizard is complete.
  // Runs alongside backfill — tour steps have skipWhen guards for missing elements.
  const wizardComplete = (user?.wizardStep ?? 0) >= 3;
  useTour("events", !isEventsLoading && wizardComplete);

  // Check if we're viewing the current month
  const now = new Date();
  const isCurrentMonth =
    year === now.getFullYear() && month === now.getMonth();

  // Show empty state only if backfill ran and completed with no events
  const showEmptyState =
    backfillWasActive &&
    !backfillActive &&
    allEvents.length === 0 &&
    !isEventsLoading;

  return (
    <div className="space-y-4">
      {/* Inline backfill progress banner — above the events list */}
      {showBanner && backfillData && (
        <BackfillInlineProgress
          progress={(backfillData.progress ?? {}) as BackfillProgress}
          status={backfillData.status as BackfillStatus}
          isFading={completionVisible && !backfillActive}
          onCancel={() => cancelBackfill.mutate()}
        />
      )}

      {/* Waiting-for-backfill placeholder (before first status response) */}
      {backfillActive && !backfillData && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600 dark:text-blue-400" />
            <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
              Starting email scan...
            </p>
          </div>
        </div>
      )}

      {showEmptyState ? (
        <EmptyEventsState />
      ) : (
        <>
          {/* Controls bar: view toggle, month nav, child filter */}
          <div className="sticky top-14 z-30 -mx-4 space-y-1.5 border-b bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            {/* Row 1: Month nav + view toggle */}
            <div className="flex items-center gap-2">
              {/* Month navigation */}
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 md:h-8 md:w-8"
                  onClick={() => navigateMonth(-1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <button
                  type="button"
                  className="min-w-[120px] text-center text-sm font-medium text-foreground md:min-w-[140px]"
                  onClick={() => {
                    goToToday();
                    if (view === "agenda") setScrollToTodaySeq((s) => s + 1);
                    else setAutoSelectTodaySeq((s) => s + 1);
                  }}
                >
                  {monthFormatter.format(new Date(year, month))}
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 md:h-8 md:w-8"
                  onClick={() => navigateMonth(1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              <div className="ml-auto flex items-center gap-2">
                {/* View toggle — segment control */}
                <div className="flex rounded-lg border p-0.5" data-tour="events-view-toggle">
                  <button
                    type="button"
                    className={cn(
                      "flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors md:px-3",
                      view === "agenda"
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => {
                      if (view === "agenda") {
                        goToToday();
                        setScrollToTodaySeq((s) => s + 1);
                      } else {
                        window.scrollTo({ top: 0, behavior: "instant" });
                        setParam("view", "agenda");
                        setTimeout(() => {
                          setScrollToTodaySeq((s) => s + 1);
                        }, 150);
                      }
                    }}
                  >
                    <List className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Agenda</span>
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors md:px-3",
                      view === "month"
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => {
                      window.scrollTo({ top: 0, behavior: "smooth" });
                      if (view === "month") {
                        goToToday();
                        setAutoSelectTodaySeq((s) => s + 1);
                      } else {
                        setParam("view", "month");
                      }
                    }}
                  >
                    <Calendar className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Month</span>
                  </button>
                </div>

                {/* Add event — desktop only (mobile uses FAB) */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="hidden h-8 gap-1 px-2 text-xs text-muted-foreground md:flex"
                  onClick={handleAddEvent}
                  data-tour="events-add-event"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Event
                </Button>
              </div>
            </div>

            {/* Row 2: Child filter + actionable toggle (only when needed) */}
            {(children.length > 1 || hasNonActionable) && (
              <div className="flex items-center gap-2">
                {/* Child filter — horizontal scroll on mobile, wrap on desktop */}
                {children.length > 1 && (
                  <div
                    className="-mx-4 flex gap-1.5 overflow-x-auto px-4 scrollbar-none md:mx-0 md:flex-wrap md:px-0"
                    data-tour="events-child-filter"
                  >
                    <Badge
                      variant={!childIdParam ? "default" : "outline"}
                      className={cn(
                        "shrink-0 cursor-pointer px-3 py-1 text-xs",
                        !childIdParam && "bg-foreground text-background"
                      )}
                      onClick={() => setParam("childId", "")}
                    >
                      All
                    </Badge>
                    {children.map((child) => {
                      const color = getChildColor(child.id, allChildIds);
                      const isActive = childIdParam === child.id;
                      return (
                        <Badge
                          key={child.id}
                          variant="outline"
                          className={cn(
                            "shrink-0 cursor-pointer px-3 py-1 text-xs",
                            isActive
                              ? cn(color.bg, color.text)
                              : cn(color.text, "hover:opacity-80")
                          )}
                          onClick={() =>
                            setParam("childId", isActive ? "" : child.id)
                          }
                        >
                          <span className={cn("mr-1 inline-block h-2 w-2 rounded-full", color.dot)} />
                          {child.name}
                        </Badge>
                      );
                    })}
                  </div>
                )}

                {/* Actionable-only filter toggle */}
                {hasNonActionable && (
                  <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                    <Filter className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Actionable</span>
                    <Switch
                      checked={actionableOnly}
                      onCheckedChange={toggleActionable}
                      className="scale-75"
                    />
                  </label>
                )}
              </div>
            )}
          </div>

          {/* Mobile FAB — Add Event */}
          <button
            type="button"
            className="fixed bottom-[calc(var(--mobile-tab-bar-h)+env(safe-area-inset-bottom)+1rem)] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg active:scale-95 transition-transform md:hidden"
            onClick={handleAddEvent}
            data-tour="events-add-event-mobile"
            aria-label="Add event"
          >
            <Plus className="h-6 w-6" />
          </button>

          {/* Calendar content */}
          <PullToRefresh onRefresh={handlePullRefresh}>
            {isEventsLoading ? (
              view === "month" ? (
                <MonthSkeleton />
              ) : (
                <AgendaSkeleton />
              )
            ) : view === "month" ? (
              <CalendarMonthView
                year={year}
                month={month}
                events={allEvents}
                allChildIds={allChildIds}
                autoSelectDay={autoSelectTodaySeq > 0 ? todayKey(tz) : null}
                autoSelectSeq={autoSelectTodaySeq}
                tz={tz}
              />
            ) : (
              <AgendaWithMiniMonth
                year={year}
                month={month}
                events={allEvents}
                allChildIds={allChildIds}
                hasMore={!!hasNextPage}
                isFetchingMore={isFetchingNextPage}
                onLoadMore={() => fetchNextPage()}
                rangeStart={startDate}
                scrollToTodaySeq={scrollToTodaySeq}
                tz={tz}
              />
            )}
          </PullToRefresh>
        </>
      )}

      {/* Create event dialog */}
      <CreateEventDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        children={children.map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
