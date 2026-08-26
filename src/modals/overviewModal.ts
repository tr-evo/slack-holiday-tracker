import { t } from "../i18n/t.js";
import type { User } from "../db/repositories/userRepo.js";
import type { HolidayRequest } from "../db/repositories/requestRepo.js";
import { formatRange } from "../services/dates.js";
import { formatDays, paginate, showMoreBlock } from "./shared.js";

interface UserBalance {
  user: User;
  used: number;
  remaining: number;
  carryover: number;
}

/**
 * Who is away, and — for admins only — how everyone's balance stands.
 *
 * The absence list is visible to everyone: "is anyone else off that week?" is
 * the question employees want answered before they book, and it is what stops
 * the clash that makes an approver say no. Balances stay admin-only.
 */
export function buildOverviewModal(
  lang: string,
  balances: UserBalance[],
  upcoming: { request: HolidayRequest; days: number }[],
  today: string,
  isAdmin: boolean,
  offset = 0
) {
  const blocks: any[] = [];

  blocks.push({ type: "header", text: { type: "plain_text", text: t("overview.upcoming_header", lang) } });

  if (upcoming.length === 0) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: t("overview.no_upcoming", lang) }] });
  } else {
    const { page, hasMore, shown, total } = paginate(upcoming, offset);
    for (const u of page) {
      const now = u.request.startDate <= today && u.request.endDate >= today;
      blocks.push({
        type: "context",
        elements: [{
          type: "mrkdwn",
          text: `${now ? ":palm_tree: " : ""}<@${u.request.userId}>  ·  ${formatRange(u.request.startDate, u.request.endDate, lang)}  ·  ${t("common.days", lang, { days: formatDays(u.days, lang) })}`,
        }],
      });
    }
    if (hasMore) blocks.push(showMoreBlock(lang, "overview_more", shown, shown, total));
  }

  if (isAdmin && balances.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({ type: "header", text: { type: "plain_text", text: t("overview.balance_header", lang) } });

    // People running low first — that is who an approver needs to notice.
    const sorted = [...balances].sort((a, b) => a.remaining - b.remaining);
    for (const b of sorted.slice(0, 40)) {
      const carryoverInfo = b.carryover > 0 ? ` (+${formatDays(b.carryover, lang)} ${t("overview.carryover_short", lang)})` : "";
      blocks.push({
        type: "context",
        elements: [{
          type: "mrkdwn",
          text: `<@${b.user.slackId}>  ·  ${t("overview.remaining", lang)}: *${formatDays(b.remaining, lang)}*  ·  ${t("overview.used", lang)}: ${formatDays(b.used, lang)} / ${formatDays(b.user.annualAllowance, lang)}${carryoverInfo}`,
        }],
      });
    }
    if (sorted.length > 40) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: t("overview.truncated", lang, { count: String(sorted.length - 40) }) }],
      });
    }
  }

  return {
    type: "modal" as const,
    title: { type: "plain_text" as const, text: t("overview.title", lang) },
    close: { type: "plain_text" as const, text: t("common.back", lang) },
    blocks,
  };
}
