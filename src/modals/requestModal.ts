import { t } from "../i18n/t.js";

export function buildRequestModal(lang: string, initialStartDate?: string) {
  const endDateElement: Record<string, any> = {
    type: "datepicker",
    action_id: "end_date",
  };

  // If a start date is provided, pre-fill the end date to at least that value
  if (initialStartDate) {
    endDateElement.initial_date = initialStartDate;
  }

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
        dispatch_action: true,
        element: {
          type: "datepicker",
          action_id: "start_date",
          placeholder: { type: "plain_text", text: t("request.start_date", lang) },
          ...(initialStartDate ? { initial_date: initialStartDate } : {}),
        },
        label: { type: "plain_text", text: t("request.start_date", lang) },
      },
      {
        type: "input",
        block_id: "end_date_block",
        element: endDateElement,
        label: { type: "plain_text", text: t("request.end_date", lang) },
        hint: { type: "plain_text", text: t("request.end_date_hint", lang) },
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
        hint: { type: "plain_text", text: t("request.half_day_hint", lang) },
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
