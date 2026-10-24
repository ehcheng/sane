/**
 * School year and summer grace period utilities for user lifecycle management.
 *
 * School year: Aug 15 through June 15 (inclusive).
 * Summer grace period: June 16 through Aug 14 (inclusive). That is 60 days.
 *
 * During summer, inactivity days do not count toward deactivation thresholds.
 */

/** Summer is exactly 60 days: June 16-30 (15) + July (31) + Aug 1-14 (14). */
const SUMMER_DAYS = 60;

/** Check if a given date falls within the summer grace period (June 16 - Aug 14). */
export function isSummerGracePeriod(date: Date): boolean {
  const month = date.getUTCMonth(); // 0-indexed: 0=Jan, 5=Jun, 6=Jul, 7=Aug
  const day = date.getUTCDate();

  if (month === 5 && day >= 16) return true;
  if (month === 6) return true;
  if (month === 7 && day <= 14) return true;

  return false;
}

/**
 * Count the number of "school days" between two dates.
 * Days that fall within the summer grace period are excluded from the count.
 * Uses UTC dates to avoid timezone drift in daily cron jobs.
 *
 * Optimized: calculates full summers mathematically, only iterates partial
 * boundary periods. Handles multi-year spans without day-by-day looping.
 */
export function countSchoolDays(from: Date, to: Date): number {
  if (to <= from) return 0;

  const fromMs = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const toMs = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  const totalCalendarDays = Math.floor((toMs - fromMs) / (24 * 60 * 60 * 1000));

  if (totalCalendarDays <= 0) return 0;

  // For short spans (under 90 days), iterate directly: simpler and fast enough
  if (totalCalendarDays <= 90) {
    let days = 0;
    const cursor = new Date(fromMs);
    const end = new Date(toMs);
    while (cursor < end) {
      if (!isSummerGracePeriod(cursor)) days++;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return days;
  }

  // For longer spans, calculate summer days mathematically.
  // Count full summers between the start and end years, then handle
  // partial summers at the boundaries.
  const startYear = from.getUTCFullYear();
  const endYear = to.getUTCFullYear();

  let summerDays = 0;

  for (let year = startYear; year <= endYear; year++) {
    // Summer window for this year: June 16 - Aug 14
    const summerStart = Date.UTC(year, 5, 16); // June 16
    const summerEnd = Date.UTC(year, 7, 15);   // Aug 15 (exclusive end)

    // Overlap between [from, to) and [summerStart, summerEnd)
    const overlapStart = Math.max(fromMs, summerStart);
    const overlapEnd = Math.min(toMs, summerEnd);

    if (overlapStart < overlapEnd) {
      summerDays += Math.floor((overlapEnd - overlapStart) / (24 * 60 * 60 * 1000));
    }
  }

  return totalCalendarDays - summerDays;
}
