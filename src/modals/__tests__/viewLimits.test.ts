import { describe, it, expect } from "vitest";
import { buildMyHolidaysModal, type MyHolidayEntry } from "../myHolidaysModal.js";
import { buildManageHolidaysModal, type ManageEntry } from "../manageHolidaysModal.js";
import { buildOverviewModal } from "../overviewModal.js";
import { buildHomeTab } from "../homeTab.js";
import { buildAdminApprovalsModal, buildAdminPeopleModal, buildAdminSettingsModal } from "../adminModals.js";
import { buildRequestModal, EMPTY_DRAFT } from "../requestModal.js";
import { buildReviewModal } from "../reviewModal.js";
import { buildMainMenuModal } from "../mainMenu.js";
import type { HolidayRequest } from "../../db/repositories/requestRepo.js";
import type { User } from "../../db/repositories/userRepo.js";
import type { BalanceSnapshot, RequestContext } from "../../services/balance.js";

// https://docs.slack.dev/reference/views — a view over 100 blocks is rejected
// outright, which is how an unbounded list silently stops rendering.
const MAX_BLOCKS = 100;
const MAX_TITLE = 24;
const MAX_PLAIN_TEXT = 75;

function request(id: number, over: Partial<HolidayRequest> = {}): HolidayRequest {
  return {
    id,
    userId: "U123",
    startDate: "2026-03-19",
    endDate: "2026-03-22",
    halfDayStart: false,
    halfDayEnd: false,
    status: "approved",
    approvedBy: "UADMIN",
    reason: "Familienbesuch",
    reviewerComment: null,
    createdAt: "2026-01-01 00:00:00",
    ...over,
  };
}

function user(id: string, over: Partial<User> = {}): User {
  return {
    slackId: id,
    name: `Person ${id}`,
    annualAllowance: 30,
    carryoverDays: 3,
    language: "de",
    isAdmin: false,
    ...over,
  };
}

const snapshot: BalanceSnapshot = {
  year: 2026, allowance: 30, carryover: 3, grantedCarryover: 3,
  carryoverEnabled: true, carryoverCutoff: "03-31", budget: 33,
  used: 17.5, remaining: 15.5, usedFromCarryover: 3, usedFromAllowance: 14.5,
  carryoverUnused: 0, approved: [], publicHolidays: [], requestSources: new Map(),
};

const context: RequestContext = {
  days: 4,
  remainingBefore: 12.5,
  remainingAfter: 8.5,
  overlaps: [{ userId: "U999", startDate: "2026-03-20", endDate: "2026-03-21" }],
};

const PLACEHOLDERS = /\{(?:days|start|end|range|name|count|who|after|before|shown|total|names|comment|cutoff|date|line|user|remaining|requested)\}/g;

/** Walk a view and assert every documented Slack limit we can check offline. */
function assertValidView(view: any, label: string) {
  expect(Array.isArray(view.blocks), `${label}: blocks must be an array`).toBe(true);
  expect(view.blocks.length, `${label}: ${view.blocks.length} blocks`).toBeLessThanOrEqual(MAX_BLOCKS);

  if (view.title) {
    expect(view.title.text.length, `${label}: title "${view.title.text}"`).toBeLessThanOrEqual(MAX_TITLE);
  }
  for (const field of ["submit", "close"] as const) {
    if (view[field]) expect(view[field].text.length, `${label}: ${field}`).toBeLessThanOrEqual(MAX_PLAIN_TEXT);
  }

  const leftovers = JSON.stringify(view).match(PLACEHOLDERS);
  expect(leftovers, `${label}: unresolved placeholders ${leftovers?.join(", ")}`).toBeNull();

  walk(view.blocks, label);
}

function walk(node: any, label: string) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, label));
  if (!node || typeof node !== "object") return;

  if (node.type === "plain_text" && typeof node.text === "string") {
    expect(node.text.length, `${label}: plain_text "${node.text.slice(0, 40)}"`).toBeLessThanOrEqual(3000);
  }
  if (node.type === "overflow") expect(node.options.length, `${label}: overflow options`).toBeLessThanOrEqual(5);
  if (node.type === "actions") expect(node.elements.length, `${label}: actions elements`).toBeLessThanOrEqual(25);
  if (node.type === "section" && node.fields) expect(node.fields.length, `${label}: section fields`).toBeLessThanOrEqual(10);

  for (const value of Object.values(node)) walk(value, label);
}

describe("view limits", () => {
  // 400 is far past anything the old unbounded builders could survive
  const many: MyHolidayEntry[] = Array.from({ length: 400 }, (_, i) =>
    ({ request: request(i + 1, { status: i % 3 === 0 ? "pending" : "approved" }), days: 4, source: "allowance" as const })
  );

  for (const lang of ["en", "de"]) {
    it(`my holidays stays within limits with 400 requests (${lang})`, () => {
      assertValidView(buildMyHolidaysModal(lang, many, "2026-08-26"), `myHolidays/${lang}`);
      assertValidView(buildMyHolidaysModal(lang, many, "2026-08-26", 380), `myHolidays page 2/${lang}`);
    });

    it(`manage holidays stays within limits with 400 requests (${lang})`, () => {
      const entries: ManageEntry[] = many.map((m) => ({ request: m.request, days: m.days }));
      assertValidView(buildManageHolidaysModal(lang, { id: "U123", name: "Anna Beispiel" }, entries), `manage/${lang}`);
      assertValidView(buildManageHolidaysModal(lang, null, []), `manage empty/${lang}`);
    });

    it(`team overview stays within limits with 200 people away (${lang})`, () => {
      const upcoming = Array.from({ length: 200 }, (_, i) => ({ request: request(i, { userId: `U${i}` }), days: 4 }));
      const balances = Array.from({ length: 200 }, (_, i) => ({
        user: user(`U${i}`), used: i % 30, remaining: 30 - (i % 30), carryover: 0,
      }));
      assertValidView(buildOverviewModal(lang, balances, upcoming, "2026-08-26", true), `overview/${lang}`);
      assertValidView(buildOverviewModal(lang, [], upcoming, "2026-08-26", false), `overview non-admin/${lang}`);
    });

    it(`home tab stays within limits with a long history (${lang})`, () => {
      const team = Array.from({ length: 100 }, (_, i) => ({
        userId: `U${i}`, startDate: "2026-09-01", endDate: "2026-09-05",
      }));
      assertValidView(
        buildHomeTab(lang, { snapshot, requests: many, team, isAdmin: true, pendingCount: 12, today: "2026-08-26" }),
        `home admin/${lang}`
      );
      assertValidView(
        buildHomeTab(lang, { snapshot, requests: [], team: [], isAdmin: false, pendingCount: 0, today: "2026-08-26" }),
        `home empty/${lang}`
      );
    });

    it(`admin views stay within limits with 200 pending (${lang})`, () => {
      const pending = Array.from({ length: 200 }, (_, i) => ({
        request: request(i, { status: "pending" }), requesterName: `Person ${i}`, context,
      }));
      assertValidView(buildAdminApprovalsModal(lang, pending), `approvals/${lang}`);
      assertValidView(buildAdminApprovalsModal(lang, []), `approvals empty/${lang}`);
      assertValidView(buildAdminPeopleModal(lang, user("U1", { isAdmin: true }), true), `people/${lang}`);
      assertValidView(buildAdminPeopleModal(lang, null, false), `people empty/${lang}`);
      assertValidView(
        buildAdminSettingsModal(lang, { bundesland: "BE", carryoverEnabled: true, carryoverCutoff: "03-31" }),
        `settings/${lang}`
      );
    });

    it(`request, review and menu views are valid (${lang})`, () => {
      assertValidView(buildRequestModal(lang, EMPTY_DRAFT), `request empty/${lang}`);
      assertValidView(
        buildRequestModal(
          lang,
          { startDate: "2026-01-01", endDate: "2026-01-01", halfDayStart: true, halfDayEnd: false, reason: "x" },
          { days: 0.5, holidayNames: ["Neujahrstag"], remaining: 12, remainingAfter: 11.5 }
        ),
        `request single day/${lang}`
      );
      assertValidView(
        buildRequestModal(
          lang,
          { startDate: "2026-01-01", endDate: "2026-01-08", halfDayStart: true, halfDayEnd: true },
          { days: 5, holidayNames: [], remaining: 2, remainingAfter: -3, problem: "insufficient" }
        ),
        `request multi day/${lang}`
      );
      assertValidView(buildReviewModal(lang, "reject", request(1), "Anna", context), `review/${lang}`);
      assertValidView(buildMainMenuModal(lang, true), `menu admin/${lang}`);
      assertValidView(buildMainMenuModal(lang, false), `menu/${lang}`);
    });
  }

  it("offers a way to reach the rows it did not render", () => {
    const view = buildMyHolidaysModal("en", many, "2026-08-26");
    const actions = view.blocks.filter((b: any) => b.type === "actions");
    expect(actions.some((b: any) => b.elements[0].action_id === "my_holidays_more")).toBe(true);
  });

  it("shows every row once the list is short enough", () => {
    const view = buildMyHolidaysModal("en", many.slice(0, 5), "2026-08-26");
    expect(view.blocks.filter((b: any) => b.type === "section")).toHaveLength(5);
    expect(view.blocks.some((b: any) => b.type === "actions")).toBe(false);
  });

  it("only offers cancel on requests the employee may actually cancel", () => {
    const entries: MyHolidayEntry[] = [
      { request: request(1, { status: "approved", startDate: "2026-09-01", endDate: "2026-09-03" }), days: 3 },
      { request: request(2, { status: "approved", startDate: "2026-08-01", endDate: "2026-08-03" }), days: 3 },
      { request: request(3, { status: "rejected", startDate: "2026-09-01", endDate: "2026-09-03" }), days: 3 },
      { request: request(4, { status: "pending", startDate: "2026-09-01", endDate: "2026-09-03" }), days: 3 },
    ];
    const view = buildMyHolidaysModal("en", entries, "2026-08-26");
    const withButton = view.blocks
      .filter((b: any) => b.type === "section" && b.accessory)
      .map((b: any) => Number(b.accessory.value));
    expect(withButton).toEqual([1, 4]);
  });

  it("puts the reversible action before the destructive one in manage", () => {
    const view = buildManageHolidaysModal("en", { id: "U123", name: "Anna Beispiel" }, [{ request: request(1), days: 4 }]);
    const overflow = view.blocks.find((b: any) => b.accessory?.type === "overflow")!.accessory;
    expect(overflow.options.map((o: any) => o.value)).toEqual(["cancel_1", "delete_1"]);
    expect(overflow.confirm).toBeDefined();
  });
});
