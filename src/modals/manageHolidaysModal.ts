import { t } from "../i18n/t.js";
import type { HolidayRequest } from "../db/repositories/requestRepo.js";

export function buildManageHolidaysPickerModal(lang: string) {
  return {
    type: "modal" as const,
    callback_id: "manage_holidays_pick_user",
    title: { type: "plain_text" as const, text: t("admin.manage_holidays", lang) },
    submit: { type: "plain_text" as const, text: t("admin.submit", lang) },
    close: { type: "plain_text" as const, text: "Back" },
    blocks: [
      {
        type: "input",
        block_id: "manage_user_block",
        element: {
          type: "external_select",
          action_id: "manage_user_select",
          placeholder: { type: "plain_text", text: "Select a user" },
          min_query_length: 0,
        },
        label: { type: "plain_text", text: "User" },
      },
    ],
  };
}

export function buildHolidayListModal(lang: string, userId: string, holidays: HolidayRequest[]) {
  const blocks: any[] = [];

  if (holidays.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `_${t("list.empty", lang)}_` },
    });
  } else {
    for (const h of holidays) {
      const status = t(`list.status.${h.status}`, lang);
      const halfInfo = [
        h.halfDayStart ? `(${t("request.half_day_start", lang)})` : "",
        h.halfDayEnd ? `(${t("request.half_day_end", lang)})` : "",
      ].filter(Boolean).join(" ");

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${h.startDate} → ${h.endDate} ${halfInfo}\n*${status}*${h.reason ? `\n> ${h.reason}` : ""}`,
        },
        accessory: {
          type: "overflow",
          action_id: `manage_holiday_action_${h.id}`,
          options: [
            {
              text: { type: "plain_text", text: t("admin.delete_holiday", lang) },
              value: `delete_${h.id}`,
            },
          ],
        },
      });
    }
  }

  return {
    type: "modal" as const,
    callback_id: "manage_holidays_list",
    private_metadata: userId,
    title: { type: "plain_text" as const, text: t("admin.manage_holidays", lang) },
    close: { type: "plain_text" as const, text: "Back" },
    blocks,
  };
}
