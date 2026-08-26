import { describe, it, expect } from "vitest";
import { registerActionHandlers } from "../actions.js";
import { registerAdminHandlers } from "../admin.js";
import { registerSubmissionHandlers } from "../submissions.js";
import { registerHolidayHandlers } from "../holiday.js";
import { registerHomeHandlers } from "../views.js";

import { buildHomeTab } from "../../modals/homeTab.js";
import { buildMainMenuModal } from "../../modals/mainMenu.js";
import { buildRequestModal, EMPTY_DRAFT } from "../../modals/requestModal.js";
import { buildMyHolidaysModal } from "../../modals/myHolidaysModal.js";
import { buildManageHolidaysModal } from "../../modals/manageHolidaysModal.js";
import { buildOverviewModal } from "../../modals/overviewModal.js";
import { buildReviewModal } from "../../modals/reviewModal.js";
import {
  buildAdminApprovalsModal,
  buildAdminPeopleModal,
  buildAdminSettingsModal,
} from "../../modals/adminModals.js";
import { buildUserNachtragenModal, buildBatchPastHolidayModal, buildNachtragenPreviewModal } from "../../modals/batchPastHolidayModal.js";
import type { HolidayRequest } from "../../db/repositories/requestRepo.js";
import type { User } from "../../db/repositories/userRepo.js";
import type { BalanceSnapshot, RequestContext } from "../../services/balance.js";

interface Registry {
  actions: (string | RegExp)[];
  views: string[];
  options: string[];
  commands: string[];
  events: string[];
}

function collectRegistrations(): Registry {
  const reg: Registry = { actions: [], views: [], options: [], commands: [], events: [] };
  const app: any = {
    action: (id: any) => reg.actions.push(id),
    view: (id: any) => reg.views.push(id),
    options: (id: any) => reg.options.push(id),
    command: (id: any) => reg.commands.push(id),
    event: (id: any) => reg.events.push(id),
  };
  registerHolidayHandlers(app);
  registerActionHandlers(app);
  registerSubmissionHandlers(app);
  registerAdminHandlers(app);
  registerHomeHandlers(app);
  return reg;
}

const handles = (reg: Registry, id: string) =>
  reg.actions.some((a) => (typeof a === "string" ? a === id : a.test(id)));

// ---------------------------------------------------------------- fixtures
const request: HolidayRequest = {
  id: 7, userId: "U123", startDate: "2026-03-19", endDate: "2026-03-22",
  halfDayStart: false, halfDayEnd: false, status: "pending",
  approvedBy: null, reason: "Familienbesuch", reviewerComment: null,
  createdAt: "2026-01-01 00:00:00",
};
const user: User = {
  slackId: "U123", name: "Anna", annualAllowance: 30, carryoverDays: 3,
  language: "de", isAdmin: true,
};
const snapshot: BalanceSnapshot = {
  year: 2026, allowance: 30, carryover: 3, grantedCarryover: 3, carryoverEnabled: true,
  carryoverCutoff: "03-31", budget: 33, used: 17.5, remaining: 15.5,
  usedFromCarryover: 3, usedFromAllowance: 14.5, carryoverUnused: 0,
  approved: [], publicHolidays: [], requestSources: new Map(),
};
const context: RequestContext = { days: 4, remainingBefore: 12, remainingAfter: 8, overlaps: [] };

/** Every view the app can render, in both languages. */
function allViews() {
  const views: any[] = [];
  for (const lang of ["en", "de"]) {
    const entries = [{ request, days: 4 }, { request: { ...request, id: 8, status: "approved" }, days: 2 }];
    views.push(
      buildHomeTab(lang, { snapshot, requests: entries, team: [], isAdmin: true, pendingCount: 3, today: "2026-01-01" }),
      buildMainMenuModal(lang, true),
      buildRequestModal(lang, EMPTY_DRAFT),
      buildRequestModal(lang, { startDate: "2026-03-19", endDate: "2026-03-19", halfDayStart: true, halfDayEnd: false }),
      buildMyHolidaysModal(lang, entries.map((e) => ({ ...e })), "2026-01-01"),
      buildMyHolidaysModal(lang, Array.from({ length: 60 }, () => ({ request, days: 4 })), "2026-01-01"),
      buildManageHolidaysModal(lang, { id: "U123", name: "Anna" }, entries),
      buildManageHolidaysModal(lang, null, []),
      buildOverviewModal(lang, [{ user, used: 5, remaining: 25, carryover: 0 }], [{ request, days: 4 }], "2026-01-01", true),
      buildOverviewModal(lang, [], Array.from({ length: 60 }, () => ({ request, days: 4 })), "2026-01-01", false),
      buildReviewModal(lang, "reject", request, "Anna", context),
      buildAdminApprovalsModal(lang, [{ request, requesterName: "Anna", context }]),
      buildAdminApprovalsModal(lang, Array.from({ length: 30 }, () => ({ request, requesterName: "A", context }))),
      buildAdminPeopleModal(lang, user, true),
      buildAdminPeopleModal(lang, null, true),
      buildAdminSettingsModal(lang, { bundesland: "BE", carryoverEnabled: true, carryoverCutoff: "03-31" }),
      buildUserNachtragenModal(lang),
      buildBatchPastHolidayModal(lang),
      buildNachtragenPreviewModal(lang, [{ range: { startDate: "2026-01-01", endDate: "2026-01-02" }, days: 2 }], "user_nachtragen_confirm", "{}")
    );
  }
  return views;
}

/** Elements that actually emit a block_actions payload when touched. */
function interactiveActionIds(view: any): string[] {
  const found: string[] = [];

  const visit = (node: any, dispatching: boolean) => {
    if (Array.isArray(node)) return node.forEach((n) => visit(n, dispatching));
    if (!node || typeof node !== "object") return;

    const isInputBlock = node.type === "input";
    const dispatches = isInputBlock ? node.dispatch_action === true : dispatching;

    if (node.action_id) {
      const alwaysInteractive = node.type === "button" || node.type === "overflow";
      if (alwaysInteractive || dispatches) found.push(node.action_id);
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === "action_id") continue;
      visit(value, dispatches);
    }
  };

  visit(view.blocks, false);
  return found;
}

function externalSelectActionIds(view: any): string[] {
  const found: string[] = [];
  const visit = (node: any) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    if (node.type === "external_select" && node.action_id) found.push(node.action_id);
    Object.values(node).forEach(visit);
  };
  visit(view.blocks);
  return found;
}

describe("handler registration", () => {
  const reg = collectRegistrations();

  it("registers the slash command and the home event", () => {
    expect(reg.commands).toEqual(["/holiday"]);
    expect(reg.events).toContain("app_home_opened");
  });

  it("registers no action id twice", () => {
    const strings = reg.actions.filter((a): a is string => typeof a === "string");
    expect(strings).toEqual([...new Set(strings)]);
  });

  it("has a handler for every interactive element it renders", () => {
    const unhandled = new Set<string>();
    for (const view of allViews()) {
      for (const id of interactiveActionIds(view)) {
        if (!handles(reg, id)) unhandled.add(id);
      }
    }
    expect([...unhandled], `dead controls: ${[...unhandled].join(", ")}`).toEqual([]);
  });

  it("has an options handler for every external select it renders", () => {
    const missing = new Set<string>();
    for (const view of allViews()) {
      for (const id of externalSelectActionIds(view)) {
        if (!reg.options.includes(id)) missing.add(id);
      }
    }
    expect([...missing], `pickers with no options handler: ${[...missing].join(", ")}`).toEqual([]);
  });

  it("has a submit handler for every view that can be submitted", () => {
    const missing = new Set<string>();
    for (const view of allViews()) {
      if (view.submit && view.callback_id && !reg.views.includes(view.callback_id)) {
        missing.add(view.callback_id);
      }
    }
    expect([...missing], `unsubmittable views: ${[...missing].join(", ")}`).toEqual([]);
  });

  it("registers the two-step confirm callbacks the push flows depend on", () => {
    expect(reg.views).toEqual(expect.arrayContaining(["user_nachtragen_confirm", "batch_past_holiday_confirm"]));
  });
});
