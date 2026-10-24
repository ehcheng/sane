"use client";

import { useEffect, useRef } from "react";
import type { TourId } from "./tour-definitions";
import { useTourContext } from "./tour-provider";

/**
 * Hook for pages to trigger their tour when ready conditions are met.
 *
 * @param tourId - Which tour to trigger ("events" | "emails" | "settings")
 * @param ready - Boolean condition that must be true before the tour fires
 *
 * The tour will only fire once per user (tracked in DB).
 * If the user navigates away mid-tour, it resets and will re-show next visit.
 */
export function useTour(tourId: TourId, ready: boolean) {
  const { completedTours, activeTourId, startTour, isReady } =
    useTourContext();
  const hasStarted = useRef(false);

  useEffect(() => {
    if (hasStarted.current) return;
    if (!isReady) return;
    if (!ready) return;
    if (completedTours.includes(tourId)) return;
    if (activeTourId !== null) return;

    // Wait for paint to settle, then start
    const timer = setTimeout(() => {
      // Re-check guards inside the timeout — deps may have changed
      if (hasStarted.current) return;
      hasStarted.current = true;
      startTour(tourId);
    }, 600);

    return () => clearTimeout(timer);
  }, [tourId, ready, completedTours, activeTourId, startTour, isReady]);
}
