import type { App } from "@slack/bolt";
import { getDb } from "../db/connection.js";
import { createUserRepo } from "../db/repositories/userRepo.js";
import { createRequestRepo } from "../db/repositories/requestRepo.js";
import { createPublicHolidayRepo } from "../db/repositories/publicHolidayRepo.js";
import { buildMainMenuModal } from "../modals/mainMenu.js";
import { buildRequestModal } from "../modals/requestModal.js";
import { calculateRemainingDays } from "../services/allowance.js";
import { t } from "../i18n/t.js";

function ensureUser(slackId: string, name: string) {
  const db = getDb();
  const userRepo = createUserRepo(db);
  userRepo.upsert({ slackId, name });
  return userRepo.findById(slackId)!;
}

export function registerHolidayHandlers(app: App) {
  app.command("/holiday", async ({ command, ack, client }) => {
    await ack();
    const subcommand = command.text.trim().toLowerCase();
    const user = ensureUser(command.user_id, command.user_name);

    if (subcommand === "request") {
      await client.views.open({
        trigger_id: command.trigger_id,
        view: buildRequestModal(user.language),
      });
      return;
    }

    if (subcommand === "balance") {
      const db = getDb();
      const requestRepo = createRequestRepo(db);
      const publicHolidayRepo = createPublicHolidayRepo(db);
      const year = new Date().getFullYear();
      const approved = requestRepo.getApprovedForUserInYear(user.slackId, year);
      const publicHolidays = publicHolidayRepo.getDatesForYear(year);
      const remaining = calculateRemainingDays(user.annualAllowance, approved, publicHolidays);
      const used = user.annualAllowance - remaining;

      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: [
          `*${t("balance.title", user.language)}*`,
          t("balance.total", user.language, { days: String(user.annualAllowance) }),
          t("balance.used", user.language, { days: String(used) }),
          t("balance.remaining", user.language, { days: String(remaining) }),
        ].join("\n"),
      });
      return;
    }

    if (subcommand === "list") {
      const db = getDb();
      const requestRepo = createRequestRepo(db);
      const requests = requestRepo.listByUser(user.slackId);

      if (requests.length === 0) {
        await client.chat.postEphemeral({
          channel: command.channel_id,
          user: command.user_id,
          text: t("list.empty", user.language),
        });
        return;
      }

      const lines = requests.map((r) => {
        const status = t(`list.status.${r.status}`, user.language);
        const halfDayInfo = [
          r.halfDayStart ? `(${t("request.half_day_start", user.language)})` : "",
          r.halfDayEnd ? `(${t("request.half_day_end", user.language)})` : "",
        ].filter(Boolean).join(" ");
        return `• ${r.startDate} → ${r.endDate} ${halfDayInfo} — *${status}*`;
      });

      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: `*${t("list.title", user.language)}*\n${lines.join("\n")}`,
      });
      return;
    }

    // Default: open main menu modal
    await client.views.open({
      trigger_id: command.trigger_id,
      view: buildMainMenuModal(user.language, user.isAdmin),
    });
  });
}
