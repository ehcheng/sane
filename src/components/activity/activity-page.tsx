"use client";

import { useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { trpc } from "@/lib/trpc";
import {
  ActivityFilters,
  type ActivityFilterValues,
} from "./activity-filters";
import { ActivityList } from "./activity-list";
import { CsvExportButton } from "./csv-export-button";
import { useTour } from "@/components/tour/use-tour";
import { LifetimeStatsBar } from "./lifetime-stats-bar";

const DEFAULT_FILTERS: ActivityFilterValues = {
  sender: "",
  keyword: "",
  datePreset: "7d",
};

// When a deep-linked email isn't found in the current date range,
// widen the filter automatically: 7d -> 30d -> all.
const WIDEN_ORDER: ActivityFilterValues["datePreset"][] = ["7d", "30d", "all"];

export function ActivityPage() {
  const searchParams = useSearchParams();

  // Deep-link: ?emailId=xxx highlights that email, ?fromEvent=title shows context
  const highlightId = searchParams.get("emailId");
  const fromEventTitle = searchParams.get("fromEvent");

  const [filters, setFilters] = useState<ActivityFilterValues>(DEFAULT_FILTERS);

  // Track whether we already widened for this highlightId so we don't loop
  const widenedRef = useRef<string | null>(null);

  const handleFilterChange = useCallback(
    (newFilters: ActivityFilterValues) => {
      setFilters(newFilters);
    },
    []
  );

  // Called by ActivityList when the highlighted email isn't found after
  // exhausting all pages in the current date range.
  const handleHighlightNotFound = useCallback(() => {
    if (!highlightId) return;
    setFilters((prev) => {
      const currentIdx = WIDEN_ORDER.indexOf(prev.datePreset);
      const nextIdx = currentIdx + 1;
      if (nextIdx >= WIDEN_ORDER.length) return prev; // already at "all"
      const nextPreset = WIDEN_ORDER[nextIdx]!;
      // Don't widen the same highlightId past a preset we already tried
      if (widenedRef.current === `${highlightId}:${nextPreset}`) return prev;
      widenedRef.current = `${highlightId}:${nextPreset}`;
      return { ...prev, datePreset: nextPreset };
    });
  }, [highlightId]);

  const { data: user } = trpc.user.me.useQuery();
  const wizardComplete = (user?.wizardStep ?? 0) >= 3;
  useTour("emails", wizardComplete);

  return (
    <div className="space-y-4">
      {/* Lifetime stats */}
      <LifetimeStatsBar />

      {/* Controls: filters + export */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <ActivityFilters values={filters} onChange={handleFilterChange} />
        <CsvExportButton filters={filters} />
      </div>

      {/* Context callout when navigating from an event */}
      {fromEventTitle && highlightId && (
        <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
          <span>
            Showing source email for: <strong>{fromEventTitle}</strong>
          </span>
        </div>
      )}

      {/* Email list */}
      <ActivityList
        filters={filters}
        highlightId={highlightId}
        onHighlightNotFound={handleHighlightNotFound}
      />
    </div>
  );
}
