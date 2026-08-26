import type { App } from "@slack/bolt";
import { getDb } from "../db/connection.js";
import { createUserRepo, type User } from "../db/repositories/userRepo.js";
import { createRequestRepo } from "../db/repositories/requestRepo.js";
import { createSettingsRepo } from "../db/repositories/settingsRepo.js";
import { calculateRequestDays } from "../services/allowance.js";
import { getBalanceSnapshot, getRequestContext, yearsSpannedBy } from "../services/balance.js";
import { previewRequest } from "../services/requestPreview.js";
import { getHolidayDatesForYears, getPublicHolidaysForYear } from "../services/publicHolidays.js";
import { canUserCancel } from "../services/cancellation.js";
import { formatDate, formatRange, todayIso } from "../services/dates.js";
import { sendDM, sendDMs } from "../services/slack.js";
import { buildMainMenuModal } from "../modals/mainMenu.js";
import { buildRequestModal, EMPTY_DRAFT, readDraft } from "../modals/requestModal.js";
import { buildUserNachtragenModal } from "../modals/batchPastHolidayModal.js";
import { buildOverviewModal } from "../modals/overviewModal.js";
import { buildReviewModal } from "../modals/reviewModal.js";
import { balanceBlocks, formatDays } from "../modals/shared.js";
import { t } from "../i18n/t.js";
import { buildMyHolidaysView, isHomeSurface, openOrPush, refreshHome } from "./views.js";

function currentUser(userId: string): User | null {
  return createUserRepo(getDb()).findById(userId);
}

export function registerActionHandlers(app: App) {
  // ---------------------------------------------------------------- approvals
  // Approving is the common case and stays one click. Rejecting opens a small
  // form, because a rejection with no reason just moves the conversation to DMs.
  app.action("approve_request", async ({ ack, action, body, client }) => {
    await ack();
    await applyDecision(client, body, Number((action as any).value), "approve", null, true);
  });

  app.action("reject_request", async ({ ack, action, body, client }) => {
    await ack();
    await openReviewModal(client, body, Number((action as any).value), "reject");
  });

  app.action(/^review_approve_\d+$/, async ({ ack, action, body, client }) => {
    await ack();
    await applyDecision(client, body, Number((action as any).value), "approve", null, false);
  });

  app.action(/^review_reject_\d+$/, async ({ ack, action, body, client }) => {
    await ack();
    await openReviewModal(client, body, Number((action as any).value), "reject");
  });

  // ------------------------------------------------------------------- menus
  app.action("open_request_modal", async ({ ack, body, client }) => {
    await ack();
    const user = currentUser(body.user.id);
    if (!user) return;
    await openOrPush(client, body, buildRequestModal(user.language, EMPTY_DRAFT));
  });

  app.action("open_nachtragen_modal", async ({ ack, body, client }) => {
    await ack();
    const user = currentUser(body.user.id);
    if (!user) return;
    await openOrPush(client, body, buildUserNachtragenModal(user.language));
  });

  app.action("show_balance", async ({ ack, body, client }) => {
    await ack();
    const user = currentUser(body.user.id);
    if (!user) return;

    const snapshot = await getBalanceSnapshot(getDb(), user);
    await openOrPush(client, body, {
      type: "modal",
      title: { type: "plain_text", text: `${t("balance.title", user.language)} ${snapshot.year}` },
      close: { type: "plain_text", text: t("common.back", user.language) },
      blocks: balanceBlocks(snapshot, user.language),
    });
  });

  app.action("show_list", async ({ ack, body, client }) => {
    await ack();
    const user = currentUser(body.user.id);
    if (!user) return;
    await openOrPush(client, body, await buildMyHolidaysView(user));
  });

  app.action("my_holidays_more", async ({ ack, action, body, client }) => {
    await ack();
    const user = currentUser(body.user.id);
    if (!user) return;
    const offset = Number((action as any).value) || 0;
    await client.views.update({
      view_id: (body as any).view.id,
      view: await buildMyHolidaysView(user, offset),
    });
  });

  app.action("show_holidays", async ({ ack, body, client }) => {
    await ack();
    const user = currentUser(body.user.id);
    if (!user) return;

    const lang = user.language;
    const bundesland = createSettingsRepo(getDb()).getBundesland();
    const year = new Date().getUTCFullYear();
    const blocks: any[] = [];

    if (!bundesland) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: t("holidays.no_bundesland", lang) } });
    } else {
      const holidays = await getPublicHolidaysForYear(year, bundesland);
      const today = todayIso();
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: holidays
            .map((h) => {
              const name = lang === "de" ? h.nameDe : h.name;
              const past = h.date < today;
              return `${past ? "" : "*"}${formatDate(h.date, lang)}${past ? "" : "*"}  ·  ${name}`;
            })
            .join("\n"),
        },
      });
    }

    await openOrPush(client, body, {
      type: "modal",
      title: { type: "plain_text", text: t("holidays.title", lang, { year: String(year) }) },
      close: { type: "plain_text", text: t("common.back", lang) },
      blocks,
    });
  });

  app.action("toggle_language", async ({ ack, body, client }) => {
    await ack();
    const db = getDb();
    const userRepo = createUserRepo(db);
    const user = userRepo.findById(body.user.id);
    if (!user) return;

    const newLang = user.language === "en" ? "de" : "en";
    userRepo.setLanguage(user.slackId, newLang);
    const updated = { ...user, language: newLang };

    if (isHomeSurface(body)) {
      await refreshHome(client, updated);
      return;
    }

    await client.views.update({
      view_id: (body as any).view.id,
      view: buildMainMenuModal(newLang, user.isAdmin),
    });
  });

  // --------------------------------------------- live preview in the request form
  // Any change to the dates or the length re-renders the view. views.update
  // replaces the whole thing, so the draft carries every in-progress value.
  const rerender = async ({ ack, body, client }: any) => {
    await ack();
    const user = currentUser(body.user.id);
    if (!user) return;

    const view = body.view;
    if (!view?.state?.values) return;

    const draft = readDraft(view.state.values);
    const preview = await previewRequest(getDb(), user, draft, user.language);

    await client.views.update({
      view_id: view.id,
      hash: view.hash,
      view: buildRequestModal(user.language, draft, preview),
    });
  };

  app.action("start_date", rerender);
  app.action("end_date", rerender);
  app.action("half_days", rerender);
  app.action("half_choice", rerender);

  // ---------------------------------------------------------------- overview
  app.action("open_overview", async ({ ack, body, client }) => {
    await ack();
    const db = getDb();
    const user = currentUser(body.user.id);
    if (!user) return;

    const requestRepo = createRequestRepo(db);
    const settingsRepo = createSettingsRepo(db);
    const bundesland = settingsRepo.getBundesland();
    const userRepo = createUserRepo(db);
    const year = new Date().getUTCFullYear();
    const today = todayIso();

    // Balances are admin-only; the absence calendar is for everyone, since
    // "is anyone else away then?" is what stops the clash before it happens.
    const balances = user.isAdmin
      ? await Promise.all(
          userRepo.getAll().map(async (u) => {
            const snapshot = await getBalanceSnapshot(db, u, year);
            return { user: u, used: snapshot.used, remaining: snapshot.remaining, carryover: snapshot.carryover };
          })
        )
      : [];

    const allUpcoming = requestRepo.getUpcomingApproved(today);
    const publicHolidays = bundesland
      ? await getHolidayDatesForYears(yearsSpannedBy(allUpcoming, year), bundesland)
      : [];

    const upcoming = allUpcoming.map((r) => ({
      request: r,
      days: calculateRequestDays(r.startDate, r.endDate, r.halfDayStart, r.halfDayEnd, publicHolidays),
    }));

    await openOrPush(client, body, buildOverviewModal(user.language, balances, upcoming, today, user.isAdmin));
  });

  app.action("overview_more", async ({ ack, action, body, client }) => {
    await ack();
    const user = currentUser(body.user.id);
    if (!user) return;

    const db = getDb();
    const requestRepo = createRequestRepo(db);
    const bundesland = createSettingsRepo(db).getBundesland();
    const today = todayIso();
    const year = new Date().getUTCFullYear();

    const allUpcoming = requestRepo.getUpcomingApproved(today);
    const publicHolidays = bundesland
      ? await getHolidayDatesForYears(yearsSpannedBy(allUpcoming, year), bundesland)
      : [];
    const upcoming = allUpcoming.map((r) => ({
      request: r,
      days: calculateRequestDays(r.startDate, r.endDate, r.halfDayStart, r.halfDayEnd, publicHolidays),
    }));

    await client.views.update({
      view_id: (body as any).view.id,
      view: buildOverviewModal(user.language, [], upcoming, today, user.isAdmin, Number((action as any).value) || 0),
    });
  });

  // ------------------------------------------------------------ cancellation
  app.action(/^cancel_request_\d+$/, async ({ ack, action, body, client }) => {
    await ack();
    const db = getDb();
    const userRepo = createUserRepo(db);
    const requestRepo = createRequestRepo(db);

    const user = userRepo.findById(body.user.id);
    if (!user) return;

    const requestId = Number((action as any).value);
    const request = requestRepo.findById(requestId);

    // Never trust the action id alone — a user may only cancel their own request
    if (!request || request.userId !== user.slackId) return;

    const eligibility = canUserCancel(request, todayIso());
    if (!eligibility.allowed) {
      await sendDM(client, user.slackId, t(`cancel.blocked_${eligibility.reason}`, user.language));
      return;
    }

    const wasApproved = request.status === "approved";
    requestRepo.cancel(requestId, user.slackId);

    if (isHomeSurface(body)) {
      await refreshHome(client, user);
    } else {
      await client.views.update({
        view_id: (body as any).view.id,
        view: await buildMyHolidaysView(user),
      });
      await refreshHome(client, user);
    }

    await sendDM(
      client,
      user.slackId,
      t("cancel.done", user.language, { range: formatRange(request.startDate, request.endDate, user.language) })
    );

    // Admins lose the approve/reject buttons on a withdrawn request, so silence
    // here would leave them acting on stale information.
    const noticeKey = wasApproved ? "cancel.admin_notice_approved" : "cancel.admin_notice_pending";
    await sendDMs(
      client,
      userRepo
        .getAdmins()
        .filter((admin) => admin.slackId !== user.slackId)
        .map((admin) => ({
          userId: admin.slackId,
          text: t(noticeKey, admin.language, {
            name: user.name,
            range: formatRange(request.startDate, request.endDate, admin.language),
          }),
        }))
    );
  });
}

// ---------------------------------------------------------------------------

async function openReviewModal(client: any, body: any, requestId: number, action: "approve" | "reject") {
  const db = getDb();
  const userRepo = createUserRepo(db);
  const requestRepo = createRequestRepo(db);

  const admin = userRepo.findById(body.user.id);
  if (!admin?.isAdmin) return;

  const request = requestRepo.findById(requestId);
  if (!request || request.status !== "pending") {
    await sendDM(client, admin.slackId, t("approval.no_longer_pending", admin.language));
    return;
  }

  const requester = userRepo.findById(request.userId);
  if (!requester) return;

  const context = await getRequestContext(db, requester, request);
  await openOrPush(client, body, buildReviewModal(admin.language, action, request, requester.name, context));
}

/**
 * Apply an approve/reject decision. Re-checks that the request is still pending
 * — an employee can withdraw between the admin DM being posted and the button
 * being clicked.
 */
export async function applyDecision(
  client: any,
  body: any,
  requestId: number,
  action: "approve" | "reject",
  comment: string | null,
  updateSourceMessage: boolean
): Promise<boolean> {
  const db = getDb();
  const userRepo = createUserRepo(db);
  const requestRepo = createRequestRepo(db);

  const admin = userRepo.findById(body.user.id);
  if (!admin?.isAdmin) return false;

  const request = requestRepo.findById(requestId);
  if (!request || request.status !== "pending") {
    if (updateSourceMessage) {
      await updateMessage(client, body, t("approval.no_longer_pending", admin.language));
    } else {
      await sendDM(client, admin.slackId, t("approval.no_longer_pending", admin.language));
    }
    return false;
  }

  if (action === "approve") {
    requestRepo.approve(requestId, admin.slackId, comment);
  } else {
    requestRepo.reject(requestId, admin.slackId, comment);
  }

  const requester = userRepo.findById(request.userId);
  if (requester) {
    const range = formatRange(request.startDate, request.endDate, requester.language);
    const outcomeKey = action === "approve" ? "approval.approved" : "approval.rejected";
    const lines = [t(outcomeKey, requester.language, { range })];
    if (comment) lines.push(t("approval.comment", requester.language, { comment }));
    await sendDM(client, requester.slackId, lines.join("\n"));
    await refreshHome(client, requester);
  }

  if (updateSourceMessage) {
    const range = formatRange(request.startDate, request.endDate, admin.language);
    const doneKey = action === "approve" ? "approval.approved_by_you" : "approval.rejected_by_you";
    await updateMessage(
      client,
      body,
      t(doneKey, admin.language, { name: requester?.name ?? request.userId, range })
    );
  }

  await refreshHome(client, admin);
  return true;
}

/** Replace the buttons on the DM the admin acted from, so it can't be re-clicked. */
async function updateMessage(client: any, body: any, text: string) {
  const ts = body?.message?.ts;
  if (!ts) return;
  try {
    await client.chat.update({ channel: body.channel?.id ?? body.user.id, ts, text, blocks: [] });
  } catch (err) {
    console.error("[slack] could not update source message:", err);
  }
}
