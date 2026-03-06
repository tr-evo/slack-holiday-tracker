import { t } from "../i18n/t.js";
import type { HolidayRequest } from "../db/repositories/requestRepo.js";

export function buildAdminPanelModal(lang: string, pendingRequests: HolidayRequest[]) {
  const blocks: any[] = [];

  // Pending requests section
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: t("admin.pending_requests", lang) },
  });

  if (pendingRequests.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No pending requests_" },
    });
  } else {
    for (const req of pendingRequests) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `<@${req.userId}> — ${req.startDate} → ${req.endDate}${req.reason ? `\n> ${req.reason}` : ""}`,
        },
        accessory: {
          type: "overflow",
          action_id: `admin_request_action_${req.id}`,
          options: [
            { text: { type: "plain_text", text: t("approval.approve", lang) }, value: `approve_${req.id}` },
            { text: { type: "plain_text", text: t("approval.reject", lang) }, value: `reject_${req.id}` },
          ],
        },
      });
    }
  }

  blocks.push({ type: "divider" });

  // User management section
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: t("admin.set_allowance", lang) },
  });

  blocks.push({
    type: "input",
    block_id: "user_select_block",
    element: {
      type: "users_select",
      action_id: "admin_user_select",
      placeholder: { type: "plain_text", text: "Select a user" },
    },
    label: { type: "plain_text", text: "User" },
  });

  blocks.push({
    type: "input",
    block_id: "allowance_block",
    element: {
      type: "number_input",
      action_id: "admin_allowance",
      is_decimal_allowed: false,
      min_value: "0",
      max_value: "365",
      placeholder: { type: "plain_text", text: "30" },
    },
    label: { type: "plain_text", text: t("admin.set_allowance", lang) },
  });

  blocks.push({ type: "divider" });

  // Toggle admin section
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: t("admin.toggle_admin", lang) },
  });

  blocks.push({
    type: "input",
    block_id: "admin_toggle_user_block",
    element: {
      type: "users_select",
      action_id: "admin_toggle_user_select",
      placeholder: { type: "plain_text", text: "Select a user" },
    },
    label: { type: "plain_text", text: "User" },
  });

  return {
    type: "modal" as const,
    callback_id: "admin_panel_submit",
    title: { type: "plain_text" as const, text: t("admin.title", lang) },
    submit: { type: "plain_text" as const, text: t("admin.set_allowance", lang) },
    close: { type: "plain_text" as const, text: "Back" },
    blocks,
  };
}
