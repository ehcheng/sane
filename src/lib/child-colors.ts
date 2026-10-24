/**
 * Consistent color palette for child badges and event dots.
 * Each child gets a deterministic color based on their position in the list.
 *
 * All colors are chosen for legibility in both light and dark modes:
 * - Light mode: -100 bg with -800 text (WCAG AA contrast)
 * - Dark mode:  -900/50 bg with -200 text (WCAG AA contrast)
 */

const PALETTE = [
  { bg: "bg-blue-100 dark:bg-blue-900/50", text: "text-blue-800 dark:text-blue-200", dot: "bg-blue-500" },
  { bg: "bg-emerald-100 dark:bg-emerald-900/50", text: "text-emerald-800 dark:text-emerald-200", dot: "bg-emerald-500" },
  { bg: "bg-violet-100 dark:bg-violet-900/50", text: "text-violet-800 dark:text-violet-200", dot: "bg-violet-500" },
  { bg: "bg-amber-100 dark:bg-amber-900/50", text: "text-amber-800 dark:text-amber-200", dot: "bg-amber-500" },
  { bg: "bg-rose-100 dark:bg-rose-900/50", text: "text-rose-800 dark:text-rose-200", dot: "bg-rose-500" },
  { bg: "bg-cyan-100 dark:bg-cyan-900/50", text: "text-cyan-800 dark:text-cyan-200", dot: "bg-cyan-500" },
  { bg: "bg-orange-100 dark:bg-orange-900/50", text: "text-orange-800 dark:text-orange-200", dot: "bg-orange-500" },
  { bg: "bg-fuchsia-100 dark:bg-fuchsia-900/50", text: "text-fuchsia-800 dark:text-fuchsia-200", dot: "bg-fuchsia-500" },
] as const;

/** Fallback for events not assigned to any child — still visible in both modes */
const FALLBACK = { bg: "bg-slate-100 dark:bg-slate-800/50", text: "text-slate-700 dark:text-slate-300", dot: "bg-slate-400 dark:bg-slate-500" } as const;

export type ChildColor = (typeof PALETTE)[number] | typeof FALLBACK;

/**
 * Get a deterministic color for a child based on their position among all children.
 * Pass the same `allChildIds` array to get consistent colors across components.
 *
 * Returns a visible fallback color (slate) when childId is null or unknown,
 * so unassigned events still have a color accent.
 */
export function getChildColor(childId: string | null, allChildIds: string[]): ChildColor {
  if (!childId) return FALLBACK;
  const index = allChildIds.indexOf(childId);
  if (index === -1) return FALLBACK;
  return PALETTE[index % PALETTE.length];
}

/**
 * Determine which children to show as badges for an event.
 *
 * When 3+ children exist and ALL are tagged, badges add no information —
 * the event is family-wide. Return an empty array so no badges render,
 * and use the neutral fallback color for the accent bar.
 */
export function getEventChildDisplay(
  eventChildren: Array<{ id: string; name: string }>,
  allChildIds: string[],
): { badgeChildren: Array<{ id: string; name: string }>; accentColor: ChildColor } {
  const isAll = allChildIds.length >= 3 && eventChildren.length >= allChildIds.length;
  if (isAll || eventChildren.length === 0) {
    return { badgeChildren: [], accentColor: FALLBACK };
  }
  return {
    badgeChildren: eventChildren,
    accentColor: getChildColor(eventChildren[0].id, allChildIds),
  };
}
