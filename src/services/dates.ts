/**
 * Date formatting and parsing.
 *
 * Everything is stored as ISO `YYYY-MM-DD` and formatted only at render time,
 * so nothing here changes what lands in the database. All conversions pin the
 * timezone to UTC: parsing an ISO day as local midnight and formatting it back
 * shifts the date in any zone ahead of UTC (see countBusinessDays).
 */

const LOCALES: Record<string, string> = { de: "de-DE", en: "en-GB" };

const OPTS: Record<string, Intl.DateTimeFormatOptions> = {
  de: { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" },
  en: { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" },
};

/** Today as `YYYY-MM-DD` in UTC. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function toUtcDate(iso: string): Date {
  return new Date(iso + "T00:00:00Z");
}

/** `2026-03-19` → `19.03.2026` (de) / `19 Mar 2026` (en) */
export function formatDate(iso: string, lang: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const locale = LOCALES[lang] ?? LOCALES.en;
  const opts = OPTS[lang] ?? OPTS.en;
  return new Intl.DateTimeFormat(locale, opts).format(toUtcDate(iso));
}

/** A date range, collapsed to a single date when both ends match. */
export function formatRange(startIso: string, endIso: string, lang: string): string {
  const start = formatDate(startIso, lang);
  if (startIso === endIso) return start;
  return `${start} – ${formatDate(endIso, lang)}`;
}

/** Short form for dense lists: `19.03.` (de) / `19 Mar` (en) */
export function formatDayMonth(iso: string, lang: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const locale = LOCALES[lang] ?? LOCALES.en;
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    day: "2-digit",
    ...(lang === "de" ? { month: "2-digit" } : { month: "short" }),
  }).format(toUtcDate(iso));
}

/**
 * Accept the date formats people actually type: ISO or German day-first,
 * separated by "to", "bis", a hyphen or an en/em dash. A bare single date is
 * treated as a one-day range.
 */
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const GERMAN = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
const SEPARATOR = /\s+(?:to|bis|until|-|–|—)\s+|\s*(?:–|—)\s*/i;

export function parseFlexibleDate(input: string): string | null {
  const text = input.trim();

  const iso = text.match(ISO);
  if (iso) return isRealDate(text) ? text : null;

  const de = text.match(GERMAN);
  if (de) {
    const [, d, m, y] = de;
    const candidate = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    return isRealDate(candidate) ? candidate : null;
  }

  return null;
}

/** Rejects 2026-02-30 and friends, which Date would silently roll over. */
function isRealDate(iso: string): boolean {
  const parsed = toUtcDate(iso);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso;
}

export interface ParsedDateRange {
  startDate: string;
  endDate: string;
}

/** Parse one line into a range. Returns null if the line is unusable. */
export function parseDateRangeLine(line: string): ParsedDateRange | null {
  const parts = line.split(SEPARATOR).map((p) => p.trim()).filter(Boolean);

  if (parts.length === 1) {
    const single = parseFlexibleDate(parts[0]);
    return single ? { startDate: single, endDate: single } : null;
  }

  if (parts.length === 2) {
    const startDate = parseFlexibleDate(parts[0]);
    const endDate = parseFlexibleDate(parts[1]);
    if (!startDate || !endDate || endDate < startDate) return null;
    return { startDate, endDate };
  }

  return null;
}
