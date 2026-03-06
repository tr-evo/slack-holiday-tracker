import { t } from "../i18n/t.js";

export function buildRequestModal(lang: string) {
  return {
    type: "modal" as const,
    callback_id: "submit_holiday_request",
    title: { type: "plain_text" as const, text: t("request.title", lang) },
    submit: { type: "plain_text" as const, text: t("request.submit", lang) },
    close: { type: "plain_text" as const, text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "start_date_block",
        element: {
          type: "datepicker",
          action_id: "start_date",
          placeholder: { type: "plain_text", text: t("request.start_date", lang) },
        },
        label: { type: "plain_text", text: t("request.start_date", lang) },
      },
      {
        type: "input",
        block_id: "end_date_block",
        element: {
          type: "datepicker",
          action_id: "end_date",
        },
        label: { type: "plain_text", text: t("request.end_date", lang) },
      },
      {
        type: "input",
        block_id: "half_days_block",
        optional: true,
        element: {
          type: "checkboxes",
          action_id: "half_days",
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
        block_id: "reason_block",
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "reason",
          multiline: true,
          placeholder: { type: "plain_text", text: t("request.reason", lang) },
        },
        label: { type: "plain_text", text: t("request.reason", lang) },
      },
    ],
  };
}
