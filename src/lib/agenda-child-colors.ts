/**
 * Hex-based child color palette for the agenda view.
 *
 * Each slot has two colors:
 *   - color:    saturated accent (for swatches, dots, backgrounds)
 *   - colorInk: darker variant that passes WCAG AA (4.5:1+) against --agenda-bg (#FAFAF7)
 *   - colorInkDark: lighter variant that passes AA against dark --agenda-bg (#121418)
 *
 * Slots are assigned in child creation order (deterministic by index).
 */

export interface AgendaChildColor {
  color: string;
  colorInk: string;
  colorInkDark: string;
}

const PALETTE: AgendaChildColor[] = [
  { color: "#3B82F6", colorInk: "#1E40AF", colorInkDark: "#93C5FD" }, // blue
  { color: "#10B981", colorInk: "#065F46", colorInkDark: "#6EE7B7" }, // green
  { color: "#F59E0B", colorInk: "#92400E", colorInkDark: "#FCD34D" }, // amber
  { color: "#A855F7", colorInk: "#6B21A8", colorInkDark: "#D8B4FE" }, // purple
  { color: "#EC4899", colorInk: "#9D174D", colorInkDark: "#F9A8D4" }, // pink
  { color: "#06B6D4", colorInk: "#155E75", colorInkDark: "#67E8F9" }, // cyan
];

const FALLBACK: AgendaChildColor = {
  color: "#94A3B8",
  colorInk: "#475569",
  colorInkDark: "#CBD5E1",
};

/**
 * Get a deterministic color for a child based on their position among all children.
 */
export function getAgendaChildColor(
  childId: string | null,
  allChildIds: string[],
): AgendaChildColor {
  if (!childId) return FALLBACK;
  const index = allChildIds.indexOf(childId);
  if (index === -1) return FALLBACK;
  return PALETTE[index % PALETTE.length];
}

export { PALETTE as AGENDA_CHILD_PALETTE, FALLBACK as AGENDA_CHILD_FALLBACK };
