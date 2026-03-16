import { t } from "../i18n/t.js";

export function buildUserNachtragenModal(lang: string) {
  return {
    type: "modal" as const,
    callback_id: "user_nachtragen_submit",
    title: { type: "plain_text" as const, text: t("menu.add_past", lang) },
    submit: { type: "plain_text" as const, text: t("request.submit", lang) },
    close: { type: "plain_text" as const, text: "Back" },
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `_${t("nachtragen.desc", lang)}_` },
      },
      {
        type: "input",
        block_id: "batch_dates_block",
        element: {
          type: "plain_text_input",
          action_id: "batch_dates",
          multiline: true,
          placeholder: { type: "plain_text", text: t("admin.batch_dates_placeholder", lang) },
        },
        label: { type: "plain_text", text: t("admin.batch_dates", lang) },
      },
    ],
  };
}

export function buildBatchPastHolidayModal(lang: string) {
  return {
    type: "modal" as const,
    callback_id: "batch_past_holiday_submit",
    title: { type: "plain_text" as const, text: t("admin.batch_past_holiday", lang) },
    submit: { type: "plain_text" as const, text: t("request.submit", lang) },
    close: { type: "plain_text" as const, text: "Back" },
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `_${t("admin.batch_past_holiday_desc", lang)}_` },
      },
      {
        type: "input",
        block_id: "batch_user_block",
        element: {
          type: "external_select",
          action_id: "batch_user_select",
          placeholder: { type: "plain_text", text: "Select a user" },
          min_query_length: 0,
        },
        label: { type: "plain_text", text: "User" },
      },
      {
        type: "input",
        block_id: "batch_dates_block",
        element: {
          type: "plain_text_input",
          action_id: "batch_dates",
          multiline: true,
          placeholder: { type: "plain_text", text: t("admin.batch_dates_placeholder", lang) },
        },
        label: { type: "plain_text", text: t("admin.batch_dates", lang) },
      },
    ],
  };
}

export interface ParsedDateRange {
  startDate: string;
  endDate: string;
}

/**
 * Parse multiline text into date ranges.
 * Each line should be in the format: YYYY-MM-DD to YYYY-MM-DD
 */
export function parseDateRanges(text: string): { ranges: ParsedDateRange[]; errors: string[] } {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const ranges: ParsedDateRange[] = [];
  const errors: string[] = [];

  const datePattern = /^(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})$/;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(datePattern);
    if (!match) {
      errors.push(String(i + 1));
      continue;
    }
    const [, startDate, endDate] = match;
    if (endDate < startDate) {
      errors.push(String(i + 1));
      continue;
    }
    ranges.push({ startDate, endDate });
  }

  return { ranges, errors };
}
