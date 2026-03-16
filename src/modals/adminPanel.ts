import { t } from "../i18n/t.js";
import type { HolidayRequest } from "../db/repositories/requestRepo.js";

interface CarryoverSettings {
  enabled: boolean;
  cutoff: string;
}

export function buildAdminPanelModal(lang: string, pendingRequests: HolidayRequest[], carryover?: CarryoverSettings) {
  const blocks: any[] = [];

  // Pending requests section
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: t("admin.pending_requests", lang) },
  });

  if (pendingRequests.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `_${t("admin.no_pending", lang)}_` },
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

  // Action buttons
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: t("admin.batch_past_holiday", lang) },
        action_id: "open_batch_past_holiday",
      },
      {
        type: "button",
        text: { type: "plain_text", text: t("admin.import_holidays", lang) },
        action_id: "open_import_holidays",
      },
    ],
  });

  blocks.push({ type: "divider" });

  // Carryover section
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: t("admin.carryover_section", lang) },
  });

  const carryoverEnabled = carryover?.enabled ?? false;
  const carryoverCutoff = carryover?.cutoff ?? "03-31";
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: carryoverEnabled
        ? t("admin.carryover_status_on", lang, { cutoff: carryoverCutoff })
        : t("admin.carryover_status_off", lang),
    },
    accessory: {
      type: "button",
      text: {
        type: "plain_text",
        text: carryoverEnabled
          ? t("admin.carryover_toggle_off", lang)
          : t("admin.carryover_toggle", lang),
      },
      action_id: "toggle_carryover",
    },
  });

  if (carryoverEnabled) {
    blocks.push({
      type: "input",
      block_id: "carryover_cutoff_block",
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: "carryover_cutoff",
        initial_value: carryoverCutoff,
        placeholder: { type: "plain_text", text: "03-31" },
      },
      label: { type: "plain_text", text: t("admin.carryover_cutoff", lang) },
    });
  }

  blocks.push({ type: "divider" });

  // User management section — set allowance & carryover days
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: t("admin.set_allowance", lang) },
  });

  blocks.push({
    type: "input",
    block_id: "user_select_block",
    optional: true,
    element: {
      type: "external_select",
      action_id: "admin_user_select",
      placeholder: { type: "plain_text", text: "Select a user" },
      min_query_length: 0,
    },
    label: { type: "plain_text", text: "User" },
  });

  blocks.push({
    type: "input",
    block_id: "allowance_block",
    optional: true,
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

  if (carryoverEnabled) {
    blocks.push({
      type: "input",
      block_id: "carryover_days_block",
      optional: true,
      element: {
        type: "number_input",
        action_id: "admin_carryover_days",
        is_decimal_allowed: false,
        min_value: "0",
        max_value: "365",
        placeholder: { type: "plain_text", text: "0" },
      },
      label: { type: "plain_text", text: t("admin.carryover_days", lang) },
    });
  }

  blocks.push({ type: "divider" });

  // Toggle admin section
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: t("admin.toggle_admin", lang) },
  });

  blocks.push({
    type: "input",
    block_id: "admin_toggle_user_block",
    optional: true,
    element: {
      type: "external_select",
      action_id: "admin_toggle_user_select",
      placeholder: { type: "plain_text", text: "Select a user" },
      min_query_length: 0,
    },
    label: { type: "plain_text", text: "User" },
  });

  return {
    type: "modal" as const,
    callback_id: "admin_panel_submit",
    title: { type: "plain_text" as const, text: t("admin.title", lang) },
    submit: { type: "plain_text" as const, text: t("admin.submit", lang) },
    close: { type: "plain_text" as const, text: "Back" },
    blocks,
  };
}
