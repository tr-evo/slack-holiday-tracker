import type Database from "better-sqlite3";
import type { User } from "../db/repositories/userRepo.js";
import { createSettingsRepo } from "../db/repositories/settingsRepo.js";
import { calculateRequestDays, calculateYearPosition } from "./allowance.js";
import { getBalanceSnapshot, yearsSpannedBy } from "./balance.js";
import { getHolidayDatesForYears, getHolidaysInRange } from "./publicHolidays.js";

export interface PreviewResult {
  days: number;
  holidayNames: string[];
  remaining: number;
  remainingAfter: number;
  problem?: "order" | "zero" | "insufficient";
}

export interface PreviewInput {
  startDate?: string;
  endDate?: string;
  halfDayStart: boolean;
  halfDayEnd: boolean;
}

/**
 * What a draft request would cost. Drives both the live preview in the modal
 * and the validation on submit, so the number shown is the number enforced.
 */
export async function previewRequest(
  db: Database.Database,
  user: User,
  draft: PreviewInput,
  lang: string
): Promise<PreviewResult | undefined> {
  if (!draft.startDate || !draft.endDate) return undefined;

  const snapshot = await getBalanceSnapshot(db, user, Number(draft.startDate.slice(0, 4)));
  const base = { days: 0, holidayNames: [], remaining: snapshot.remaining, remainingAfter: snapshot.remaining };

  if (draft.endDate < draft.startDate) return { ...base, problem: "order" };

  const bundesland = createSettingsRepo(db).getBundesland();
  const publicHolidays = bundesland
    ? await getHolidayDatesForYears(
        yearsSpannedBy([{ startDate: draft.startDate, endDate: draft.endDate }], snapshot.year),
        bundesland
      )
    : [];

  const days = calculateRequestDays(
    draft.startDate,
    draft.endDate,
    draft.halfDayStart,
    draft.halfDayEnd,
    publicHolidays
  );

  const holidayNames = await getHolidaysInRange(draft.startDate, draft.endDate, bundesland, lang);
  const remainingAfter = snapshot.remaining - days;

  // Carryover can only pay for days up to the cutoff, so look at where the year
  // ends up with this request in it, not just at today's remaining days.
  const closed = calculateYearPosition({
    year: snapshot.year,
    allowance: snapshot.allowance,
    carryoverIn: snapshot.grantedCarryover,
    requests: [
      ...snapshot.approved,
      { id: -1, startDate: draft.startDate, endDate: draft.endDate, halfDayStart: draft.halfDayStart, halfDayEnd: draft.halfDayEnd },
    ],
    publicHolidays: [...snapshot.publicHolidays, ...publicHolidays],
    policy: { enabled: snapshot.carryoverEnabled, expires: snapshot.carryoverExpires, cutoff: snapshot.carryoverCutoff },
    today: `${snapshot.year + 1}-12-31`,
  });

  return {
    days,
    holidayNames,
    remaining: snapshot.remaining,
    remainingAfter,
    problem: days === 0 ? "zero" : closed.remaining < 0 ? "insufficient" : undefined,
  };
}
