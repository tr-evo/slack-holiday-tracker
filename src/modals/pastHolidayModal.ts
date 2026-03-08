import { t } from "../i18n/t.js";

export function buildPastHolidayModal(lang: string) {
  return {
    type: "modal" as const,
    callback_id: "past_holiday_submit",
    title: { type: "plain_text" as const, text: t("admin.add_past_holiday", lang) },
    submit: { type: "plain_text" as const, text: t("request.submit", lang) },
    close: { type: "plain_text" as const, text: "Back" },
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `_${t("admin.add_past_holiday_desc", lang)}_` },
      },
      {
        type: "input",
        block_id: "past_user_block",
        element: {
          type: "external_select",
          action_id: "past_user_select",
          placeholder: { type: "plain_text", text: "Select a user" },
          min_query_length: 0,
        },
        label: { type: "plain_text", text: "User" },
      },
      {
        type: "input",
        block_id: "past_start_block",
        element: {
          type: "datepicker",
          action_id: "past_start_date",
          placeholder: { type: "plain_text", text: t("request.start_date", lang) },
        },
        label: { type: "plain_text", text: t("request.start_date", lang) },
      },
      {
        type: "input",
        block_id: "past_end_block",
        element: {
          type: "datepicker",
          action_id: "past_end_date",
        },
        label: { type: "plain_text", text: t("request.end_date", lang) },
      },
      {
        type: "input",
        block_id: "past_half_days_block",
        optional: true,
        element: {
          type: "checkboxes",
          action_id: "past_half_days",
          options: [
            {
              text: { type: "plain_text", text: t("request.half_day_start", lang) },
              value: "half_day_start",
            },
            {
              text: { type: "plain_text", text: t("request.half_day_end", lang) },
              value: "half_day_end",
            },
          ],
        },
        label: { type: "plain_text", text: t("request.half_day_start", lang).split(" (")[0] },
      },
      {
        type: "input",
        block_id: "past_reason_block",
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "past_reason",
          multiline: true,
          placeholder: { type: "plain_text", text: t("request.reason", lang) },
        },
        label: { type: "plain_text", text: t("request.reason", lang) },
      },
    ],
  };
}
