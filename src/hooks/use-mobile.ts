"use client";

import { useState, useEffect } from "react";

/**
 * Pure viewport-width breakpoint check (< 768px).
 * Use for layout decisions (e.g., Sheet vs inline panel) where device type
 * doesn't matter, only screen width. Listens to matchMedia for changes.
 * Returns false during SSR.
 */
export function useIsNarrowViewport(): boolean {
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    setIsNarrow(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isNarrow;
}
