import { parseDateRangeLine, type ParsedDateRange } from "./dates.js";

export type { ParsedDateRange };

/**
 * Parse pasted holiday history into date ranges.
 *
 * The old parser accepted exactly `YYYY-MM-DD to YYYY-MM-DD`, so German users
 * had to type the English word "to" and ISO dates by hand. Now any of these
 * work, mixed freely:
 *
 *   2024-01-15 to 2024-01-19
 *   15.01.2024 bis 19.01.2024
 *   15.01.2024 - 19.01.2024
 *   15.01.2024 – 19.01.2024
 *   15.01.2024                 (a single day)
 *
 * Returns the line numbers it could not read, so the form can point at them.
 */
export function parseDateRanges(text: string): { ranges: ParsedDateRange[]; errors: string[] } {
  const ranges: ParsedDateRange[] = [];
  const errors: string[] = [];

  const lines = text.split("\n").map((l) => l.trim());

  lines.forEach((line, index) => {
    if (!line) return;
    const parsed = parseDateRangeLine(line);
    if (parsed) {
      ranges.push(parsed);
    } else {
      errors.push(String(index + 1));
    }
  });

  return { ranges, errors };
}
