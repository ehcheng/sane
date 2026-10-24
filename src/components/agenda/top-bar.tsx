"use client";

import { Menu, SlidersHorizontal } from "lucide-react";

interface TopBarProps {
  currentDayLabel: string;
  hasActiveFilter: boolean;
  onMenuOpen: () => void;
  onFilterOpen: () => void;
  onDayTap: () => void;
}

/**
 * Top bar: 48px height.
 * Left: menu icon. Center: current day label (tappable). Right: filter.
 */
export function TopBar({
  currentDayLabel,
  hasActiveFilter,
  onMenuOpen,
  onFilterOpen,
  onDayTap,
}: TopBarProps) {
  return (
    <header className="relative flex items-center h-12 px-[var(--agenda-gutter)] bg-[var(--agenda-bg)] border-b border-[var(--agenda-divider)]">
      <button
        type="button"
        onClick={onMenuOpen}
        className="flex items-center justify-center w-11 h-11 -ml-2 rounded-lg text-agenda-ink focus-visible:outline-2 focus-visible:outline-agenda-accent"
        aria-label="Open menu"
      >
        <Menu size={22} strokeWidth={2} />
      </button>

      <button
        type="button"
        onClick={onDayTap}
        className="flex-1 text-center font-atkinson font-bold text-agenda-base text-agenda-ink truncate px-2 h-full flex items-center justify-center focus-visible:outline-2 focus-visible:outline-agenda-accent"
        aria-label={`Current view: ${currentDayLabel}. Tap to pick a date.`}
      >
        {currentDayLabel}
      </button>

      <button
        type="button"
        onClick={onFilterOpen}
        className="relative flex items-center justify-center w-11 h-11 -mr-2 rounded-lg text-agenda-ink focus-visible:outline-2 focus-visible:outline-agenda-accent"
        aria-label="Open filter"
      >
        <SlidersHorizontal size={20} strokeWidth={2} />
        {hasActiveFilter && (
          <span
            className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-agenda-accent"
            aria-hidden="true"
          />
        )}
      </button>
    </header>
  );
}
