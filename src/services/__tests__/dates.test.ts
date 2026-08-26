import { describe, it, expect, afterEach } from "vitest";
import { formatDate, formatRange, parseFlexibleDate, parseDateRangeLine } from "../dates.js";

describe("formatDate", () => {
  it("writes German dates day-first", () => {
    expect(formatDate("2026-03-19", "de")).toBe("19.03.2026");
  });

  it("writes English dates unambiguously", () => {
    expect(formatDate("2026-03-19", "en")).toBe("19 Mar 2026");
  });

  it("leaves anything that is not an ISO date alone", () => {
    expect(formatDate("tomorrow", "de")).toBe("tomorrow");
  });

  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  // Same trap as countBusinessDays: a local-midnight Date formats to the day
  // before in any zone ahead of UTC.
  for (const tz of ["Europe/Berlin", "UTC", "Pacific/Auckland", "America/New_York"]) {
    it(`does not shift the date in ${tz}`, () => {
      process.env.TZ = tz;
      expect(formatDate("2026-01-01", "de")).toBe("01.01.2026");
    });
  }
});

describe("formatRange", () => {
  it("collapses a single day", () => {
    expect(formatRange("2026-03-19", "2026-03-19", "de")).toBe("19.03.2026");
  });

  it("joins two dates", () => {
    expect(formatRange("2026-03-19", "2026-03-22", "de")).toBe("19.03.2026 – 22.03.2026");
  });
});

describe("parseFlexibleDate", () => {
  it("accepts ISO", () => {
    expect(parseFlexibleDate("2026-01-15")).toBe("2026-01-15");
  });

  it("accepts German day-first, padded or not", () => {
    expect(parseFlexibleDate("15.01.2026")).toBe("2026-01-15");
    expect(parseFlexibleDate("5.1.2026")).toBe("2026-01-05");
  });

  it("rejects dates that do not exist", () => {
    expect(parseFlexibleDate("2026-02-30")).toBeNull();
    expect(parseFlexibleDate("30.02.2026")).toBeNull();
  });

  it("rejects anything else", () => {
    expect(parseFlexibleDate("next monday")).toBeNull();
  });
});

describe("parseDateRangeLine", () => {
  it("accepts every separator people actually type", () => {
    const expected = { startDate: "2026-01-15", endDate: "2026-01-19" };
    expect(parseDateRangeLine("2026-01-15 to 2026-01-19")).toEqual(expected);
    expect(parseDateRangeLine("15.01.2026 bis 19.01.2026")).toEqual(expected);
    expect(parseDateRangeLine("15.01.2026 - 19.01.2026")).toEqual(expected);
    expect(parseDateRangeLine("15.01.2026 – 19.01.2026")).toEqual(expected);
    expect(parseDateRangeLine("15.01.2026 until 19.01.2026")).toEqual(expected);
  });

  it("mixes formats across one range", () => {
    expect(parseDateRangeLine("15.01.2026 bis 2026-01-19")).toEqual({
      startDate: "2026-01-15",
      endDate: "2026-01-19",
    });
  });

  it("treats a bare date as a single day", () => {
    expect(parseDateRangeLine("15.01.2026")).toEqual({ startDate: "2026-01-15", endDate: "2026-01-15" });
  });

  it("rejects a backwards range", () => {
    expect(parseDateRangeLine("19.01.2026 bis 15.01.2026")).toBeNull();
  });

  it("rejects junk", () => {
    expect(parseDateRangeLine("sometime in May")).toBeNull();
  });
});
