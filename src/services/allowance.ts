export function countBusinessDays(
  startDate: string,
  endDate: string,
  publicHolidays: string[]
): number {
  const holidaySet = new Set(publicHolidays);
  let count = 0;
  // Iterate in UTC. Parsing "YYYY-MM-DD" as local midnight and then formatting
  // with toISOString() shifts the date back a day in any timezone ahead of UTC
  // (Europe/Berlin included), which silently mismatched every public holiday.
  const current = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");

  while (current <= end) {
    const day = current.getUTCDay();
    const dateStr = current.toISOString().slice(0, 10);
    if (day !== 0 && day !== 6 && !holidaySet.has(dateStr)) {
      count++;
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return count;
}

export function calculateRequestDays(
  startDate: string,
  endDate: string,
  halfDayStart: boolean,
  halfDayEnd: boolean,
  publicHolidays: string[]
): number {
  let days = countBusinessDays(startDate, endDate, publicHolidays);
  // Both halves on a single day = full day (users think "morning" + "afternoon")
  const bothOnSameDay = startDate === endDate && halfDayStart && halfDayEnd;
  if (!bothOnSameDay) {
    if (halfDayStart && days > 0) days -= 0.5;
    if (halfDayEnd && days > 0) days -= 0.5;
  }
  return Math.max(0, days);
}

export interface ApprovedRequest {
  id: number;
  startDate: string;
  endDate: string;
  halfDayStart: boolean;
  halfDayEnd: boolean;
}

export interface CarryoverPolicy {
  enabled: boolean;
  /** When false, unused carryover never lapses and rolls on indefinitely */
  expires: boolean;
  /** First year expiry applies to, so turning it on is not retroactive. Unset: every year */
  expiresFromYear?: number;
  /** MM-DD, inclusive: the last day carryover can be spent */
  cutoff: string;
}

/** ISO date of the cutoff in a year. Date.UTC normalizes 02-29 in a non-leap year. */
export function cutoffDate(year: number, cutoff: string): string {
  const [month, day] = cutoff.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

/** The part of a request that falls on or before the cutoff, in days. */
function daysUpToCutoff(req: ApprovedRequest, cutoffIso: string, publicHolidays: string[]): number {
  if (req.startDate > cutoffIso) return 0;
  if (req.endDate <= cutoffIso) {
    return calculateRequestDays(req.startDate, req.endDate, req.halfDayStart, req.halfDayEnd, publicHolidays);
  }
  return calculateRequestDays(req.startDate, cutoffIso, req.halfDayStart, false, publicHolidays);
}

export interface YearPosition {
  /** Whether expiry applies to this year at all */
  expiring: boolean;
  /** Carried in from the previous year, before anything lapsed */
  carryoverIn: number;
  /** Lapsed at the cutoff; 0 until the cutoff has passed */
  carryoverLapsed: number;
  /** Not spent yet and still spendable today */
  carryoverUnused: number;
  used: number;
  usedFromCarryover: number;
  usedFromAllowance: number;
  remaining: number;
  /** Per-request source: "carryover", "allowance", or "mixed" */
  requestSources: Map<number, "carryover" | "allowance" | "mixed">;
}

/**
 * One year's position. Requests count in the year they start, and carryover is
 * consumed first, FIFO by start date, but only by days on or before the cutoff.
 * Carryover already spent stays spent when the cutoff passes: only the unspent
 * rest lapses.
 */
export function calculateYearPosition(input: {
  year: number;
  allowance: number;
  carryoverIn: number;
  requests: ApprovedRequest[];
  publicHolidays: string[];
  policy: CarryoverPolicy;
  today: string;
}): YearPosition {
  const { year, allowance, carryoverIn, requests, publicHolidays, policy, today } = input;
  const cutoffIso = cutoffDate(year, policy.cutoff);
  const expiring = policy.expires && year >= (policy.expiresFromYear ?? 0);

  let carryoverLeft = carryoverIn;
  let used = 0;
  let usedFromCarryover = 0;
  const requestSources = new Map<number, "carryover" | "allowance" | "mixed">();

  const sorted = [...requests].sort((a, b) => a.startDate.localeCompare(b.startDate));
  for (const req of sorted) {
    const days = calculateRequestDays(req.startDate, req.endDate, req.halfDayStart, req.halfDayEnd, publicHolidays);
    const eligible = expiring ? daysUpToCutoff(req, cutoffIso, publicHolidays) : days;
    const fromCarryover = Math.min(eligible, carryoverLeft);

    carryoverLeft -= fromCarryover;
    used += days;
    usedFromCarryover += fromCarryover;

    if (fromCarryover === 0) requestSources.set(req.id, "allowance");
    else requestSources.set(req.id, fromCarryover < days ? "mixed" : "carryover");
  }

  const lapsed = expiring && today > cutoffIso;
  const carryoverLapsed = lapsed ? carryoverLeft : 0;

  return {
    expiring,
    carryoverIn,
    carryoverLapsed,
    carryoverUnused: lapsed ? 0 : carryoverLeft,
    used,
    usedFromCarryover,
    usedFromAllowance: used - usedFromCarryover,
    remaining: allowance + carryoverIn - carryoverLapsed - used,
    requestSources,
  };
}

/**
 * What carries into a year, derived by walking forward from the opening balance.
 * An overdrawn year carries 0 rather than a debt.
 */
export function calculateCarryoverIn(input: {
  year: number;
  startYear: number;
  openingCarryover: number;
  allowance: number;
  requests: ApprovedRequest[];
  publicHolidays: string[];
  policy: CarryoverPolicy;
}): number {
  const { year, startYear, openingCarryover, allowance, requests, publicHolidays, policy } = input;
  if (!policy.enabled || year < startYear) return 0;

  let carryover = openingCarryover;
  for (let y = startYear; y < year; y++) {
    const position = calculateYearPosition({
      year: y,
      allowance,
      carryoverIn: carryover,
      requests: requests.filter((r) => Number(r.startDate.slice(0, 4)) === y),
      publicHolidays,
      policy,
      today: `${y + 1}-12-31`, // a closed year: its cutoff has always passed
    });
    carryover = Math.max(0, position.remaining);
  }
  return carryover;
}
