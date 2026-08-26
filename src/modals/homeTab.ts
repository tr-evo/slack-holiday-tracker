import { t } from "../i18n/t.js";
import { formatRange } from "../services/dates.js";
import type { HolidayRequest } from "../db/repositories/requestRepo.js";
import type { BalanceSnapshot } from "../services/balance.js";
import { canUserCancel } from "../services/cancellation.js";
import { balanceBlocks, confirmCancel, describeRequest, statusLabel } from "./shared.js";

export interface HomeRequestEntry {
  request: HolidayRequest;
  days: number;
}

export interface TeamAbsence {
  userId: string;
  startDate: string;
  endDate: string;
}

export interface HomeTabData {
  snapshot: BalanceSnapshot;
  requests: HomeRequestEntry[];
  team: TeamAbsence[];
  isAdmin: boolean;
  pendingCount: number;
  today: string;
}

const MAX_OWN_ROWS = 6;
const MAX_TEAM_ROWS = 8;

/**
 * The App Home tab: the whole app at rest, with nothing typed.
 *
 * Everything here was previously four interactions deep behind a remembered
 * slash command and a modal stack that vanished on close.
 */
export function buildHomeTab(lang: string, data: HomeTabData) {
  const { snapshot, requests, team, isAdmin, pendingCount, today } = data;
  const blocks: any[] = [];

  blocks.push({
    type: "header",
    text: { type: "plain_text", text: `${t("balance.title", lang)} ${snapshot.year}` },
  });

  blocks.push(...balanceBlocks(snapshot, lang));

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        style: "primary",
        action_id: "open_request_modal",
        text: { type: "plain_text", text: t("menu.request", lang) },
      },
      {
        type: "button",
        action_id: "show_holidays",
        text: { type: "plain_text", text: t("menu.holidays", lang) },
      },
      {
        type: "button",
        action_id: "open_nachtragen_modal",
        text: { type: "plain_text", text: t("menu.add_past", lang) },
      },
      {
        type: "button",
        action_id: "toggle_language",
        text: { type: "plain_text", text: lang === "en" ? "Auf Deutsch" : "In English" },
      },
    ],
  });

  // --- Your requests -------------------------------------------------------
  blocks.push({ type: "divider" });
  blocks.push({ type: "header", text: { type: "plain_text", text: t("list.title", lang) } });

  if (requests.length === 0) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: t("list.empty", lang) }] });
  } else {
    for (const { request: r, days } of requests.slice(0, MAX_OWN_ROWS)) {
      const section: any = {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${describeRequest(r, days, lang)}\n${statusLabel(r.status, lang)}${r.reason ? `  ·  _${r.reason}_` : ""}`,
        },
      };

      if (canUserCancel(r, today).allowed) {
        section.accessory = {
          type: "button",
          action_id: `cancel_request_${r.id}`,
          style: "danger",
          text: { type: "plain_text", text: t("cancel.button", lang) },
          value: String(r.id),
          confirm: confirmCancel(lang, r, days),
        };
      }
      blocks.push(section);
    }

    if (requests.length > MAX_OWN_ROWS) {
      blocks.push({
        type: "actions",
        elements: [{
          type: "button",
          action_id: "show_list",
          text: { type: "plain_text", text: t("home.all_requests", lang, { count: String(requests.length) }) },
        }],
      });
    }
  }

  // --- Who else is off -----------------------------------------------------
  blocks.push({ type: "divider" });
  blocks.push({ type: "header", text: { type: "plain_text", text: t("home.team_header", lang) } });

  if (team.length === 0) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: t("home.team_empty", lang) }] });
  } else {
    for (const a of team.slice(0, MAX_TEAM_ROWS)) {
      const now = a.startDate <= today && a.endDate >= today;
      blocks.push({
        type: "context",
        elements: [{
          type: "mrkdwn",
          text: `${now ? ":palm_tree: " : ""}<@${a.userId}>  ·  ${formatRange(a.startDate, a.endDate, lang)}`,
        }],
      });
    }
  }

  // --- Admin ---------------------------------------------------------------
  if (isAdmin) {
    blocks.push({ type: "divider" });
    blocks.push({ type: "header", text: { type: "plain_text", text: t("menu.admin", lang) } });

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: pendingCount > 0
          ? `:hourglass_flowing_sand: *${t("admin.pending_count", lang, { count: String(pendingCount) })}*`
          : `_${t("admin.no_pending", lang)}_`,
      },
    });

    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          ...(pendingCount > 0 ? { style: "primary" } : {}),
          action_id: "open_admin_approvals",
          text: { type: "plain_text", text: t("admin.approvals", lang) },
        },
        { type: "button", action_id: "open_admin_people", text: { type: "plain_text", text: t("admin.people", lang) } },
        { type: "button", action_id: "open_admin_settings", text: { type: "plain_text", text: t("admin.settings", lang) } },
        { type: "button", action_id: "open_overview", text: { type: "plain_text", text: t("overview.title", lang) } },
        { type: "button", action_id: "open_manage_holidays", text: { type: "plain_text", text: t("admin.manage_holidays", lang) } },
        { type: "button", action_id: "open_batch_past_holiday", text: { type: "plain_text", text: t("admin.batch_past_holiday", lang) } },
      ],
    });
  }

  return { type: "home" as const, blocks };
}
