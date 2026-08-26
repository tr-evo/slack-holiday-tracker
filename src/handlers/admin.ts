import type { App } from "@slack/bolt";
import { getDb } from "../db/connection.js";
import { createUserRepo, type User } from "../db/repositories/userRepo.js";
import { createRequestRepo, type HolidayRequest } from "../db/repositories/requestRepo.js";
import { createSettingsRepo } from "../db/repositories/settingsRepo.js";
import {
  buildAdminApprovalsModal,
  buildAdminPeopleModal,
  buildAdminSettingsModal,
  type PendingEntry,
} from "../modals/adminModals.js";
import { buildManageHolidaysModal, type ManageEntry, type ManageTarget } from "../modals/manageHolidaysModal.js";
import { buildBatchPastHolidayModal, buildNachtragenPreviewModal, type PreviewEntry } from "../modals/batchPastHolidayModal.js";
import { parseDateRanges } from "../services/batchParser.js";
import { getHolidayDatesForYears, getPublicHolidaysForYear } from "../services/publicHolidays.js";
import { calculateRequestDays } from "../services/allowance.js";
import { getRequestContext, yearsSpannedBy } from "../services/balance.js";
import { searchMembers } from "../services/memberDirectory.js";
import { formatRange, todayIso } from "../services/dates.js";
import { sendDM } from "../services/slack.js";
import { t } from "../i18n/t.js";
import { openOrPush, refreshHome } from "./views.js";

function requireAdmin(userId: string): User | null {
  const admin = createUserRepo(getDb()).findById(userId);
  return admin?.isAdmin ? admin : null;
}

/** Pull the id *and* the human name out of a picker selection. */
function readPicked(values: any, block: string, action: string): { id: string; name: string } | null {
  const option = values?.[block]?.[action]?.selected_option;
  if (!option?.value) return null;
  return { id: option.value, name: option.text?.text ?? option.value };
}

export function registerAdminHandlers(app: App) {
  // Backed by a cached, fully paginated directory rather than a users.list call
  // per keystroke — see services/memberDirectory.ts
  const handleUserOptions = async ({ options, ack, client }: any) => {
    const members = await searchMembers(client, options.value ?? "");
    await ack({
      options: members.map((m) => ({ text: { type: "plain_text", text: m.name }, value: m.id })),
    });
  };

  app.options("people_user_select", handleUserOptions);
  app.options("manage_user_select", handleUserOptions);
  app.options("batch_user_select", handleUserOptions);

  // ------------------------------------------------------------- approvals
  app.action("open_admin_approvals", async ({ ack, body, client }) => {
    await ack();
    const admin = requireAdmin(body.user.id);
    if (!admin) return;
    await openOrPush(client, body, await buildApprovalsView(admin.language));
  });

  app.action("admin_approvals_more", async ({ ack, action, body, client }) => {
    await ack();
    const admin = requireAdmin(body.user.id);
    if (!admin) return;
    await client.views.update({
      view_id: (body as any).view.id,
      view: await buildApprovalsView(admin.language, Number((action as any).value) || 0),
    });
  });

  // ---------------------------------------------------------------- people
  app.action("open_admin_people", async ({ ack, body, client }) => {
    await ack();
    const admin = requireAdmin(body.user.id);
    if (!admin) return;
    const carryover = createSettingsRepo(getDb()).isCarryoverEnabled();
    await openOrPush(client, body, buildAdminPeopleModal(admin.language, null, carryover));
  });

  // Selecting a person re-renders the form with their current values, so the
  // fields always show what is actually stored rather than empty placeholders.
  app.action("people_user_select", async ({ ack, action, body, client }) => {
    await ack();
    const admin = requireAdmin(body.user.id);
    if (!admin) return;

    const db = getDb();
    const userRepo = createUserRepo(db);
    const option = (action as any).selected_option;
    if (!option?.value) return;

    userRepo.upsert({ slackId: option.value, name: option.text?.text ?? option.value });
    const selected = userRepo.findById(option.value);

    await client.views.update({
      view_id: (body as any).view.id,
      hash: (body as any).view.hash,
      view: buildAdminPeopleModal(admin.language, selected, createSettingsRepo(db).isCarryoverEnabled()),
    });
  });

  // Saves allowance and carryover only. Admin rights are a separate, explicit,
  // confirmed action — they used to flip as a side effect of saving this form.
  app.view("admin_people_submit", async ({ ack, body, view, client }) => {
    await ack();
    const admin = requireAdmin(body.user.id);
    if (!admin) return;

    const db = getDb();
    const userRepo = createUserRepo(db);
    const values = view.state.values;

    const picked = readPicked(values, "people_user_block", "people_user_select");
    if (!picked) return;

    userRepo.upsert({ slackId: picked.id, name: picked.name });

    const allowance = values.allowance_block?.admin_allowance?.value;
    if (allowance != null && allowance !== "") userRepo.setAllowance(picked.id, Number(allowance));

    const carryoverDays = values.carryover_days_block?.admin_carryover_days?.value;
    if (carryoverDays != null && carryoverDays !== "") userRepo.setCarryoverDays(picked.id, Number(carryoverDays));

    const target = userRepo.findById(picked.id);
    if (target) {
      await sendDM(client, admin.slackId, t("admin.saved_person", admin.language, { name: target.name }));
      await refreshHome(client, target);
    }
  });

  app.action("toggle_admin_rights", async ({ ack, action, body, client }) => {
    await ack();
    const admin = requireAdmin(body.user.id);
    if (!admin) return;

    const db = getDb();
    const userRepo = createUserRepo(db);
    const targetId = (action as any).value;
    const target = userRepo.findById(targetId);
    if (!target) return;

    // Don't let the last admin lock everyone out of the panel.
    if (target.isAdmin && userRepo.getAdmins().length <= 1) {
      await sendDM(client, admin.slackId, t("admin.last_admin", admin.language));
      return;
    }

    userRepo.setAdmin(targetId, !target.isAdmin);
    const updated = userRepo.findById(targetId)!;

    await client.views.update({
      view_id: (body as any).view.id,
      view: buildAdminPeopleModal(admin.language, updated, createSettingsRepo(db).isCarryoverEnabled()),
    });
    await refreshHome(client, updated);
  });

  // -------------------------------------------------------------- settings
  app.action("open_admin_settings", async ({ ack, body, client }) => {
    await ack();
    const admin = requireAdmin(body.user.id);
    if (!admin) return;
    await openOrPush(client, body, buildAdminSettingsModal(admin.language, readSettings()));
  });

  app.action("toggle_carryover", async ({ ack, body, client }) => {
    await ack();
    const admin = requireAdmin(body.user.id);
    if (!admin) return;

    const settingsRepo = createSettingsRepo(getDb());
    settingsRepo.set("carryover_enabled", settingsRepo.isCarryoverEnabled() ? "false" : "true");

    await client.views.update({
      view_id: (body as any).view.id,
      view: buildAdminSettingsModal(admin.language, readSettings()),
    });
  });

  app.view("admin_settings_submit", async ({ ack, body, view, client }) => {
    const admin = requireAdmin(body.user.id);
    if (!admin) {
      await ack();
      return;
    }

    const values = view.state.values;
    const cutoff = values.carryover_cutoff_block?.carryover_cutoff?.value;

    if (cutoff && !/^\d{2}-\d{2}$/.test(cutoff.trim())) {
      await ack({
        response_action: "errors",
        errors: { carryover_cutoff_block: t("admin.carryover_cutoff_invalid", admin.language) },
      });
      return;
    }

    await ack();
    const settingsRepo = createSettingsRepo(getDb());

    const bundesland = values.bundesland_block?.admin_bundesland?.selected_option?.value;
    if (bundesland) settingsRepo.set("bundesland", bundesland);
    if (cutoff) settingsRepo.set("carryover_cutoff", cutoff.trim());

    await sendDM(client, admin.slackId, t("admin.saved_settings", admin.language));
  });

  // ------------------------------------------------- manage someone's holidays
  app.action("open_manage_holidays", async ({ ack, body, client }) => {
    await ack();
    const admin = requireAdmin(body.user.id);
    if (!admin) return;
    await openOrPush(client, body, await buildManageView(admin.language, null));
  });

  app.action("manage_user_select", async ({ ack, action, body, client }) => {
    await ack();
    const admin = requireAdmin(body.user.id);
    if (!admin) return;

    const option = (action as any).selected_option;
    if (!option?.value) return;

    await client.views.update({
      view_id: (body as any).view.id,
      hash: (body as any).view.hash,
      view: await buildManageView(admin.language, { id: option.value, name: option.text?.text ?? option.value }),
    });
  });

  app.action("manage_holidays_more", async ({ ack, action, body, client }) => {
    await ack();
    const admin = requireAdmin(body.user.id);
    if (!admin) return;

    const meta = JSON.parse((body as any).view?.private_metadata || "{}");
    await client.views.update({
      view_id: (body as any).view.id,
      view: await buildManageView(admin.language, targetFrom(meta), Number((action as any).value) || 0),
    });
  });

  // Cancel keeps the record and returns the days; delete is the escape hatch
  // for entries that should never have existed. Both sit behind a confirm.
  app.action(/^manage_holiday_action_\d+$/, async ({ ack, action, body, client }) => {
    await ack();
    const admin = requireAdmin(body.user.id);
    if (!admin) return;

    const selected = (action as any).selected_option?.value as string | undefined;
    if (!selected) return;

    const [verb, idText] = selected.split("_");
    const requestId = Number(idText);
    if (!Number.isFinite(requestId)) return;

    const db = getDb();
    const userRepo = createUserRepo(db);
    const requestRepo = createRequestRepo(db);
    const request = requestRepo.findById(requestId);
    if (!request) return;

    if (verb === "cancel") {
      requestRepo.cancel(requestId, admin.slackId);
    } else if (verb === "delete") {
      requestRepo.deleteById(requestId);
    } else {
      return;
    }

    const owner = userRepo.findById(request.userId);
    if (owner) {
      await sendDM(
        client,
        owner.slackId,
        t(verb === "cancel" ? "admin.cancelled_your_holiday" : "admin.deleted_your_holiday", owner.language, {
          range: formatRange(request.startDate, request.endDate, owner.language),
        })
      );
      await refreshHome(client, owner);
    }

    const meta = JSON.parse((body as any).view?.private_metadata || "{}");
    await client.views.update({
      view_id: (body as any).view.id,
      view: await buildManageView(admin.language, targetFrom(meta) ?? { id: request.userId, name: owner?.name ?? request.userId }, meta.offset ?? 0),
    });
  });

  // ------------------------------------------------------- batch past holidays
  app.action("open_batch_past_holiday", async ({ ack, body, client }) => {
    await ack();
    const admin = requireAdmin(body.user.id);
    if (!admin) return;
    await openOrPush(client, body, buildBatchPastHolidayModal(admin.language));
  });

  app.view("batch_past_holiday_submit", async ({ ack, body, view }) => {
    const admin = requireAdmin(body.user.id);
    if (!admin) {
      await ack();
      return;
    }

    const values = view.state.values;
    const picked = readPicked(values, "batch_user_block", "batch_user_select");
    const datesText = values.batch_dates_block?.batch_dates?.value;

    if (!picked || !datesText) {
      await ack();
      return;
    }

    const { ranges, errors } = parseDateRanges(datesText);
    if (errors.length > 0) {
      await ack({
        response_action: "errors",
        errors: { batch_dates_block: t("admin.batch_parse_error", admin.language, { line: errors.join(", ") }) },
      });
      return;
    }

    const entries = await previewEntries(ranges);
    await ack({
      response_action: "push",
      view: buildNachtragenPreviewModal(
        admin.language,
        entries,
        "batch_past_holiday_confirm",
        JSON.stringify({ user: picked, ranges })
      ),
    } as any);
  });

  app.view("batch_past_holiday_confirm", async ({ ack, body, view, client }) => {
    await ack();
    const admin = requireAdmin(body.user.id);
    if (!admin) return;

    const { user: picked, ranges } = JSON.parse(view.private_metadata);
    const db = getDb();
    const userRepo = createUserRepo(db);
    const requestRepo = createRequestRepo(db);

    // Store the real name, not the Slack id
    userRepo.upsert({ slackId: picked.id, name: picked.name });

    for (const range of ranges) {
      const id = requestRepo.create({
        userId: picked.id,
        startDate: range.startDate,
        endDate: range.endDate,
        halfDayStart: false,
        halfDayEnd: false,
        reason: null,
      });
      requestRepo.approve(id, admin.slackId, null);
    }

    await sendDM(
      client,
      admin.slackId,
      t("admin.batch_past_holidays_added", admin.language, { count: String(ranges.length), user: picked.name })
    );

    const target = userRepo.findById(picked.id);
    if (target) await refreshHome(client, target);
  });
}

// ---------------------------------------------------------------------------

function readSettings() {
  const settingsRepo = createSettingsRepo(getDb());
  return {
    bundesland: settingsRepo.getBundesland(),
    carryoverEnabled: settingsRepo.isCarryoverEnabled(),
    carryoverCutoff: settingsRepo.getCarryoverCutoff(),
  };
}

async function buildApprovalsView(lang: string, offset = 0) {
  const db = getDb();
  const userRepo = createUserRepo(db);
  const requestRepo = createRequestRepo(db);

  const pending = requestRepo.getPending();
  const entries: PendingEntry[] = [];

  for (const request of pending) {
    const requester = userRepo.findById(request.userId);
    if (!requester) continue;
    entries.push({
      request,
      requesterName: requester.name,
      context: await getRequestContext(db, requester, request),
    });
  }

  return buildAdminApprovalsModal(lang, entries, offset);
}

function targetFrom(meta: any): ManageTarget | null {
  return meta?.userId ? { id: meta.userId, name: meta.userName ?? meta.userId } : null;
}

async function buildManageView(lang: string, target: ManageTarget | null, offset = 0) {
  const db = getDb();
  const requestRepo = createRequestRepo(db);
  const bundesland = createSettingsRepo(db).getBundesland();

  if (!target) return buildManageHolidaysModal(lang, null, [], 0);

  const requests = requestRepo.listByUser(target.id);
  const publicHolidays = bundesland
    ? await getHolidayDatesForYears(yearsSpannedBy(requests, new Date().getUTCFullYear()), bundesland)
    : [];

  const entries: ManageEntry[] = requests.map((r: HolidayRequest) => ({
    request: r,
    days: calculateRequestDays(r.startDate, r.endDate, r.halfDayStart, r.halfDayEnd, publicHolidays),
  }));

  return buildManageHolidaysModal(lang, target, entries, offset);
}

export async function previewEntries(ranges: { startDate: string; endDate: string }[]): Promise<PreviewEntry[]> {
  const bundesland = createSettingsRepo(getDb()).getBundesland();
  const publicHolidays = bundesland
    ? await getHolidayDatesForYears(yearsSpannedBy(ranges, new Date().getUTCFullYear()), bundesland)
    : [];

  return ranges.map((range) => ({
    range,
    days: calculateRequestDays(range.startDate, range.endDate, false, false, publicHolidays),
  }));
}
