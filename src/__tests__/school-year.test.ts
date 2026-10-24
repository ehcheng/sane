import { describe, it, expect } from "vitest";
import { isSummerGracePeriod, countSchoolDays } from "@/lib/school-year";

describe("isSummerGracePeriod", () => {
  it("June 15 is NOT summer (last school day)", () => {
    expect(isSummerGracePeriod(new Date(Date.UTC(2025, 5, 15)))).toBe(false);
  });

  it("June 16 IS summer (first summer day)", () => {
    expect(isSummerGracePeriod(new Date(Date.UTC(2025, 5, 16)))).toBe(true);
  });

  it("July 15 IS summer", () => {
    expect(isSummerGracePeriod(new Date(Date.UTC(2025, 6, 15)))).toBe(true);
  });

  it("Aug 14 IS summer (last summer day)", () => {
    expect(isSummerGracePeriod(new Date(Date.UTC(2025, 7, 14)))).toBe(true);
  });

  it("Aug 15 is NOT summer (first school day)", () => {
    expect(isSummerGracePeriod(new Date(Date.UTC(2025, 7, 15)))).toBe(false);
  });

  it("Jan 1 is NOT summer", () => {
    expect(isSummerGracePeriod(new Date(Date.UTC(2025, 0, 1)))).toBe(false);
  });

  it("Dec 31 is NOT summer", () => {
    expect(isSummerGracePeriod(new Date(Date.UTC(2025, 11, 31)))).toBe(false);
  });
});

describe("countSchoolDays", () => {
  it("same day returns 0", () => {
    const d = new Date(Date.UTC(2025, 8, 15));
    expect(countSchoolDays(d, d)).toBe(0);
  });

  it("to < from returns 0", () => {
    const from = new Date(Date.UTC(2025, 8, 15));
    const to = new Date(Date.UTC(2025, 8, 10));
    expect(countSchoolDays(from, to)).toBe(0);
  });

  it("entirely in school year: Sept 1-30 = 30 days", () => {
    const from = new Date(Date.UTC(2025, 8, 1));
    const to = new Date(Date.UTC(2025, 9, 1)); // Oct 1 exclusive
    expect(countSchoolDays(from, to)).toBe(30);
  });

  it("straddling summer boundary: June 10 to June 20", () => {
    // June 10-15 = 6 school days (inclusive of 10,11,12,13,14,15)
    // June 16-19 = summer (excluded)
    // Total calendar days = 10, summer overlap = 4 (June 16,17,18,19)
    // School days = 6
    const from = new Date(Date.UTC(2025, 5, 10));
    const to = new Date(Date.UTC(2025, 5, 20));
    expect(countSchoolDays(from, to)).toBe(6);
  });

  it("entirely within summer: July 1 to July 15 = 0", () => {
    const from = new Date(Date.UTC(2025, 6, 1));
    const to = new Date(Date.UTC(2025, 6, 15));
    expect(countSchoolDays(from, to)).toBe(0);
  });

  it("long span (>90 days): March 1 to Sept 1 uses mathematical path", () => {
    const from = new Date(Date.UTC(2025, 2, 1)); // March 1
    const to = new Date(Date.UTC(2025, 8, 1));   // Sept 1

    // Total calendar days: March (31) + April (30) + May (31) + June (30) + July (31) + Aug (31) = 184
    // Summer days in range: June 16-30 (15) + July 1-31 (31) + Aug 1-14 (14) = 60
    // School days = 184 - 60 = 124
    expect(countSchoolDays(from, to)).toBe(124);
  });

  it("multi-year: Jan 1 2025 to Jan 1 2027 excludes two summers", () => {
    const from = new Date(Date.UTC(2025, 0, 1));
    const to = new Date(Date.UTC(2027, 0, 1));

    // Total calendar days: 365 (2025) + 365 (2026) = 730
    // Two full summers of 60 days each = 120
    // School days = 730 - 120 = 610
    expect(countSchoolDays(from, to)).toBe(610);
  });
});
