"use client";

/**
 * Glassmorphic blur overlay behind the iOS status bar area.
 * Only visible in PWA standalone mode on devices with a safe area inset.
 * Creates the native-app effect where content blurs behind the notch/Dynamic Island.
 *
 * Uses pure CSS (display-mode: standalone media query) instead of JS detection
 * to avoid any flash or layout shift.
 */
export function StatusBarBlur() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-safe-top bg-background/60 backdrop-blur-xl [-webkit-backdrop-filter:blur(24px)] [display:none] [@media(display-mode:standalone)]:block"
      style={{
        maskImage: "linear-gradient(to bottom, black 50%, transparent)",
        WebkitMaskImage: "linear-gradient(to bottom, black 50%, transparent)",
      }}
    />
  );
}
