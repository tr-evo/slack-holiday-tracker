import type { App } from "@slack/bolt";
import { getDb } from "../db/connection.js";
import { createUserRepo } from "../db/repositories/userRepo.js";
import { createRequestRepo } from "../db/repositories/requestRepo.js";
import { buildMainMenuModal } from "../modals/mainMenu.js";
import { buildRequestModal } from "../modals/requestModal.js";
import { calculateRemainingDays, calculateUsageBreakdown, getEffectiveCarryover } from "../services/allowance.js";
import { createSettingsRepo } from "../db/repositories/settingsRepo.js";
import { getHolidayDatesForYear, getHolidayDatesForYears, getPublicHolidaysForYear } from "../services/publicHolidays.js";
import { sendDM } from "../services/slack.js";
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
    const userId = command.user_id;

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
      const settingsRepo = createSettingsRepo(db);
      const bundesland = settingsRepo.getBundesland();
      const year = new Date().getFullYear();
      const approved = requestRepo.getApprovedForUserInYear(user.slackId, year);
      // Collect all years from approved requests for correct cross-year holiday exclusion
      const requestYears = new Set([year]);
      for (const req of approved) {
        requestYears.add(Number(req.startDate.slice(0, 4)));
        requestYears.add(Number(req.endDate.slice(0, 4)));
      }
      const publicHolidays = bundesland ? await getHolidayDatesForYears([...requestYears], bundesland) : [];
      const carryover = getEffectiveCarryover(
        user.carryoverDays,
        settingsRepo.isCarryoverEnabled(),
        settingsRepo.getCarryoverCutoff()
      );
      const remaining = calculateRemainingDays(user.annualAllowance, approved, publicHolidays, carryover);
      const used = user.annualAllowance + carryover - remaining;
      const breakdown = calculateUsageBreakdown(carryover, approved, publicHolidays);

      const cutoff = settingsRepo.getCarryoverCutoff();
      const carryoverUnused = carryover - breakdown.usedFromCarryover;
      const cutoffDisplay = cutoff.split("-").reverse().join(".");

      const lines = [
        `*${t("balance.title", user.language)}*`,
        t("balance.total", user.language, { days: String(user.annualAllowance) }),
      ];
      if (carryover > 0) {
        lines.push(t("balance.carryover", user.language, { days: String(carryover) }));
        if (carryoverUnused > 0) {
          lines.push(`  └ ${t("balance.carryover_expires", user.language, { days: String(carryoverUnused), date: cutoffDisplay })}`);
        }
      } else if (user.carryoverDays > 0 && settingsRepo.isCarryoverEnabled()) {
        lines.push(t("balance.carryover_expired", user.language, { days: String(user.carryoverDays), date: cutoffDisplay }));
      }
      lines.push(
        t("balance.used", user.language, { days: String(used) }),
        t("balance.remaining", user.language, { days: String(remaining) }),
      );

      await sendDM(client, userId, lines.join("\n"));
      return;
    }

    if (subcommand === "list") {
      const db = getDb();
      const requestRepo = createRequestRepo(db);
      const requests = requestRepo.listByUser(user.slackId);

      if (requests.length === 0) {
        await sendDM(client, userId, t("list.empty", user.language));
        return;
      }

      const lines = requests.map((r) => {
        const status = t(`list.status.${r.status}`, user.language);
        const halfDayInfo = [
          r.halfDayStart ? `(${t("request.half_day_start", user.language)})` : "",
          r.halfDayEnd ? `(${t("request.half_day_end", user.language)})` : "",
        ].filter(Boolean).join(" ");
        const reason = r.reason ? ` — _${r.reason}_` : "";
        return `• ${r.startDate} → ${r.endDate} ${halfDayInfo} — *${status}*${reason}`;
      });

      await sendDM(client, userId, `*${t("list.title", user.language)}*\n${lines.join("\n")}`);
      return;
    }

    if (subcommand === "public") {
      const db = getDb();
      const settingsRepo = createSettingsRepo(db);
      const bundesland = settingsRepo.getBundesland();
      const year = new Date().getFullYear();

      if (!bundesland) {
        await sendDM(client, userId, t("holidays.no_bundesland", user.language));
        return;
      }

      const holidays = await getPublicHolidaysForYear(year, bundesland);
      const lines = holidays.map((h) => {
        const name = user.language === "de" ? h.nameDe : h.name;
        return `• ${h.date} — ${name}`;
      });

      await sendDM(client, userId, `*${t("holidays.title", user.language, { year: String(year) })}*\n${lines.join("\n")}`);
      return;
    }

    // Default: open main menu modal
    await client.views.open({
      trigger_id: command.trigger_id,
      view: buildMainMenuModal(user.language, user.isAdmin),
    });
  });
}
