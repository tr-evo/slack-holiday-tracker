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
});
