import type Database from "better-sqlite3";
import { createNoticeRepo } from "../db/repositories/noticeRepo.js";
import { createSettingsRepo } from "../db/repositories/settingsRepo.js";
import { createUserRepo, type User } from "../db/repositories/userRepo.js";
import { t } from "../i18n/t.js";
import { formatDays } from "../modals/shared.js";
import { cutoffDate } from "./allowance.js";
import { carryoverCutoffDisplay, getBalanceSnapshot, type BalanceSnapshot } from "./balance.js";
import { todayIso } from "./dates.js";
import { sendDM } from "./slack.js";

export type ReminderKind = "year_start" | "end_jan" | "end_feb" | "mid_mar" | "lapsed";

/** How long a missed reminder is still sent late, say after the bot was down. */
const GRACE_DAYS = 7;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** UTC. Morning in Germany, so nobody gets a holiday DM at midnight. */
const EARLIEST_HOUR = 8;

const toIso = (date: Date) => date.toISOString().slice(0, 10);
const isWeekend = (date: Date) => date.getUTCDay() === 0 || date.getUTCDay() === 6;

function lastWeekdayOfMonth(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month, 0));
  while (isWeekend(date)) date.setUTCDate(date.getUTCDate() - 1);
  return toIso(date);
}

function weekdayOnOrBefore(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  while (isWeekend(date)) date.setUTCDate(date.getUTCDate() - 1);
  return toIso(date);
}

function firstWeekdayAfter(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  do date.setUTCDate(date.getUTCDate() + 1);
  while (isWeekend(date));
  return toIso(date);
}

/** Reminders that would fall after the cutoff are dropped: they could no longer help. */
export function reminderSchedule(year: number, cutoff: string): { kind: ReminderKind; date: string }[] {
  const cutoffIso = cutoffDate(year, cutoff);
  const before: { kind: ReminderKind; date: string }[] = [
    { kind: "year_start", date: firstWeekdayAfter(`${year}-01-01`) },
    { kind: "end_jan", date: lastWeekdayOfMonth(year, 1) },
    { kind: "end_feb", date: lastWeekdayOfMonth(year, 2) },
    // Mid-March rather than month end: on the cutoff day itself it is too late to act.
    { kind: "mid_mar", date: weekdayOnOrBefore(`${year}-03-15`) },
  ];
  return [
    ...before.filter((r) => r.date <= cutoffIso),
    { kind: "lapsed", date: firstWeekdayAfter(cutoffIso) },
  ];
}

/** The latest reminder that has come due, if it is recent enough to still send. */
export function dueReminder(today: string, cutoff: string): ReminderKind | null {
  const year = Number(today.slice(0, 4));
  const due = reminderSchedule(year, cutoff).filter((r) => r.date <= today).pop();
  if (!due) return null;
  const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due.date}T00:00:00Z`)) / 86_400_000;
  return age <= GRACE_DAYS ? due.kind : null;
}

/**
 * The year before expiry starts nothing can lapse yet, so everyone gets an advance
 * notice instead: what is not taken by the first cutoff lapses then.
 */
function announcementFor(kind: ReminderKind, snapshot: BalanceSnapshot, expiresFrom: number, lang: string): { text: string; days: number } | null {
  if (kind === "lapsed") return null;
  if (kind !== "year_start" && snapshot.carryoverUnused <= 0) return null;
  return {
    text: t("reminder.announcement", lang, {
      from: String(expiresFrom),
      last_year: String(expiresFrom - 1),
      date: carryoverCutoffDisplay(snapshot.carryoverCutoff, expiresFrom),
      remaining: formatDays(snapshot.remaining, lang),
    }),
    days: snapshot.remaining,
  };
}

/** The message and the days it is about, or null if this person needs none. */
function reminderFor(kind: ReminderKind, snapshot: BalanceSnapshot, lang: string): { text: string; days: number } | null {
  const { year, carryoverCutoff: cutoff } = snapshot;
  const date = carryoverCutoffDisplay(cutoff, year);

  if (kind === "year_start") {
    const annual = t("reminder.year_start", lang, {
      year: String(year),
      allowance: String(snapshot.allowance),
      next_cutoff: carryoverCutoffDisplay(cutoff, year + 1),
    });
    if (snapshot.carryoverUnused <= 0) return { text: annual, days: 0 };
    const carried = t("reminder.year_start_carryover", lang, { days: formatDays(snapshot.carryoverUnused, lang), date });
    return { text: `${annual}\n\n${carried}`, days: snapshot.carryoverUnused };
  }

  if (kind === "lapsed") {
    if (snapshot.carryoverLapsed <= 0) return null;
    return {
      text: t("reminder.lapsed", lang, {
        days: formatDays(snapshot.carryoverLapsed, lang),
        date,
        remaining: formatDays(snapshot.remaining, lang),
        year: String(year),
      }),
      days: snapshot.carryoverLapsed,
    };
  }

  if (snapshot.carryoverUnused <= 0) return null;
  return {
    text: t("reminder.pending", lang, { days: formatDays(snapshot.carryoverUnused, lang), date }),
    days: snapshot.carryoverUnused,
  };
}

/** Send what is due today. Safe to call repeatedly: each notice goes out once. */
export async function runCarryoverReminders(db: Database.Database, client: any, today = todayIso()): Promise<void> {
  const settings = createSettingsRepo(db);
  const year = Number(today.slice(0, 4));
  if (!settings.isCarryoverEnabled() || !settings.isCarryoverExpiring()) return;
  const expiresFrom = settings.getCarryoverExpiresFrom() ?? 0;
  if (year < expiresFrom - 1) return;
  const announcing = year < expiresFrom;

  const kind = dueReminder(today, settings.getCarryoverCutoff());
  if (!kind) return;

  const notices = createNoticeRepo(db);
  const users: User[] = createUserRepo(db).getAll();

  for (const user of users) {
    if (notices.wasSent(user.slackId, year, kind)) continue;
    const snapshot = await getBalanceSnapshot(db, user, year, today);
    const reminder = announcing
      ? announcementFor(kind, snapshot, expiresFrom, user.language)
      : reminderFor(kind, snapshot, user.language);
    if (!reminder) continue;

    try {
      await sendDM(client, user.slackId, reminder.text);
      notices.record(user.slackId, year, kind, reminder.days);
    } catch (err) {
      // Not recorded, so the next hourly check tries this person again.
      console.error(`[reminders] ${kind} to ${user.slackId} failed:`, err);
    }
  }
}

export function startCarryoverReminders(client: any, db: Database.Database): void {
  const check = () => {
    if (new Date().getUTCHours() < EARLIEST_HOUR) return;
    runCarryoverReminders(db, client).catch((err) => console.error("[reminders] check failed:", err));
  };
  check();
  setInterval(check, CHECK_INTERVAL_MS);
}
