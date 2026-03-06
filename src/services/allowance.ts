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
  if (halfDayStart && days > 0) days -= 0.5;
  if (halfDayEnd && days > 0) days -= 0.5;
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
  publicHolidays: string[]
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
  return annualAllowance - used;
}
