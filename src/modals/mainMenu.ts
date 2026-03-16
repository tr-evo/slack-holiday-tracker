import { t } from "../i18n/t.js";

export function buildMainMenuModal(lang: string, isAdmin: boolean) {
  const blocks: any[] = [
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: t("menu.request", lang) },
          action_id: "open_request_modal",
          style: "primary",
        },
        {
          type: "button",
          text: { type: "plain_text", text: t("menu.balance", lang) },
          action_id: "show_balance",
        },
        {
          type: "button",
          text: { type: "plain_text", text: t("menu.list", lang) },
          action_id: "show_list",
        },
        {
          type: "button",
          text: { type: "plain_text", text: t("menu.holidays", lang) },
          action_id: "show_holidays",
        },
        {
          type: "button",
          text: { type: "plain_text", text: t("menu.add_past", lang) },
          action_id: "open_nachtragen_modal",
        },
      ],
    },
  ];

  if (isAdmin) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: t("menu.admin", lang) },
          action_id: "open_admin_panel",
        },
      ],
    });
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: lang === "en" ? "Auf Deutsch wechseln" : "Switch to English" },
        action_id: "toggle_language",
      },
    ],
  });

  return {
    type: "modal" as const,
    title: { type: "plain_text" as const, text: t("menu.title", lang) },
    close: { type: "plain_text" as const, text: "Close" },
    blocks,
  };
}
