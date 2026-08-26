import { t } from "../i18n/t.js";
import { BUNDESLAENDER } from "../services/publicHolidays.js";
import type { HolidayRequest } from "../db/repositories/requestRepo.js";
import type { User } from "../db/repositories/userRepo.js";
import type { RequestContext } from "../services/balance.js";
import { formatRange } from "../services/dates.js";
import { contextBlocks } from "./reviewModal.js";
import { formatDays, paginate, showMoreBlock } from "./shared.js";

/*
 * The admin panel used to be one modal holding the Bundesland, the carryover
 * switch and cutoff, a per-person allowance, per-person carryover days, the
 * admin toggle and the pending queue — with a single Submit applying whatever
 * happened to be filled in. Picking someone in the "toggle admin" field and
 * saving an unrelated setting silently flipped their rights. Three views now,
 * each saving only its own thing.
 */

export interface PendingEntry {
  request: HolidayRequest;
  requesterName: string;
  context: RequestContext;
}

export function buildAdminApprovalsModal(lang: string, entries: PendingEntry[], offset = 0) {
  const blocks: any[] = [];

  if (entries.length === 0) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `_${t("admin.no_pending", lang)}_` } });
  } else {
    const { page, hasMore, shown, total } = paginate(entries, offset, 10);

    for (const { request: r, requesterName, context } of page) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${requesterName}*  ·  ${formatRange(r.startDate, r.endDate, lang)}  ·  ${t("common.days", lang, { days: formatDays(context.days, lang) })}${r.reason ? `\n> ${r.reason}` : ""}`,
        },
      });
      blocks.push(...contextBlocks(lang, context));
      blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            style: "primary",
            action_id: `review_approve_${r.id}`,
            value: String(r.id),
            text: { type: "plain_text", text: t("approval.approve", lang) },
          },
          {
            type: "button",
            style: "danger",
            action_id: `review_reject_${r.id}`,
            value: String(r.id),
            text: { type: "plain_text", text: t("approval.reject", lang) },
          },
        ],
      });
      blocks.push({ type: "divider" });
    }

    if (hasMore) blocks.push(showMoreBlock(lang, "admin_approvals_more", shown, shown, total));
  }

  return {
    type: "modal" as const,
    callback_id: "admin_approvals",
    private_metadata: JSON.stringify({ offset }),
    title: { type: "plain_text" as const, text: t("admin.approvals", lang) },
    close: { type: "plain_text" as const, text: t("common.back", lang) },
    blocks,
  };
}

export function buildAdminPeopleModal(lang: string, selected: User | null, carryoverEnabled: boolean) {
  const blocks: any[] = [
    {
      type: "input",
      block_id: "people_user_block",
      dispatch_action: true,
      element: {
        type: "external_select",
        action_id: "people_user_select",
        placeholder: { type: "plain_text", text: t("admin.select_user", lang) },
        min_query_length: 0,
        ...(selected
          ? { initial_option: { text: { type: "plain_text", text: selected.name }, value: selected.slackId } }
          : {}),
      },
      label: { type: "plain_text", text: t("admin.user", lang) },
    },
  ];

  if (!selected) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: t("admin.pick_user_hint", lang) }] });
    return peopleView(lang, blocks, false);
  }

  blocks.push({ type: "divider" });

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
      initial_value: String(selected.annualAllowance),
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
        initial_value: String(selected.carryoverDays),
      },
      label: { type: "plain_text", text: t("admin.carryover_days", lang) },
    });
  }

  // Explicit, separately-actioned, and it says what it will do
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: selected.isAdmin
        ? t("admin.is_admin", lang, { name: selected.name })
        : t("admin.is_not_admin", lang, { name: selected.name }),
    },
    accessory: {
      type: "button",
      action_id: "toggle_admin_rights",
      value: selected.slackId,
      ...(selected.isAdmin ? { style: "danger" } : {}),
      text: {
        type: "plain_text",
        text: selected.isAdmin ? t("admin.revoke_admin", lang) : t("admin.grant_admin", lang),
      },
      confirm: {
        title: { type: "plain_text", text: t("admin.confirm_title", lang) },
        text: {
          type: "mrkdwn",
          text: selected.isAdmin
            ? t("admin.revoke_admin_confirm", lang, { name: selected.name })
            : t("admin.grant_admin_confirm", lang, { name: selected.name }),
        },
        confirm: { type: "plain_text", text: t("admin.confirm_yes", lang) },
        deny: { type: "plain_text", text: t("cancel.confirm_no", lang) },
      },
    },
  });

  return peopleView(lang, blocks, true);
}

function peopleView(lang: string, blocks: any[], canSubmit: boolean) {
  return {
    type: "modal" as const,
    callback_id: "admin_people_submit",
    title: { type: "plain_text" as const, text: t("admin.people", lang) },
    ...(canSubmit ? { submit: { type: "plain_text" as const, text: t("admin.submit", lang) } } : {}),
    close: { type: "plain_text" as const, text: t("common.back", lang) },
    blocks,
  };
}

export function buildAdminSettingsModal(
  lang: string,
  settings: { bundesland: string; carryoverEnabled: boolean; carryoverCutoff: string }
) {
  const bundeslandOptions = Object.entries(BUNDESLAENDER)
    .sort(([, a], [, b]) => a.localeCompare(b, "de"))
    .map(([code, name]) => ({ text: { type: "plain_text" as const, text: name }, value: code }));
  const current = bundeslandOptions.find((o) => o.value === settings.bundesland);

  const blocks: any[] = [
    {
      type: "input",
      block_id: "bundesland_block",
      optional: true,
      element: {
        type: "static_select",
        action_id: "admin_bundesland",
        placeholder: { type: "plain_text", text: t("admin.select_bundesland", lang) },
        options: bundeslandOptions,
        ...(current ? { initial_option: current } : {}),
      },
      label: { type: "plain_text", text: t("admin.bundesland", lang) },
      hint: { type: "plain_text", text: t("admin.bundesland_hint", lang) },
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: settings.carryoverEnabled
          ? t("admin.carryover_status_on", lang, { cutoff: settings.carryoverCutoff })
          : t("admin.carryover_status_off", lang),
      },
      accessory: {
        type: "button",
        action_id: "toggle_carryover",
        text: {
          type: "plain_text",
          text: settings.carryoverEnabled ? t("admin.carryover_toggle_off", lang) : t("admin.carryover_toggle", lang),
        },
      },
    },
  ];

  if (settings.carryoverEnabled) {
    blocks.push({
      type: "input",
      block_id: "carryover_cutoff_block",
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: "carryover_cutoff",
        initial_value: settings.carryoverCutoff,
        placeholder: { type: "plain_text", text: "03-31" },
      },
      label: { type: "plain_text", text: t("admin.carryover_cutoff", lang) },
      hint: { type: "plain_text", text: t("admin.carryover_cutoff_hint", lang) },
    });
  }

  return {
    type: "modal" as const,
    callback_id: "admin_settings_submit",
    title: { type: "plain_text" as const, text: t("admin.settings", lang) },
    submit: { type: "plain_text" as const, text: t("admin.submit", lang) },
    close: { type: "plain_text" as const, text: t("common.back", lang) },
    blocks,
  };
}
