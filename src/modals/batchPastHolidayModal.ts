import { t } from "../i18n/t.js";
import { formatRange } from "../services/dates.js";
import type { ParsedDateRange } from "../services/batchParser.js";
import { formatDays } from "./shared.js";

export function buildUserNachtragenModal(lang: string) {
  return {
    type: "modal" as const,
    callback_id: "user_nachtragen_submit",
    title: { type: "plain_text" as const, text: t("menu.add_past", lang) },
    submit: { type: "plain_text" as const, text: t("request.submit", lang) },
    close: { type: "plain_text" as const, text: t("common.back", lang) },
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
        hint: { type: "plain_text", text: t("admin.batch_dates_hint", lang) },
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
    close: { type: "plain_text" as const, text: t("common.back", lang) },
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
          placeholder: { type: "plain_text", text: t("admin.select_user", lang) },
          min_query_length: 0,
        },
        label: { type: "plain_text", text: t("admin.user", lang) },
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
        hint: { type: "plain_text", text: t("admin.batch_dates_hint", lang) },
      },
    ],
  };
}

export interface PreviewEntry {
  range: ParsedDateRange;
  days: number;
}

export function buildNachtragenPreviewModal(
  lang: string,
  entries: PreviewEntry[],
  callbackId: string,
  privateMetadata: string
) {
  const totalDays = entries.reduce((sum, e) => sum + e.days, 0);
  const lines = entries.map(
    (e) => `• ${formatRange(e.range.startDate, e.range.endDate, lang)}  —  *${formatDays(e.days, lang)}* ${t("nachtragen.days_unit", lang)}`
  );
  return {
    type: "modal" as const,
    callback_id: callbackId,
    private_metadata: privateMetadata,
    title: { type: "plain_text" as const, text: t("nachtragen.preview_title", lang) },
    submit: { type: "plain_text" as const, text: t("nachtragen.confirm", lang) },
    close: { type: "plain_text" as const, text: t("common.back", lang) },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${t("nachtragen.preview_count", lang, { count: String(entries.length) })}*\n\n${lines.join("\n")}\n\n*${t("nachtragen.preview_total", lang, { days: formatDays(totalDays, lang) })}*`,
        },
      },
    ],
  };
}
