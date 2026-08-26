import { t } from "../i18n/t.js";
import type { HolidayRequest } from "../db/repositories/requestRepo.js";
import { canUserCancel } from "../services/cancellation.js";
import { confirmCancel, describeRequest, paginate, showMoreBlock, statusLabel } from "./shared.js";

export interface MyHolidayEntry {
  request: HolidayRequest;
  days: number;
  /** Only set for approved requests while carryover is active */
  source?: "carryover" | "allowance" | "mixed";
}

/**
 * The employee's own request list. Paginated: two blocks per row against a
 * 100-block view ceiling means an unbounded list stops rendering entirely
 * somewhere past the fiftieth request.
 */
export function buildMyHolidaysModal(
  lang: string,
  entries: MyHolidayEntry[],
  today: string,
  offset = 0
) {
  const blocks: any[] = [];
  const { page, hasMore, shown, total } = paginate(entries, offset);

  if (total === 0) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: t("list.empty", lang) } });
  } else {
    for (const { request: r, days, source } of page) {
      const sourceInfo = source ? `  ·  _${t(`list.source_${source}`, lang)}_` : "";
      const section: any = {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${describeRequest(r, days, lang)}${sourceInfo}\n${statusLabel(r.status, lang)}${r.reason ? `\n> ${r.reason}` : ""}${r.reviewerComment ? `\n> _${t("approval.comment", lang, { comment: r.reviewerComment })}_` : ""}`,
        },
      };

      if (canUserCancel(r, today).allowed) {
        section.accessory = {
          type: "button",
          action_id: `cancel_request_${r.id}`,
          style: "danger",
          text: { type: "plain_text", text: t("cancel.button", lang) },
          value: String(r.id),
          confirm: confirmCancel(lang, r, days),
        };
      }

      blocks.push(section);
      blocks.push({ type: "divider" });
    }

    if (hasMore) {
      blocks.push(showMoreBlock(lang, "my_holidays_more", shown, shown, total));
    }
  }

  return {
    type: "modal" as const,
    callback_id: "my_holidays_list",
    private_metadata: JSON.stringify({ offset }),
    title: { type: "plain_text" as const, text: t("list.title", lang) },
    close: { type: "plain_text" as const, text: t("common.back", lang) },
    blocks,
  };
}
