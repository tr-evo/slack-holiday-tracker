import type { App } from "@slack/bolt";
import { getDb } from "../db/connection.js";
import { createUserRepo, type User } from "../db/repositories/userRepo.js";
import { createRequestRepo } from "../db/repositories/requestRepo.js";
import { createSettingsRepo } from "../db/repositories/settingsRepo.js";
import { getBalanceSnapshot, yearsSpannedBy } from "../services/balance.js";
import { getHolidayDatesForYears } from "../services/publicHolidays.js";
import { calculateRequestDays } from "../services/allowance.js";
import { todayIso } from "../services/dates.js";
import { buildHomeTab, type HomeRequestEntry, type TeamAbsence } from "../modals/homeTab.js";
import { buildMyHolidaysModal, type MyHolidayEntry } from "../modals/myHolidaysModal.js";

/**
 * Open or push, depending on where the click came from.
 *
 * A button on the App Home tab has no modal stack to push onto, so the same
 * handler has to open a root view there and push when it is already inside one.
 */
export async function openOrPush(client: any, body: any, view: any): Promise<void> {
  const insideModal = body?.view?.type === "modal";
  const args = { trigger_id: body.trigger_id, view };
  if (insideModal) {
    await client.views.push(args);
  } else {
    await client.views.open(args);
  }
}

/** True when the interaction happened on the Home tab rather than in a modal. */
export function isHomeSurface(body: any): boolean {
  return body?.view?.type === "home" || !body?.view;
}

const THREE_MONTHS_MS = 1000 * 60 * 60 * 24 * 92;

export async function publishHomeTab(client: any, user: User): Promise<void> {
  const db = getDb();
  const requestRepo = createRequestRepo(db);
  const settingsRepo = createSettingsRepo(db);
  const bundesland = settingsRepo.getBundesland();
  const today = todayIso();

  const snapshot = await getBalanceSnapshot(db, user);
  const own = requestRepo.listByUser(user.slackId);

  const holidayYears = yearsSpannedBy(own, snapshot.year);
  const publicHolidays = bundesland ? await getHolidayDatesForYears(holidayYears, bundesland) : [];

  const requests: HomeRequestEntry[] = own.map((r) => ({
    request: r,
    days: calculateRequestDays(r.startDate, r.endDate, r.halfDayStart, r.halfDayEnd, publicHolidays),
  }));

  const horizon = new Date(Date.parse(today + "T00:00:00Z") + THREE_MONTHS_MS).toISOString().slice(0, 10);
  const team: TeamAbsence[] = requestRepo
    .getUpcomingApproved(today)
    .filter((r) => r.userId !== user.slackId && r.startDate <= horizon)
    .map((r) => ({ userId: r.userId, startDate: r.startDate, endDate: r.endDate }));

  await client.views.publish({
    user_id: user.slackId,
    view: buildHomeTab(user.language, {
      snapshot,
      requests,
      team,
      isAdmin: user.isAdmin,
      pendingCount: requestRepo.getPending().length,
      today,
    }),
  });
}

/** Best-effort home refresh: never let a stale tab break the action that ran. */
export async function refreshHome(client: any, user: User): Promise<void> {
  try {
    await publishHomeTab(client, user);
  } catch (err) {
    console.error("[home] refresh failed:", err);
  }
}

/** The employee's own request list, shared by the menu, Home and cancellation. */
export async function buildMyHolidaysView(user: User, offset = 0) {
  const db = getDb();
  const requestRepo = createRequestRepo(db);
  const settingsRepo = createSettingsRepo(db);
  const bundesland = settingsRepo.getBundesland();

  const requests = requestRepo.listByUser(user.slackId);
  const snapshot = await getBalanceSnapshot(db, user);
  const publicHolidays = bundesland
    ? await getHolidayDatesForYears(yearsSpannedBy(requests, snapshot.year), bundesland)
    : [];

  const entries: MyHolidayEntry[] = requests.map((r) => ({
    request: r,
    days: calculateRequestDays(r.startDate, r.endDate, r.halfDayStart, r.halfDayEnd, publicHolidays),
    source: r.status === "approved" && snapshot.carryover > 0 ? snapshot.requestSources.get(r.id) : undefined,
  }));

  return buildMyHolidaysModal(user.language, entries, todayIso(), offset);
}

export function registerHomeHandlers(app: App) {
  app.event("app_home_opened", async ({ event, client }) => {
    if ((event as any).tab !== "home") return;

    const db = getDb();
    const userRepo = createUserRepo(db);
    const user = userRepo.findById(event.user);
    if (!user) return; // they have not used the app yet; nothing to show

    await refreshHome(client, user);
  });
}
