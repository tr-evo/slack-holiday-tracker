import { t } from "../i18n/t.js";
import { BUNDESLAENDER } from "../services/publicHolidays.js";

export function buildImportHolidaysModal(lang: string) {
  const currentYear = new Date().getFullYear();
  const yearOptions = [currentYear, currentYear + 1].map((y) => ({
    text: { type: "plain_text" as const, text: String(y) },
    value: String(y),
  }));

  const bundeslandOptions = Object.entries(BUNDESLAENDER)
    .sort(([, a], [, b]) => a.localeCompare(b, "de"))
    .map(([code, name]) => ({
      text: { type: "plain_text" as const, text: name },
      value: code,
    }));

  return {
    type: "modal" as const,
    callback_id: "import_holidays_submit",
    title: { type: "plain_text" as const, text: t("admin.import_holidays", lang) },
    submit: { type: "plain_text" as const, text: t("admin.import_holidays_submit", lang) },
    close: { type: "plain_text" as const, text: "Back" },
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `_${t("admin.import_holidays_desc", lang)}_` },
      },
      {
        type: "input",
        block_id: "bundesland_block",
        element: {
          type: "static_select",
          action_id: "bundesland_select",
          placeholder: { type: "plain_text", text: t("admin.select_bundesland", lang) },
          options: bundeslandOptions,
        },
        label: { type: "plain_text", text: t("admin.bundesland", lang) },
      },
      {
        type: "input",
        block_id: "year_block",
        element: {
          type: "static_select",
          action_id: "year_select",
          options: yearOptions,
          initial_option: yearOptions[0],
        },
        label: { type: "plain_text", text: t("admin.year", lang) },
      },
    ],
  };
}
