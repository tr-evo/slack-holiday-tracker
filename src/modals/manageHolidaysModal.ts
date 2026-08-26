import { t } from "../i18n/t.js";
import type { HolidayRequest } from "../db/repositories/requestRepo.js";
import { describeRequest, paginate, showMoreBlock, statusLabel } from "./shared.js";

export interface ManageEntry {
  request: HolidayRequest;
  days: number;
}

/**
 * Manage another person's holidays.
 *
 * The user picker lives inside this view and updates it in place, rather than
 * being a separate pushed view whose only job was choosing a name — that cost
 * two extra interactions per person and spent a modal stack level for nothing.
 */
export interface ManageTarget {
  id: string;
  name: string;
}

export function buildManageHolidaysModal(
  lang: string,
  selected: ManageTarget | null,
  entries: ManageEntry[],
  offset = 0
) {
  const blocks: any[] = [];

  blocks.push({
    type: "input",
    block_id: "manage_user_block",
    dispatch_action: true,
    element: {
      type: "external_select",
      action_id: "manage_user_select",
      placeholder: { type: "plain_text", text: t("admin.select_user", lang) },
      min_query_length: 0,
      ...(selected
        ? { initial_option: { text: { type: "plain_text", text: selected.name }, value: selected.id } }
        : {}),
    },
    label: { type: "plain_text", text: t("admin.user", lang) },
  });

  blocks.push({ type: "divider" });

  if (!selected) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: t("admin.pick_user_hint", lang) }] });
  } else if (entries.length === 0) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: t("list.empty", lang) }] });
  } else {
    const { page, hasMore, shown, total } = paginate(entries, offset);

    for (const { request: r, days } of page) {
      const options: any[] = [];

      // Cancelling keeps the row and the audit trail; deleting destroys it.
      // The safe action is the first one and the default reading.
      if (r.status !== "cancelled") {
        options.push({
          text: { type: "plain_text", text: t("admin.cancel_holiday", lang) },
          description: { type: "plain_text", text: t("admin.cancel_holiday_desc", lang) },
          value: `cancel_${r.id}`,
        });
      }
      options.push({
        text: { type: "plain_text", text: t("admin.delete_holiday", lang) },
        description: { type: "plain_text", text: t("admin.delete_holiday_desc", lang) },
        value: `delete_${r.id}`,
      });

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${describeRequest(r, days, lang)}\n${statusLabel(r.status, lang)}${r.reason ? `\n> ${r.reason}` : ""}`,
        },
        accessory: {
          type: "overflow",
          action_id: `manage_holiday_action_${r.id}`,
          options,
          // An overflow accepts one confirm for the whole menu, and it costs no
          // stack level. Previously delete fired instantly with no way back.
          confirm: {
            title: { type: "plain_text", text: t("admin.confirm_title", lang) },
            text: { type: "mrkdwn", text: t("admin.confirm_text", lang) },
            confirm: { type: "plain_text", text: t("admin.confirm_yes", lang) },
            deny: { type: "plain_text", text: t("cancel.confirm_no", lang) },
            style: "danger",
          },
        },
      });
    }

    if (hasMore) {
      blocks.push(showMoreBlock(lang, "manage_holidays_more", shown, shown, total));
    }
  }

  return {
    type: "modal" as const,
    callback_id: "manage_holidays_list",
    private_metadata: JSON.stringify({ userId: selected?.id ?? null, userName: selected?.name ?? null, offset }),
    title: { type: "plain_text" as const, text: t("admin.manage_holidays", lang) },
    close: { type: "plain_text" as const, text: t("common.back", lang) },
    blocks,
  };
}
