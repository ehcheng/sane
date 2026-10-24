"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, useSpring, useTransform } from "motion/react";
import { Loader2 } from "lucide-react";

const PULL_THRESHOLD = 80; // px required to trigger refresh
const MAX_PULL = 120; // max visual displacement
const RESISTANCE = 0.4; // rubber-band resistance factor

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  /** Only enable on mobile viewports (default: true) */
  mobileOnly?: boolean;
  children: React.ReactNode;
}

/**
 * Pull-to-refresh wrapper. Listens for touch gestures on its container
 * when the page is scrolled to top, shows a spring-animated indicator,
 * and calls onRefresh when the user pulls past the threshold.
 *
 * Uses passive listeners so normal scrolling is never blocked.
 * The container uses overscroll-behavior-y:contain to suppress
 * the browser's native rubber-band bounce on iOS/Android.
 *
 * Only activates on touch devices at narrow viewports. Desktop is unaffected.
 */
export function PullToRefresh({
  onRefresh,
  mobileOnly = true,
  children,
}: PullToRefreshProps) {
  const [refreshing, setRefreshing] = useState(false);
  const pullY = useSpring(0, { stiffness: 300, damping: 30 });
  const opacity = useTransform(pullY, [0, PULL_THRESHOLD * 0.5, PULL_THRESHOLD], [0, 0.5, 1]);
  const scale = useTransform(pullY, [0, PULL_THRESHOLD], [0.5, 1]);
  const rotation = useTransform(pullY, [0, PULL_THRESHOLD, MAX_PULL], [0, 180, 270]);

  const startYRef = useRef(0);
  const pullingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (refreshing) return;
      // Only start pull if page is at the top
      if (window.scrollY > 0) return;
      startYRef.current = e.touches[0].clientY;
      pullingRef.current = false;
    },
    [refreshing]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (refreshing) return;
      if (window.scrollY > 0) {
        // User scrolled away from top, cancel pull
        pullingRef.current = false;
        pullY.set(0);
        return;
      }

      const deltaY = e.touches[0].clientY - startYRef.current;
      if (deltaY <= 0) {
        pullingRef.current = false;
        pullY.set(0);
        return;
      }

      // Start pulling
      pullingRef.current = true;
      const dampedDelta = Math.min(deltaY * RESISTANCE, MAX_PULL);
      pullY.set(dampedDelta);
    },
    [refreshing, pullY]
  );

  const handleTouchEnd = useCallback(async () => {
    if (!pullingRef.current || refreshing) {
      pullY.set(0);
      return;
    }
    pullingRef.current = false;

    const currentPull = pullY.get();
    if (currentPull >= PULL_THRESHOLD) {
      // Hold at a small offset while refreshing
      pullY.set(50);
      setRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        pullY.set(0);
      }
    } else {
      pullY.set(0);
    }
  }, [refreshing, pullY, onRefresh]);

  useEffect(() => {
    const el = containerRef.current;
    // Only attach on touch-capable devices
    if (!el || !("ontouchstart" in window)) return;
    // Skip on desktop if mobileOnly
    if (mobileOnly && window.innerWidth >= 768) return;

    const opts: AddEventListenerOptions = { passive: true };
    el.addEventListener("touchstart", handleTouchStart, opts);
    el.addEventListener("touchmove", handleTouchMove, opts);
    el.addEventListener("touchend", handleTouchEnd, opts);
    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd, mobileOnly]);

  return (
    <div ref={containerRef} className="relative overscroll-y-contain">
      {/* Pull indicator */}
      <motion.div
        className="pointer-events-none absolute left-0 right-0 flex items-center justify-center"
        style={{
          top: -44,
          y: pullY,
          opacity,
        }}
      >
        <motion.div
          className="flex h-9 w-9 items-center justify-center rounded-full bg-background shadow-md border"
          style={{ scale }}
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : (
            <motion.svg
              className="h-4 w-4 text-primary"
              style={{ rotate: rotation }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14M5 12l7-7 7 7" />
            </motion.svg>
          )}
        </motion.div>
      </motion.div>

      {children}
    </div>
  );
}
