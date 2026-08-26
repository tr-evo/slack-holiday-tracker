import type Database from "better-sqlite3";
import { createRequestRepo, type HolidayRequest } from "../db/repositories/requestRepo.js";
import { createSettingsRepo } from "../db/repositories/settingsRepo.js";
import type { User } from "../db/repositories/userRepo.js";
import { getHolidayDatesForYears } from "./publicHolidays.js";
import {
  calculateRemainingDays,
  calculateRequestDays,
  calculateUsageBreakdown,
  getEffectiveCarryover,
} from "./allowance.js";

/**
 * One user's holiday position for a year.
 *
 * This was assembled by hand in five places — the slash command, the balance
 * modal, the request list, the team overview and submit validation — each
 * repeating the cross-year holiday lookup and each free to drift from the
 * others. Compute it once here.
 */
export interface BalanceSnapshot {
  year: number;
  allowance: number;
  /** Carryover that still counts today; 0 once past the cutoff */
  carryover: number;
  /** What the user was granted, regardless of the cutoff */
  grantedCarryover: number;
  carryoverEnabled: boolean;
  carryoverCutoff: string;
  budget: number;
  used: number;
  remaining: number;
  usedFromCarryover: number;
  usedFromAllowance: number;
  carryoverUnused: number;
  approved: HolidayRequest[];
  publicHolidays: string[];
  requestSources: Map<number, "carryover" | "allowance" | "mixed">;
}

/** Every year touched by these requests, plus the reference year. */
export function yearsSpannedBy(requests: { startDate: string; endDate: string }[], year: number): number[] {
  const years = [...new Set(requests.flatMap((r) => [
    Number(r.startDate.slice(0, 4)),
    Number(r.endDate.slice(0, 4)),
  ]))];
  if (!years.includes(year)) years.push(year);
  return years;
}

export async function getBalanceSnapshot(
  db: Database.Database,
  user: User,
  year = new Date().getUTCFullYear()
): Promise<BalanceSnapshot> {
  const requestRepo = createRequestRepo(db);
  const settingsRepo = createSettingsRepo(db);
  const bundesland = settingsRepo.getBundesland();

  const approved = requestRepo.getApprovedForUserInYear(user.slackId, year);
  const publicHolidays = bundesland
    ? await getHolidayDatesForYears(yearsSpannedBy(approved, year), bundesland)
    : [];

  const carryoverEnabled = settingsRepo.isCarryoverEnabled();
  const carryoverCutoff = settingsRepo.getCarryoverCutoff();
  const carryover = getEffectiveCarryover(user.carryoverDays, carryoverEnabled, carryoverCutoff);

  const remaining = calculateRemainingDays(user.annualAllowance, approved, publicHolidays, carryover);
  const budget = user.annualAllowance + carryover;
  const breakdown = calculateUsageBreakdown(carryover, approved, publicHolidays);

  return {
    year,
    allowance: user.annualAllowance,
    carryover,
    grantedCarryover: user.carryoverDays,
    carryoverEnabled,
    carryoverCutoff,
    budget,
    used: budget - remaining,
    remaining,
    usedFromCarryover: breakdown.usedFromCarryover,
    usedFromAllowance: breakdown.usedFromAllowance,
    carryoverUnused: carryover - breakdown.usedFromCarryover,
    approved,
    publicHolidays,
    requestSources: breakdown.requestSources,
  };
}

/** `31.03.2026` — the day this year's carryover stops counting. */
export function carryoverCutoffDisplay(cutoff: string, year: number): string {
  const [month, day] = cutoff.split("-");
  return `${day}.${month}.${year}`;
}

export interface OverlappingHoliday {
  userId: string;
  startDate: string;
  endDate: string;
}

/**
 * What an approver needs but currently has to go and look up: what the request
 * costs, what it leaves the requester with, and who else is already away then.
 */
export interface RequestContext {
  days: number;
  remainingBefore: number;
  remainingAfter: number;
  overlaps: OverlappingHoliday[];
}

export async function getRequestContext(
  db: Database.Database,
  user: User,
  request: HolidayRequest
): Promise<RequestContext> {
  const snapshot = await getBalanceSnapshot(db, user);
  const requestRepo = createRequestRepo(db);
  const settingsRepo = createSettingsRepo(db);
  const bundesland = settingsRepo.getBundesland();

  const publicHolidays = bundesland
    ? await getHolidayDatesForYears(yearsSpannedBy([request], snapshot.year), bundesland)
    : [];

  const days = calculateRequestDays(
    request.startDate,
    request.endDate,
    request.halfDayStart,
    request.halfDayEnd,
    publicHolidays
  );

  const overlaps = requestRepo
    .getApprovedOverlapping(request.startDate, request.endDate, request.userId)
    .map((r) => ({ userId: r.userId, startDate: r.startDate, endDate: r.endDate }));

  return {
    days,
    remainingBefore: snapshot.remaining,
    remainingAfter: snapshot.remaining - days,
    overlaps,
  };
}
