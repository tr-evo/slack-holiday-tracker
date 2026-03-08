import type { App } from "@slack/bolt";
import { getDb } from "../db/connection.js";
import { createUserRepo } from "../db/repositories/userRepo.js";
import { createRequestRepo } from "../db/repositories/requestRepo.js";
import { createPublicHolidayRepo } from "../db/repositories/publicHolidayRepo.js";
import { calculateRemainingDays } from "../services/allowance.js";
import { buildMainMenuModal } from "../modals/mainMenu.js";
import { buildRequestModal } from "../modals/requestModal.js";
import { t } from "../i18n/t.js";

export function registerActionHandlers(app: App) {
  // Approve request
  app.action("approve_request", async ({ ack, action, body, client }) => {
    await ack();
    const db = getDb();
    const userRepo = createUserRepo(db);
    const requestRepo = createRequestRepo(db);

    const requestId = Number((action as any).value);
    const adminId = body.user.id;

    requestRepo.approve(requestId, adminId, null);
    const request = requestRepo.findById(requestId)!;
    const requester = userRepo.findById(request.userId);

    if (requester) {
      await client.chat.postMessage({
        channel: requester.slackId,
        text: t("approval.approved", requester.language, {
          start: request.startDate,
          end: request.endDate,
        }),
      });
    }

    // Update the admin's message to show it's been handled
    await client.chat.update({
      channel: (body as any).channel?.id ?? body.user.id,
      ts: (body as any).message?.ts ?? "",
      text: `Approved: ${request.startDate} → ${request.endDate} for <@${request.userId}>`,
      blocks: [],
    });
  });

  // Reject request
  app.action("reject_request", async ({ ack, action, body, client }) => {
    await ack();
    const db = getDb();
    const userRepo = createUserRepo(db);
    const requestRepo = createRequestRepo(db);

    const requestId = Number((action as any).value);
    const adminId = body.user.id;

    requestRepo.reject(requestId, adminId, null);
    const request = requestRepo.findById(requestId)!;
    const requester = userRepo.findById(request.userId);

    if (requester) {
      await client.chat.postMessage({
        channel: requester.slackId,
        text: t("approval.rejected", requester.language, {
          start: request.startDate,
          end: request.endDate,
        }),
      });
    }

    await client.chat.update({
      channel: (body as any).channel?.id ?? body.user.id,
      ts: (body as any).message?.ts ?? "",
      text: `Rejected: ${request.startDate} → ${request.endDate} for <@${request.userId}>`,
      blocks: [],
    });
  });

  // Menu: open request modal
  app.action("open_request_modal", async ({ ack, body, client }) => {
    await ack();
    const db = getDb();
    const userRepo = createUserRepo(db);
    const user = userRepo.findById(body.user.id);
    const lang = user?.language ?? "en";
    await client.views.push({
      trigger_id: (body as any).trigger_id,
      view: buildRequestModal(lang),
    });
  });

  // Menu: show balance (push modal view)
  app.action("show_balance", async ({ ack, body, client }) => {
    await ack();
    const db = getDb();
    const userRepo = createUserRepo(db);
    const requestRepo = createRequestRepo(db);
    const publicHolidayRepo = createPublicHolidayRepo(db);

    const user = userRepo.findById(body.user.id);
    if (!user) return;

    const year = new Date().getFullYear();
    const approved = requestRepo.getApprovedForUserInYear(user.slackId, year);
    const publicHolidays = publicHolidayRepo.getDatesForYear(year);
    const remaining = calculateRemainingDays(user.annualAllowance, approved, publicHolidays);
    const used = user.annualAllowance - remaining;

    await client.views.push({
      trigger_id: (body as any).trigger_id,
      view: {
        type: "modal",
        title: { type: "plain_text", text: t("balance.title", user.language) },
        close: { type: "plain_text", text: "Back" },
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: [
                t("balance.total", user.language, { days: String(user.annualAllowance) }),
                t("balance.used", user.language, { days: String(used) }),
                `*${t("balance.remaining", user.language, { days: String(remaining) })}*`,
              ].join("\n"),
            },
          },
        ],
      },
    });
  });

  // Menu: show list (push modal view)
  app.action("show_list", async ({ ack, body, client }) => {
    await ack();
    const db = getDb();
    const userRepo = createUserRepo(db);
    const requestRepo = createRequestRepo(db);

    const user = userRepo.findById(body.user.id);
    if (!user) return;

    const requests = requestRepo.listByUser(user.slackId);

    const blocks: any[] = [];

    if (requests.length === 0) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: t("list.empty", user.language) },
      });
    } else {
      for (const r of requests) {
        const status = t(`list.status.${r.status}`, user.language);
        const halfDayInfo = [
          r.halfDayStart ? `(${t("request.half_day_start", user.language)})` : "",
          r.halfDayEnd ? `(${t("request.half_day_end", user.language)})` : "",
        ].filter(Boolean).join(" ");
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${r.startDate} → ${r.endDate} ${halfDayInfo}\n*${status}*`,
          },
        });
        blocks.push({ type: "divider" });
      }
    }

    await client.views.push({
      trigger_id: (body as any).trigger_id,
      view: {
        type: "modal",
        title: { type: "plain_text", text: t("list.title", user.language) },
        close: { type: "plain_text", text: "Back" },
        blocks,
      },
    });
  });

  // Menu: show public holidays (push modal view)
  app.action("show_holidays", async ({ ack, body, client }) => {
    await ack();
    const db = getDb();
    const userRepo = createUserRepo(db);
    const publicHolidayRepo = createPublicHolidayRepo(db);

    const user = userRepo.findById(body.user.id);
    if (!user) return;

    const year = new Date().getFullYear();
    const holidays = publicHolidayRepo.getForYear(year);

    const blocks: any[] = [];

    if (holidays.length === 0) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: t("holidays.empty", user.language, { year: String(year) }) },
      });
    } else {
      for (const h of holidays) {
        const name = user.language === "de" ? h.nameDe : h.name;
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: `*${h.date}* — ${name}` },
        });
      }
    }

    await client.views.push({
      trigger_id: (body as any).trigger_id,
      view: {
        type: "modal",
        title: { type: "plain_text", text: t("holidays.title", user.language, { year: String(year) }) },
        close: { type: "plain_text", text: "Back" },
        blocks,
      },
    });
  });

  // Menu: toggle language
  app.action("toggle_language", async ({ ack, body, client }) => {
    await ack();
    const db = getDb();
    const userRepo = createUserRepo(db);
    const user = userRepo.findById(body.user.id);
    if (!user) return;
    const newLang = user.language === "en" ? "de" : "en";
    userRepo.setLanguage(user.slackId, newLang);

    await client.views.update({
      view_id: (body as any).view?.id,
      view: buildMainMenuModal(newLang, user.isAdmin),
    });
  });

  // Acknowledge half_days checkboxes action (no-op, values read on submit)
  app.action("half_days", async ({ ack }) => {
    await ack();
  });
}
