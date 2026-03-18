import { describe, it, expect } from "vitest";
import { countBusinessDays, calculateRequestDays, calculateRemainingDays, calculateCarryoverFromPreviousYear } from "../allowance.js";

describe("countBusinessDays", () => {
  it("counts weekdays only", () => {
    // Mon 2026-03-09 to Fri 2026-03-13 = 5 days
    expect(countBusinessDays("2026-03-09", "2026-03-13", [])).toBe(5);
  });

  it("excludes weekends", () => {
    // Mon 2026-03-09 to Sun 2026-03-15 = 5 weekdays
    expect(countBusinessDays("2026-03-09", "2026-03-15", [])).toBe(5);
  });

  it("handles single day (weekday)", () => {
    expect(countBusinessDays("2026-03-09", "2026-03-09", [])).toBe(1);
  });

  it("handles single day (weekend)", () => {
    // 2026-03-14 is a Saturday
    expect(countBusinessDays("2026-03-14", "2026-03-14", [])).toBe(0);
  });

  it("excludes public holidays", () => {
    // Mon-Fri but Wednesday is a public holiday
    expect(countBusinessDays("2026-03-09", "2026-03-13", ["2026-03-11"])).toBe(4);
  });

  it("handles two full weeks", () => {
    // Mon 2026-03-09 to Fri 2026-03-20 = 10 weekdays
    expect(countBusinessDays("2026-03-09", "2026-03-20", [])).toBe(10);
  });

  it("excludes public holidays across year boundary (Christmas 2024-2025)", () => {
    // 2024-12-23 (Mon) to 2025-01-03 (Fri) = 10 weekdays
    // Minus: Dec 25 (Wed), Dec 26 (Thu), Jan 1 (Wed) = 3 public holidays
    // Expected: 7 business days
    const holidays = ["2024-12-25", "2024-12-26", "2025-01-01"];
    expect(countBusinessDays("2024-12-23", "2025-01-03", holidays)).toBe(7);
  });

  it("excludes public holidays across year boundary without holidays list", () => {
    // Same range but no holidays passed => all 10 weekdays counted (the bug case)
    expect(countBusinessDays("2024-12-23", "2025-01-03", [])).toBe(10);
  });
});

describe("calculateRequestDays", () => {
  it("full days, no half days", () => {
    expect(calculateRequestDays("2026-03-09", "2026-03-13", false, false, [])).toBe(5);
  });

  it("half day start", () => {
    expect(calculateRequestDays("2026-03-09", "2026-03-13", true, false, [])).toBe(4.5);
  });

  it("half day end", () => {
    expect(calculateRequestDays("2026-03-09", "2026-03-13", false, true, [])).toBe(4.5);
  });

  it("both half days", () => {
    expect(calculateRequestDays("2026-03-09", "2026-03-13", true, true, [])).toBe(4);
  });

  it("single day with half day start", () => {
    expect(calculateRequestDays("2026-03-09", "2026-03-09", true, false, [])).toBe(0.5);
  });

  it("single day with both half days = full day", () => {
    // Users interpret "start half" as morning and "end half" as afternoon
    // Both checked on a single day = full day
    expect(calculateRequestDays("2026-03-09", "2026-03-09", true, true, [])).toBe(1);
  });

  it("multi-day with both half days still subtracts correctly", () => {
    // Mon-Fri, first day half + last day half = 4 days
    expect(calculateRequestDays("2026-03-09", "2026-03-13", true, true, [])).toBe(4);
  });

  it("returns 0 for weekend-only range", () => {
    expect(calculateRequestDays("2026-03-14", "2026-03-15", false, false, [])).toBe(0);
  });
});

describe("calculateRemainingDays", () => {
  it("subtracts approved request days from allowance", () => {
    const approvedRequests = [
      { startDate: "2026-03-09", endDate: "2026-03-13", halfDayStart: false, halfDayEnd: false },
      { startDate: "2026-04-06", endDate: "2026-04-08", halfDayStart: true, halfDayEnd: false },
    ];
    // 5 days + 2.5 days = 7.5 days used
    const remaining = calculateRemainingDays(30, approvedRequests, []);
    expect(remaining).toBe(22.5);
  });

  it("returns full allowance with no requests", () => {
    expect(calculateRemainingDays(30, [], [])).toBe(30);
  });

  it("correctly deducts cross-year request with public holidays from both years", () => {
    // Christmas 2024-2025: Dec 23 (Mon) to Jan 3 (Fri)
    // 10 weekdays - 3 holidays (Dec 25, 26, Jan 1) = 7 business days
    const holidays = ["2024-12-25", "2024-12-26", "2025-01-01"];
    const approved = [
      { startDate: "2024-12-23", endDate: "2025-01-03", halfDayStart: false, halfDayEnd: false },
    ];
    expect(calculateRemainingDays(30, approved, holidays)).toBe(23);
  });

  it("over-counts days when cross-year holidays are missing (demonstrates the bug)", () => {
    // Same request but only 2025 holidays (missing 2024 Christmas holidays)
    const holidays2025Only = ["2025-01-01"];
    const approved = [
      { startDate: "2024-12-23", endDate: "2025-01-03", halfDayStart: false, halfDayEnd: false },
    ];
    // Without Dec 25+26 holidays, it counts 9 instead of 7 days => 21 remaining instead of 23
    expect(calculateRemainingDays(30, approved, holidays2025Only)).toBe(21);
  });
});

describe("calculateCarryoverFromPreviousYear", () => {
  it("calculates unused days from previous year as carryover", () => {
    // User had 28 days allowance, used 21 => 7 days carryover
    const prevApproved = [
      { startDate: "2025-03-10", endDate: "2025-03-14", halfDayStart: false, halfDayEnd: false }, // 5 days
      { startDate: "2025-06-02", endDate: "2025-06-13", halfDayStart: false, halfDayEnd: false }, // 10 days
      { startDate: "2025-09-01", endDate: "2025-09-05", halfDayStart: false, halfDayEnd: false }, // 5 days
      { startDate: "2025-12-22", endDate: "2025-12-22", halfDayStart: true, halfDayEnd: false },  // 0.5 days
    ];
    // 20.5 days used from 28 => 7.5 carryover
    expect(calculateCarryoverFromPreviousYear(28, prevApproved, [])).toBe(7.5);
  });

  it("returns 0 when all days were used", () => {
    const prevApproved = [
      { startDate: "2025-01-06", endDate: "2025-01-31", halfDayStart: false, halfDayEnd: false }, // 20 days
      { startDate: "2025-06-02", endDate: "2025-06-13", halfDayStart: false, halfDayEnd: false }, // 10 days
    ];
    expect(calculateCarryoverFromPreviousYear(30, prevApproved, [])).toBe(0);
  });

  it("falls back to manual carryoverDays when no previous year requests exist", () => {
    // First year of system use — no data from previous year
    expect(calculateCarryoverFromPreviousYear(28, [], [], 7)).toBe(7);
  });

  it("uses auto-calculated value even when manual override exists (if prev year has data)", () => {
    const prevApproved = [
      { startDate: "2025-03-10", endDate: "2025-03-14", halfDayStart: false, halfDayEnd: false }, // 5 days
    ];
    // 28 - 5 = 23, ignores manual value of 7
    expect(calculateCarryoverFromPreviousYear(28, prevApproved, [], 7)).toBe(23);
  });

  it("excludes public holidays from previous year calculation", () => {
    // Request covers a public holiday
    const prevApproved = [
      { startDate: "2025-12-22", endDate: "2025-12-26", halfDayStart: false, halfDayEnd: false }, // 5 weekdays - 2 holidays = 3 days
    ];
    const holidays = ["2025-12-25", "2025-12-26"];
    expect(calculateCarryoverFromPreviousYear(28, prevApproved, holidays)).toBe(25);
  });
});
