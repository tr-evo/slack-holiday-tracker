import { t } from "../i18n/t.js";
import { formatRange } from "../services/dates.js";
import type { HolidayRequest } from "../db/repositories/requestRepo.js";
import type { BalanceSnapshot } from "../services/balance.js";
import { carryoverCutoffDisplay } from "../services/balance.js";

/** Slack refuses any view over 100 blocks; every list here is capped well under it. */
export const MAX_ROWS_PER_PAGE = 20;

/**
 * How a request's half-day flags read to a person. A single day carrying both
 * flags is a full day — that predates the morning/afternoon choice, so old rows
 * still have to render sensibly.
 */
export function describeHalfDay(r: Pick<HolidayRequest, "startDate" | "endDate" | "halfDayStart" | "halfDayEnd">, lang: string): string {
  const singleDay = r.startDate === r.endDate;

  if (singleDay) {
    if (r.halfDayStart && r.halfDayEnd) return "";
    if (r.halfDayStart) return t("half.morning", lang);
    if (r.halfDayEnd) return t("half.afternoon", lang);
    return "";
  }

  const parts: string[] = [];
  if (r.halfDayStart) parts.push(t("half.start_midday", lang));
  if (r.halfDayEnd) parts.push(t("half.end_midday", lang));
  return parts.join(" · ");
}

/** `19.03.2026 – 22.03.2026 · 4 days · afternoon` */
export function describeRequest(r: HolidayRequest, days: number, lang: string): string {
  const half = describeHalfDay(r, lang);
  return [
    `*${formatRange(r.startDate, r.endDate, lang)}*`,
    t("common.days", lang, { days: formatDays(days) }),
    half,
  ].filter(Boolean).join("  ·  ");
}

/** 4 → "4", 4.5 → "4,5" in German. Half days are the only fractions in play. */
export function formatDays(days: number, lang = "en"): string {
  const text = Number.isInteger(days) ? String(days) : days.toFixed(1);
  return lang === "de" ? text.replace(".", ",") : text;
}

export const STATUS_EMOJI: Record<string, string> = {
  pending: ":hourglass_flowing_sand:",
  approved: ":white_check_mark:",
  rejected: ":x:",
  cancelled: ":heavy_minus_sign:",
};

export function statusLabel(status: string, lang: string): string {
  return `${STATUS_EMOJI[status] ?? ""} ${t(`list.status.${status}`, lang)}`.trim();
}

/** The balance summary, as the header of the Home tab and the balance modal. */
export function balanceBlocks(snapshot: BalanceSnapshot, lang: string): any[] {
  const blocks: any[] = [];
  const cutoff = carryoverCutoffDisplay(snapshot.carryoverCutoff, snapshot.year);

  blocks.push({
    type: "section",
    fields: [
      { type: "mrkdwn", text: `*${t("balance.remaining_short", lang)}*\n:palm_tree: *${formatDays(snapshot.remaining, lang)}*` },
      { type: "mrkdwn", text: `*${t("balance.used_short", lang)}*\n${formatDays(snapshot.used, lang)}` },
      { type: "mrkdwn", text: `*${t("balance.allowance_short", lang)}*\n${formatDays(snapshot.allowance, lang)}` },
      ...(snapshot.carryover > 0
        ? [{ type: "mrkdwn", text: `*${t("balance.carryover_short", lang)}*\n${formatDays(snapshot.carryover, lang)}` }]
        : []),
    ],
  });

  if (snapshot.carryover > 0 && snapshot.used > 0) {
    blocks.push({
      type: "context",
      elements: [{
        type: "mrkdwn",
        text: `${t("balance.used_from_carryover", lang, { days: formatDays(snapshot.usedFromCarryover, lang) })}  ·  ${t("balance.used_from_allowance", lang, { days: formatDays(snapshot.usedFromAllowance, lang) })}`,
      }],
    });
  }

  if (snapshot.carryover > 0 && snapshot.carryoverUnused > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:warning: *${t("balance.carryover_warning", lang, { days: formatDays(snapshot.carryoverUnused, lang), date: cutoff })}*`,
      },
    });
  } else if (snapshot.carryover === 0 && snapshot.grantedCarryover > 0 && snapshot.carryoverEnabled) {
    blocks.push({
      type: "context",
      elements: [{
        type: "mrkdwn",
        text: t("balance.carryover_expired", lang, { days: formatDays(snapshot.grantedCarryover, lang), date: cutoff }),
      }],
    });
  }

  return blocks;
}

/** Trim a list to one page and describe what was left out, never silently. */
export function paginate<T>(items: T[], offset: number, size = MAX_ROWS_PER_PAGE) {
  const page = items.slice(offset, offset + size);
  const shown = offset + page.length;
  return { page, hasMore: shown < items.length, shown, total: items.length };
}

export function showMoreBlock(lang: string, actionId: string, nextOffset: number, shown: number, total: number): any {
  return {
    type: "actions",
    elements: [{
      type: "button",
      action_id: actionId,
      text: { type: "plain_text", text: t("common.show_more", lang, { shown: String(shown), total: String(total) }) },
      value: String(nextOffset),
    }],
  };
}

/** Slack's native confirm dialog — no extra view, no stack level consumed. */
export function confirmCancel(lang: string, r: Pick<HolidayRequest, "startDate" | "endDate">, days: number) {
  return {
    title: { type: "plain_text", text: t("cancel.confirm_title", lang) },
    text: {
      type: "mrkdwn",
      text: t("cancel.confirm_text", lang, {
        range: formatRange(r.startDate, r.endDate, lang),
        days: formatDays(days, lang),
      }),
    },
    confirm: { type: "plain_text", text: t("cancel.confirm_yes", lang) },
    deny: { type: "plain_text", text: t("cancel.confirm_no", lang) },
    style: "danger",
  };
}
