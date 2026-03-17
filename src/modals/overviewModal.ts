import { t } from "../i18n/t.js";
import type { User } from "../db/repositories/userRepo.js";
import type { HolidayRequest } from "../db/repositories/requestRepo.js";

interface UserBalance {
  user: User;
  used: number;
  remaining: number;
  carryover: number;
}

export function buildOverviewModal(
  lang: string,
  balances: UserBalance[],
  upcoming: { request: HolidayRequest; days: number }[]
) {
  const blocks: any[] = [];

  // Team balance section
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: t("overview.balance_header", lang) },
  });

  if (balances.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `_${t("overview.no_users", lang)}_` },
    });
  } else {
    // Sort by remaining days ascending (people running low first)
    const sorted = [...balances].sort((a, b) => a.remaining - b.remaining);
    for (const b of sorted) {
      const carryoverInfo = b.carryover > 0
        ? ` (+${b.carryover} ${t("overview.carryover_short", lang)})`
        : "";
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `<@${b.user.slackId}>  —  ${b.user.annualAllowance}d${carryoverInfo}  |  ${t("overview.used", lang)}: ${b.used}  |  *${t("overview.remaining", lang)}: ${b.remaining}*`,
        },
      });
    }
  }

  blocks.push({ type: "divider" });

  // Upcoming vacations section
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: t("overview.upcoming_header", lang) },
  });

  if (upcoming.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `_${t("overview.no_upcoming", lang)}_` },
    });
  } else {
    const today = new Date().toISOString().slice(0, 10);
    for (const u of upcoming) {
      const isNow = u.request.startDate <= today && u.request.endDate >= today;
      const prefix = isNow ? ":palm_tree: " : "";
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${prefix}<@${u.request.userId}>  —  ${u.request.startDate} → ${u.request.endDate}  (${u.days}d)`,
        },
      });
    }
  }

  return {
    type: "modal" as const,
    title: { type: "plain_text" as const, text: t("overview.title", lang) },
    close: { type: "plain_text" as const, text: "Back" },
    blocks,
  };
}
