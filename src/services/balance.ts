import type Database from "better-sqlite3";
import { createRequestRepo, type HolidayRequest } from "../db/repositories/requestRepo.js";
import { createSettingsRepo } from "../db/repositories/settingsRepo.js";
import type { User } from "../db/repositories/userRepo.js";
import { getHolidayDatesForYears } from "./publicHolidays.js";
import { todayIso } from "./dates.js";
import {
  calculateCarryoverIn,
  calculateRequestDays,
  calculateYearPosition,
  type CarryoverPolicy,
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
  /** Carryover that counts toward this year's budget: carried in, minus what lapsed */
  carryover: number;
  /** Carried in from the previous year, before anything lapsed */
  grantedCarryover: number;
  /** Lapsed at the cutoff; 0 until it has passed */
  carryoverLapsed: number;
  carryoverEnabled: boolean;
  carryoverExpires: boolean;
  carryoverCutoff: string;
  budget: number;
  used: number;
  remaining: number;
  usedFromCarryover: number;
  usedFromAllowance: number;
  /** Not spent yet and still spendable today */
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
  year = new Date().getUTCFullYear(),
  today = todayIso()
): Promise<BalanceSnapshot> {
  const requestRepo = createRequestRepo(db);
  const settingsRepo = createSettingsRepo(db);
  const bundesland = settingsRepo.getBundesland();

  const allApproved = requestRepo.getApprovedForUser(user.slackId);
  const approved = requestRepo.getApprovedForUserInYear(user.slackId, year);
  const publicHolidays = bundesland
    ? await getHolidayDatesForYears(yearsSpannedBy(allApproved, year), bundesland)
    : [];

  const policy: CarryoverPolicy = {
    enabled: settingsRepo.isCarryoverEnabled(),
    expires: settingsRepo.isCarryoverExpiring(),
    cutoff: settingsRepo.getCarryoverCutoff(),
  };

  // Without an explicit start, the ledger begins with the earliest recorded holiday.
  const startYear = user.carryoverStartYear
    ?? Math.min(year, ...allApproved.map((r) => Number(r.startDate.slice(0, 4))));

  const carryoverIn = calculateCarryoverIn({
    year,
    startYear,
    openingCarryover: user.carryoverDays,
    allowance: user.annualAllowance,
    requests: allApproved,
    publicHolidays,
    policy,
  });

  const position = calculateYearPosition({
    year,
    allowance: user.annualAllowance,
    carryoverIn,
    requests: approved,
    publicHolidays,
    policy,
    today,
  });

  const carryover = carryoverIn - position.carryoverLapsed;

  return {
    year,
    allowance: user.annualAllowance,
    carryover,
    grantedCarryover: carryoverIn,
    carryoverLapsed: position.carryoverLapsed,
    carryoverEnabled: policy.enabled,
    carryoverExpires: policy.expires,
    carryoverCutoff: policy.cutoff,
    budget: user.annualAllowance + carryover,
    used: position.used,
    remaining: position.remaining,
    usedFromCarryover: position.usedFromCarryover,
    usedFromAllowance: position.usedFromAllowance,
    carryoverUnused: position.carryoverUnused,
    approved,
    publicHolidays,
    requestSources: position.requestSources,
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
