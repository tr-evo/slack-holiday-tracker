import type { App } from "@slack/bolt";
import { getDb } from "../db/connection.js";
import { createUserRepo, type User } from "../db/repositories/userRepo.js";
import { createRequestRepo } from "../db/repositories/requestRepo.js";
import { createSettingsRepo } from "../db/repositories/settingsRepo.js";
import { getBalanceSnapshot, yearsSpannedBy } from "../services/balance.js";
import { getHolidayDatesForYears, getPublicHolidaysForYear } from "../services/publicHolidays.js";
import { calculateRequestDays } from "../services/allowance.js";
import { formatDate, formatRange, todayIso } from "../services/dates.js";
import { buildMainMenuModal } from "../modals/mainMenu.js";
import { buildRequestModal, EMPTY_DRAFT } from "../modals/requestModal.js";
import { balanceBlocks, describeRequest, formatDays, statusLabel } from "../modals/shared.js";
import { t } from "../i18n/t.js";
import { refreshHome } from "./views.js";

function ensureUser(slackId: string, name: string): User {
  const userRepo = createUserRepo(getDb());
  userRepo.upsert({ slackId, name });
  return userRepo.findById(slackId)!;
}

export function registerHolidayHandlers(app: App) {
  app.command("/holiday", async ({ command, ack, client, respond }) => {
    await ack();

    const subcommand = command.text.trim().toLowerCase();
    const user = ensureUser(command.user_id, command.user_name);
    const lang = user.language;
    const db = getDb();

    // Answers appear where the question was asked. These used to open a DM
    // channel and post there, so the reply arrived somewhere else entirely,
    // with an unread badge, as if a person had messaged you.
    const reply = (blocks: any[], text: string) =>
      respond({ response_type: "ephemeral", text, blocks });

    if (subcommand === "request") {
      await client.views.open({
        trigger_id: command.trigger_id,
        view: buildRequestModal(lang, EMPTY_DRAFT),
      });
      return;
    }

    if (subcommand === "balance") {
      const snapshot = await getBalanceSnapshot(db, user);
      await reply(
        [
          { type: "header", text: { type: "plain_text", text: `${t("balance.title", lang)} ${snapshot.year}` } },
          ...balanceBlocks(snapshot, lang),
        ],
        `${t("balance.title", lang)}: ${formatDays(snapshot.remaining, lang)}`
      );
      return;
    }

    if (subcommand === "list") {
      const requestRepo = createRequestRepo(db);
      const bundesland = createSettingsRepo(db).getBundesland();
      const requests = requestRepo.listByUser(user.slackId);

      if (requests.length === 0) {
        await reply(
          [{ type: "section", text: { type: "mrkdwn", text: t("list.empty", lang) } }],
          t("list.empty", lang)
        );
        return;
      }

      const publicHolidays = bundesland
        ? await getHolidayDatesForYears(yearsSpannedBy(requests, new Date().getUTCFullYear()), bundesland)
        : [];

      const lines = requests.slice(0, 15).map((r) => {
        const days = calculateRequestDays(r.startDate, r.endDate, r.halfDayStart, r.halfDayEnd, publicHolidays);
        return `${describeRequest(r, days, lang)}  ·  ${statusLabel(r.status, lang)}`;
      });

      const blocks: any[] = [
        { type: "header", text: { type: "plain_text", text: t("list.title", lang) } },
        { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
      ];

      if (requests.length > 15) {
        blocks.push({
          type: "context",
          elements: [{ type: "mrkdwn", text: t("common.show_more", lang, { shown: "15", total: String(requests.length) }) }],
        });
      }

      blocks.push({
        type: "actions",
        elements: [{
          type: "button",
          action_id: "show_list",
          text: { type: "plain_text", text: t("list.manage", lang) },
        }],
      });

      await reply(blocks, t("list.title", lang));
      return;
    }

    if (subcommand === "public") {
      const bundesland = createSettingsRepo(db).getBundesland();
      const year = new Date().getUTCFullYear();

      if (!bundesland) {
        await reply(
          [{ type: "section", text: { type: "mrkdwn", text: t("holidays.no_bundesland", lang) } }],
          t("holidays.no_bundesland", lang)
        );
        return;
      }

      const holidays = await getPublicHolidaysForYear(year, bundesland);
      const today = todayIso();
      const text = holidays
        .map((h) => {
          const name = lang === "de" ? h.nameDe : h.name;
          const upcoming = h.date >= today;
          return `${upcoming ? "*" : ""}${formatDate(h.date, lang)}${upcoming ? "*" : ""}  ·  ${name}`;
        })
        .join("\n");

      await reply(
        [
          { type: "header", text: { type: "plain_text", text: t("holidays.title", lang, { year: String(year) }) } },
          { type: "section", text: { type: "mrkdwn", text } },
        ],
        t("holidays.title", lang, { year: String(year) })
      );
      return;
    }

    if (subcommand === "help") {
      await reply(
        [{ type: "section", text: { type: "mrkdwn", text: t("help.body", lang) } }],
        t("help.body", lang)
      );
      return;
    }

    await client.views.open({
      trigger_id: command.trigger_id,
      view: buildMainMenuModal(lang, user.isAdmin),
    });

    // First contact for most people — make sure the Home tab is populated
    await refreshHome(client, user);
  });
}
