"use client";

import { useTheme } from "next-themes";
import type { AgendaChild } from "./types";

interface ChildNameProps {
  child: AgendaChild;
  className?: string;
}

/**
 * Single source of truth for rendering a child's name in their assigned color.
 * Uses colorInk (light) or colorInkDark (dark) for WCAG AA contrast.
 */
export function ChildName({ child, className = "" }: ChildNameProps) {
  const { resolvedTheme } = useTheme();
  const color = resolvedTheme === "dark" ? child.colorInkDark : child.colorInk;

  return (
    <span
      className={`font-atkinson font-medium ${className}`}
      style={{ color }}
    >
      {child.name}
    </span>
  );
}

interface ChildNameListProps {
  children: AgendaChild[];
  location: string | null;
  muted?: boolean;
  className?: string;
}

/**
 * Renders the metadata line: "Alex, Sam · Lincoln Elem."
 * Each child name in their colorInk. Separators and location in muted.
 */
export function ChildNameList({
  children: kids,
  location,
  muted = false,
  className = "",
}: ChildNameListProps) {
  const opacity = muted ? "opacity-70" : "";

  return (
    <span className={`text-agenda-base font-atkinson ${opacity} ${className}`}>
      {kids.map((child, i) => (
        <span key={child.id}>
          {i > 0 && (
            <span className="text-agenda-ink-muted">, </span>
          )}
          <ChildName child={child} />
        </span>
      ))}
      {kids.length > 0 && location && (
        <span className="text-agenda-ink-muted"> · </span>
      )}
      {location && (
        <span className="text-agenda-ink-muted">{location}</span>
      )}
    </span>
  );
}
