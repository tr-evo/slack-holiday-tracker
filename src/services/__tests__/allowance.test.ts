import { describe, it, expect } from "vitest";
import { countBusinessDays, calculateRequestDays, calculateRemainingDays } from "../allowance.js";

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
