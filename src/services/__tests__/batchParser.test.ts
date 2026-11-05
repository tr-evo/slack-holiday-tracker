import { describe, it, expect } from "vitest";
import { parseDateRanges } from "../batchParser.js";

describe("parseDateRanges", () => {
  it("parses a mixed-format block the way a German user would paste it", () => {
    const { ranges, errors } = parseDateRanges(
      ["15.01.2024 bis 19.01.2024", "2024-03-01 to 2024-03-01", "01.05.2024", ""].join("\n")
    );
    expect(errors).toEqual([]);
    expect(ranges).toEqual([
      { startDate: "2024-01-15", endDate: "2024-01-19" },
      { startDate: "2024-03-01", endDate: "2024-03-01" },
      { startDate: "2024-05-01", endDate: "2024-05-01" },
    ]);
  });

  it("reports the line numbers it could not read, and keeps the rest", () => {
    const { ranges, errors } = parseDateRanges(
      ["15.01.2024 bis 19.01.2024", "irgendwann im Mai", "2024-03-01 to 2024-03-05"].join("\n")
    );
    expect(errors).toEqual(["2"]);
    expect(ranges).toHaveLength(2);
  });

  it("counts blank lines toward the numbering so the error points at the right row", () => {
    const { errors } = parseDateRanges(["", "", "nonsense"].join("\n"));
    expect(errors).toEqual(["3"]);
  });

  it("reads half days on a single day", () => {
    const { ranges, errors } = parseDateRanges(
      ["04.09.2024 vormittags", "04.09.2024 nur nachmittags", "2024-09-04 half", "04.09.2024 halb", "04.09.2024 Halber Tag", "2024-09-04 afternoon", "04.09.2024 ab mittags", "04.09.2024 bis mittags", "04.09.2024 bis 04.09.2024 nachmittags"].join("\n")
    );
    expect(errors).toEqual([]);
    const day = { startDate: "2024-09-04", endDate: "2024-09-04" };
    const morning = { ...day, halfDayStart: true };
    const afternoon = { ...day, halfDayEnd: true };
    expect(ranges).toEqual([morning, afternoon, morning, morning, morning, afternoon, afternoon, morning, afternoon]);
  });

  it("reads half ends on a range, even though bis mittags contains the separator", () => {
    const range = { startDate: "2024-01-15", endDate: "2024-01-19" };
    const { ranges, errors } = parseDateRanges(
      ["15.01.2024 bis 19.01.2024 ab mittags", "15.01.2024 bis 19.01.2024 bis mittags", "15.01.2024 bis 19.01.2024 ab mittags bis mittags", "2024-01-15 to 2024-01-19 from midday, until midday"].join("\n")
    );
    expect(errors).toEqual([]);
    expect(ranges).toEqual([
      { ...range, halfDayStart: true },
      { ...range, halfDayEnd: true },
      { ...range, halfDayStart: true, halfDayEnd: true },
      { ...range, halfDayStart: true, halfDayEnd: true },
    ]);
  });

  it("omits the half-day flags from a whole-day entry", () => {
    expect(Object.keys(parseDateRanges("04.09.2024").ranges[0])).toEqual(["startDate", "endDate"]);
  });

  it("rejects half-day words it cannot place", () => {
    const { errors } = parseDateRanges(
      ["15.01.2024 bis 19.01.2024 halb", "15.01.2024 bis 19.01.2024 vormittags", "04.09.2024 vormittags nachmittags", "15.01.2024 bis 19.01.2024 bis mittags bis mittags", "vormittags"].join("\n")
    );
    expect(errors).toEqual(["1", "2", "3", "4", "5"]);
  });
});
