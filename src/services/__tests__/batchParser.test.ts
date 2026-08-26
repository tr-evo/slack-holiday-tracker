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
});
