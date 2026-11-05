import { describe, it, expect, afterEach } from "vitest";
import { countBusinessDays, calculateRequestDays, calculateYearPosition, calculateCarryoverIn, cutoffDate, type CarryoverPolicy } from "../allowance.js";

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

describe("cutoffDate", () => {
  it("builds the ISO date for the year", () => {
    expect(cutoffDate(2026, "03-31")).toBe("2026-03-31");
  });

  it("normalizes 02-29 in a non-leap year", () => {
    expect(cutoffDate(2026, "02-29")).toBe("2026-03-01");
  });
});

describe("calculateYearPosition", () => {
  const policy: CarryoverPolicy = { enabled: true, expires: true, cutoff: "03-31" };
  const req = (id: number, startDate: string, endDate: string, halfDayStart = false, halfDayEnd = false) =>
    ({ id, startDate, endDate, halfDayStart, halfDayEnd });
  const position = (carryoverIn: number, requests: ReturnType<typeof req>[], today: string, p = policy) =>
    calculateYearPosition({ year: 2026, allowance: 28, carryoverIn, requests, publicHolidays: [], policy: p, today });

  it("subtracts approved days from the allowance, half days included", () => {
    const result = position(0, [req(1, "2026-03-09", "2026-03-13"), req(2, "2026-04-06", "2026-04-08", true)], "2026-11-05");
    expect(result.used).toBe(7.5);
    expect(result.remaining).toBe(20.5);
  });

  it("returns the full allowance with no requests", () => {
    expect(position(0, [], "2026-11-05").remaining).toBe(28);
  });

  it("still counts all carryover up to and including the cutoff day", () => {
    const result = position(8, [req(1, "2026-03-09", "2026-03-10")], "2026-03-31");
    expect(result).toMatchObject({ remaining: 34, carryoverUnused: 6, carryoverLapsed: 0, usedFromCarryover: 2 });
  });

  it("lapses only the unspent rest after the cutoff, not what was already taken", () => {
    const result = position(8, [req(1, "2026-03-09", "2026-03-12"), req(2, "2026-05-04", "2026-05-08")], "2026-04-01");
    expect(result).toMatchObject({
      used: 9,
      usedFromCarryover: 4,
      usedFromAllowance: 5,
      carryoverLapsed: 4,
      carryoverUnused: 0,
      remaining: 23,
    });
  });

  it("does not spend carryover on days after the cutoff", () => {
    const result = position(8, [req(1, "2026-05-04", "2026-05-08")], "2026-02-01");
    expect(result.usedFromCarryover).toBe(0);
    expect(result.requestSources.get(1)).toBe("allowance");
  });

  it("splits a request that straddles the cutoff", () => {
    // Mon 30.03 + Tue 31.03 before the cutoff, Wed–Fri after it
    const result = position(8, [req(1, "2026-03-30", "2026-04-03")], "2026-11-05");
    expect(result.usedFromCarryover).toBe(2);
    expect(result.usedFromAllowance).toBe(3);
    expect(result.requestSources.get(1)).toBe("mixed");
  });

  it("keeps a half day at the start of a straddling request", () => {
    const result = position(8, [req(1, "2026-03-31", "2026-04-02", true)], "2026-11-05");
    expect(result.usedFromCarryover).toBe(0.5);
    expect(result.used).toBe(2.5);
  });

  it("never lapses when expiry is off, and spends carryover after the cutoff", () => {
    const result = position(8, [req(1, "2026-05-04", "2026-05-08")], "2026-11-05", { ...policy, expires: false });
    expect(result).toMatchObject({ carryoverLapsed: 0, usedFromCarryover: 5, carryoverUnused: 3, remaining: 31 });
  });
});

describe("calculateCarryoverIn", () => {
  const policy: CarryoverPolicy = { enabled: true, expires: true, cutoff: "03-31" };
  const base = { allowance: 28, publicHolidays: [] as string[], policy };
  const week = (id: number, startDate: string, endDate: string) =>
    ({ id, startDate, endDate, halfDayStart: false, halfDayEnd: false });

  it("is the opening balance in the start year", () => {
    expect(calculateCarryoverIn({ ...base, year: 2024, startYear: 2024, openingCarryover: 4.5, requests: [] })).toBe(4.5);
  });

  it("is 0 before the start year and when carryover is disabled", () => {
    expect(calculateCarryoverIn({ ...base, year: 2023, startYear: 2024, openingCarryover: 4.5, requests: [] })).toBe(0);
    expect(calculateCarryoverIn({
      ...base, policy: { ...policy, enabled: false }, year: 2025, startYear: 2024, openingCarryover: 4.5, requests: [],
    })).toBe(0);
  });

  it("carries the unused allowance forward and lets unspent carryover lapse", () => {
    const requests = [week(1, "2024-06-03", "2024-06-07")];
    // 4.5 opening lapses untouched; 28 - 5 carries
    expect(calculateCarryoverIn({ ...base, year: 2025, startYear: 2024, openingCarryover: 4.5, requests })).toBe(23);
  });

  it("keeps unspent carryover rolling when expiry is off", () => {
    const requests = [week(1, "2024-06-03", "2024-06-07")];
    expect(calculateCarryoverIn({
      ...base, policy: { ...policy, expires: false }, year: 2025, startYear: 2024, openingCarryover: 4.5, requests,
    })).toBe(27.5);
  });

  it("carries 0 out of an overdrawn year rather than a debt", () => {
    const requests = [week(1, "2024-04-01", "2024-06-28")];
    expect(calculateCarryoverIn({ ...base, year: 2025, startYear: 2024, openingCarryover: 0, requests })).toBe(0);
  });
});

describe("countBusinessDays — timezone independence", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  // Regression: dates were parsed as local midnight and formatted back with
  // toISOString(), shifting every public holiday one day in any zone ahead of
  // UTC — so in Europe/Berlin, Neujahr was billed as leave and 2 Jan was free.
  for (const tz of ["Europe/Berlin", "UTC", "America/New_York", "Pacific/Auckland"]) {
    it(`matches public holidays correctly in ${tz}`, () => {
      process.env.TZ = tz;
      const neujahr = ["2026-01-01"]; // a Thursday
      expect(countBusinessDays("2026-01-01", "2026-01-01", neujahr)).toBe(0);
      expect(countBusinessDays("2026-01-02", "2026-01-02", neujahr)).toBe(1);
      // Thu 1 Jan (holiday) → Fri 2 Jan
      expect(countBusinessDays("2026-01-01", "2026-01-02", neujahr)).toBe(1);
    });

    it(`counts weekends correctly in ${tz}`, () => {
      process.env.TZ = tz;
      // Sat 2026-03-14 / Sun 2026-03-15
      expect(countBusinessDays("2026-03-14", "2026-03-15", [])).toBe(0);
      expect(countBusinessDays("2026-03-09", "2026-03-15", [])).toBe(5);
    });
  }
});
