import { t } from "../i18n/t.js";
import { formatRange } from "../services/dates.js";
import type { HolidayRequest } from "../db/repositories/requestRepo.js";
import type { RequestContext } from "../services/balance.js";
import { formatDays } from "./shared.js";

export type ReviewAction = "approve" | "reject";

/**
 * Approve or reject with an optional note.
 *
 * `holiday_requests.reviewer_comment` has existed since the first schema and
 * was written as null at every call site, so rejections arrived with no reason
 * and the conversation moved to a separate DM thread.
 */
export function buildReviewModal(
  lang: string,
  action: ReviewAction,
  request: HolidayRequest,
  requesterName: string,
  context: RequestContext
) {
  const blocks: any[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*${requesterName}*  ·  ${formatRange(request.startDate, request.endDate, lang)}`,
          t("common.days", lang, { days: formatDays(context.days, lang) }),
        ].join("\n"),
      },
    },
  ];

  if (request.reason) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `> ${request.reason}` } });
  }

  blocks.push(...contextBlocks(lang, context));

  blocks.push({
    type: "input",
    block_id: "review_comment_block",
    optional: true,
    element: {
      type: "plain_text_input",
      action_id: "review_comment",
      multiline: true,
      placeholder: {
        type: "plain_text",
        text: t(action === "reject" ? "review.comment_reject_hint" : "review.comment_approve_hint", lang),
      },
    },
    label: { type: "plain_text", text: t("review.comment", lang, { name: requesterName }) },
  });

  return {
    type: "modal" as const,
    callback_id: "review_submit",
    private_metadata: JSON.stringify({ requestId: request.id, action }),
    title: { type: "plain_text" as const, text: t(`review.title_${action}`, lang) },
    submit: { type: "plain_text" as const, text: t(`approval.${action}`, lang) },
    close: { type: "plain_text" as const, text: t("common.cancel", lang) },
    blocks,
  };
}

/** What an approver would otherwise have to go and look up themselves. */
export function contextBlocks(lang: string, context: RequestContext): any[] {
  const parts: string[] = [
    t("review.leaves", lang, {
      after: formatDays(context.remainingAfter, lang),
      before: formatDays(context.remainingBefore, lang),
    }),
  ];

  if (context.remainingAfter < 0) {
    parts.push(`:warning: ${t("review.over_budget", lang)}`);
  }

  if (context.overlaps.length === 0) {
    parts.push(t("review.no_overlap", lang));
  } else {
    const who = context.overlaps
      .slice(0, 4)
      .map((o) => `<@${o.userId}> (${formatRange(o.startDate, o.endDate, lang)})`)
      .join(", ");
    const extra = context.overlaps.length > 4 ? ` +${context.overlaps.length - 4}` : "";
    parts.push(`:warning: ${t("review.overlaps", lang, { who: who + extra })}`);
  }

  return [{ type: "context", elements: [{ type: "mrkdwn", text: parts.join("  ·  ") }] }];
}
