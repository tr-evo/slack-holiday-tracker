export function countBusinessDays(
  startDate: string,
  endDate: string,
  publicHolidays: string[]
): number {
  const holidaySet = new Set(publicHolidays);
  let count = 0;
  const current = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");

  while (current <= end) {
    const day = current.getDay();
    const dateStr = current.toISOString().slice(0, 10);
    if (day !== 0 && day !== 6 && !holidaySet.has(dateStr)) {
      count++;
    }
    current.setDate(current.getDate() + 1);
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

interface ApprovedRequest {
  startDate: string;
  endDate: string;
  halfDayStart: boolean;
  halfDayEnd: boolean;
}

export function calculateRemainingDays(
  annualAllowance: number,
  approvedRequests: ApprovedRequest[],
  publicHolidays: string[],
  carryoverDays: number = 0
): number {
  let used = 0;
  for (const req of approvedRequests) {
    used += calculateRequestDays(
      req.startDate,
      req.endDate,
      req.halfDayStart,
      req.halfDayEnd,
      publicHolidays
    );
  }
  return annualAllowance + carryoverDays - used;
}

export interface UsageBreakdown {
  usedFromCarryover: number;
  usedFromAllowance: number;
  /** Per-request source: "carryover", "allowance", or "mixed" */
  requestSources: Map<number, "carryover" | "allowance" | "mixed">;
}

/**
 * Calculate how much was used from carryover vs regular allowance.
 * Carryover is consumed first (FIFO).
 */
export function calculateUsageBreakdown(
  carryoverDays: number,
  approvedRequests: (ApprovedRequest & { id: number })[],
  publicHolidays: string[]
): UsageBreakdown {
  let carryoverRemaining = carryoverDays;
  let usedFromCarryover = 0;
  let usedFromAllowance = 0;
  const requestSources = new Map<number, "carryover" | "allowance" | "mixed">();

  // Process requests chronologically (earliest first)
  const sorted = [...approvedRequests].sort((a, b) => a.startDate.localeCompare(b.startDate));

  for (const req of sorted) {
    const days = calculateRequestDays(req.startDate, req.endDate, req.halfDayStart, req.halfDayEnd, publicHolidays);
    if (days === 0) {
      requestSources.set(req.id, "allowance");
      continue;
    }

    const fromCarryover = Math.min(days, carryoverRemaining);
    const fromAllowance = days - fromCarryover;
    carryoverRemaining -= fromCarryover;
    usedFromCarryover += fromCarryover;
    usedFromAllowance += fromAllowance;

    if (fromCarryover > 0 && fromAllowance > 0) {
      requestSources.set(req.id, "mixed");
    } else if (fromCarryover > 0) {
      requestSources.set(req.id, "carryover");
    } else {
      requestSources.set(req.id, "allowance");
    }
  }

  return { usedFromCarryover, usedFromAllowance, requestSources };
}

/**
 * Returns the effective carryover days for a user right now.
 * Returns 0 if carryover is disabled or past the cutoff date.
 */
export function getEffectiveCarryover(
  userCarryoverDays: number,
  carryoverEnabled: boolean,
  carryoverCutoff: string,
  today?: Date
): number {
  if (!carryoverEnabled || userCarryoverDays <= 0) return 0;

  const now = today ?? new Date();
  const [cutoffMonth, cutoffDay] = carryoverCutoff.split("-").map(Number);
  const cutoffDate = new Date(now.getFullYear(), cutoffMonth - 1, cutoffDay);

  // Include the cutoff day itself
  cutoffDate.setDate(cutoffDate.getDate() + 1);

  return now < cutoffDate ? userCarryoverDays : 0;
}
