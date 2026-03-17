import type { App } from "@slack/bolt";
import { getDb } from "../db/connection.js";
import { createUserRepo } from "../db/repositories/userRepo.js";
import { createRequestRepo } from "../db/repositories/requestRepo.js";
import { createPublicHolidayRepo } from "../db/repositories/publicHolidayRepo.js";
import { calculateRemainingDays, getEffectiveCarryover, calculateUsageBreakdown, calculateRequestDays } from "../services/allowance.js";
import { createSettingsRepo } from "../db/repositories/settingsRepo.js";
import { buildMainMenuModal } from "../modals/mainMenu.js";
import { buildRequestModal } from "../modals/requestModal.js";
import { buildUserNachtragenModal } from "../modals/batchPastHolidayModal.js";
import { sendDM } from "../services/slack.js";
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
      await sendDM(client, requester.slackId, t("approval.approved", requester.language, {
        start: request.startDate,
        end: request.endDate,
      }));
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
      await sendDM(client, requester.slackId, t("approval.rejected", requester.language, {
        start: request.startDate,
        end: request.endDate,
      }));
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

  // Menu: open nachtragen modal (batch past holidays for self)
  app.action("open_nachtragen_modal", async ({ ack, body, client }) => {
    await ack();
    const db = getDb();
    const userRepo = createUserRepo(db);
    const user = userRepo.findById(body.user.id);
    const lang = user?.language ?? "en";
    await client.views.push({
      trigger_id: (body as any).trigger_id,
      view: buildUserNachtragenModal(lang),
    });
  });

  // Menu: show balance (push modal view)
  app.action("show_balance", async ({ ack, body, client }) => {
    await ack();
    const db = getDb();
    const userRepo = createUserRepo(db);
    const requestRepo = createRequestRepo(db);
    const publicHolidayRepo = createPublicHolidayRepo(db);
    const settingsRepo = createSettingsRepo(db);

    const user = userRepo.findById(body.user.id);
    if (!user) return;

    const year = new Date().getFullYear();
    const approved = requestRepo.getApprovedForUserInYear(user.slackId, year);
    const publicHolidays = publicHolidayRepo.getDatesForYear(year);
    const carryover = getEffectiveCarryover(
      user.carryoverDays,
      settingsRepo.isCarryoverEnabled(),
      settingsRepo.getCarryoverCutoff()
    );
    const remaining = calculateRemainingDays(user.annualAllowance, approved, publicHolidays, carryover);
    const used = user.annualAllowance + carryover - remaining;
    const breakdown = calculateUsageBreakdown(carryover, approved, publicHolidays);

    const lines = [
      t("balance.total", user.language, { days: String(user.annualAllowance) }),
    ];
    if (carryover > 0) {
      lines.push(t("balance.carryover", user.language, { days: String(carryover) }));
    }
    lines.push(t("balance.used", user.language, { days: String(used) }));
    if (carryover > 0) {
      lines.push(
        `  └ ${t("balance.used_from_carryover", user.language, { days: String(breakdown.usedFromCarryover) })}`,
        `  └ ${t("balance.used_from_allowance", user.language, { days: String(breakdown.usedFromAllowance) })}`
      );
    }
    lines.push(`*${t("balance.remaining", user.language, { days: String(remaining) })}*`);

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
              text: lines.join("\n"),
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
    const publicHolidayRepo = createPublicHolidayRepo(db);
    const settingsRepo = createSettingsRepo(db);

    const user = userRepo.findById(body.user.id);
    if (!user) return;

    const requests = requestRepo.listByUser(user.slackId);

    // Calculate source breakdown for approved requests
    const year = new Date().getFullYear();
    const approved = requestRepo.getApprovedForUserInYear(user.slackId, year);
    const publicHolidays = publicHolidayRepo.getDatesForYear(year);
    const carryover = getEffectiveCarryover(
      user.carryoverDays,
      settingsRepo.isCarryoverEnabled(),
      settingsRepo.getCarryoverCutoff()
    );
    const breakdown = calculateUsageBreakdown(carryover, approved, publicHolidays);

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
        const days = calculateRequestDays(r.startDate, r.endDate, r.halfDayStart, r.halfDayEnd, publicHolidays);

        // Show source pot for approved requests when carryover is active
        let sourceInfo = "";
        if (r.status === "approved" && carryover > 0) {
          const source = breakdown.requestSources.get(r.id);
          if (source) {
            sourceInfo = ` · _${t(`list.source_${source}`, user.language)}_`;
          }
        }

        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${r.startDate} → ${r.endDate} ${halfDayInfo} (${days}d${sourceInfo})\n*${status}*${r.reason ? `\n> ${r.reason}` : ""}`,
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

  // When start date changes, update end date picker to default to the selected start date
  app.action("start_date", async ({ ack, body, client }) => {
    await ack();
    const db = getDb();
    const userRepo = createUserRepo(db);
    const user = userRepo.findById(body.user.id);
    const lang = user?.language ?? "en";

    const view = (body as any).view;
    const values = view?.state?.values;
    const selectedStartDate = values?.start_date_block?.start_date?.selected_date;
    const selectedEndDate = values?.end_date_block?.end_date?.selected_date;

    // Only update if start date is set and end date is either empty or before start date
    if (selectedStartDate && (!selectedEndDate || selectedEndDate < selectedStartDate)) {
      const updatedModal = buildRequestModal(lang, selectedStartDate);

      // Preserve the currently selected half-day options
      const selectedHalfDays = values?.half_days_block?.half_days?.selected_options ?? [];
      if (selectedHalfDays.length > 0) {
        const halfDaysBlock = updatedModal.blocks.find((b: any) => b.block_id === "half_days_block");
        if (halfDaysBlock) {
          (halfDaysBlock.element as any).initial_options = selectedHalfDays;
        }
      }

      // Preserve reason text
      const reasonValue = values?.reason_block?.reason?.value;
      if (reasonValue) {
        const reasonBlock = updatedModal.blocks.find((b: any) => b.block_id === "reason_block");
        if (reasonBlock) {
          (reasonBlock.element as any).initial_value = reasonValue;
        }
      }

      await client.views.update({
        view_id: view.id,
        hash: view.hash,
        view: updatedModal,
      });
    }
  });

  // Acknowledge half_days checkboxes action (no-op, values read on submit)
  app.action("half_days", async ({ ack }) => {
    await ack();
  });
}
