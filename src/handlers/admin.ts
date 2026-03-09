import type { App } from "@slack/bolt";
import { getDb } from "../db/connection.js";
import { createUserRepo } from "../db/repositories/userRepo.js";
import { createRequestRepo } from "../db/repositories/requestRepo.js";
import { buildAdminPanelModal } from "../modals/adminPanel.js";
import { buildPastHolidayModal } from "../modals/pastHolidayModal.js";
import { buildImportHolidaysModal } from "../modals/importHolidaysModal.js";
import { seedPublicHolidays, BUNDESLAENDER } from "../services/publicHolidays.js";
import { createSettingsRepo } from "../db/repositories/settingsRepo.js";
import { t } from "../i18n/t.js";

async function fetchWorkspaceMembers(client: any): Promise<{ id: string; name: string }[]> {
  const result = await client.users.list();
  return (result.members ?? [])
    .filter((m: any) => !m.is_bot && m.id !== "USLACKBOT" && !m.deleted && !m.is_restricted && !m.is_ultra_restricted)
    .map((m: any) => ({ id: m.id, name: m.real_name || m.name }));
}

function getCarryoverSettings(db: any) {
  const settingsRepo = createSettingsRepo(db);
  return {
    enabled: settingsRepo.isCarryoverEnabled(),
    cutoff: settingsRepo.getCarryoverCutoff(),
  };
}

export function registerAdminHandlers(app: App) {
  // Options handler for external_select user pickers
  const handleUserOptions = async ({ options, ack, client }: any) => {
    const query = (options.value ?? "").toLowerCase();
    const members = await fetchWorkspaceMembers(client);
    const filtered = members
      .filter((m: any) => m.name.toLowerCase().includes(query))
      .slice(0, 100)
      .map((m: any) => ({
        text: { type: "plain_text", text: m.name },
        value: m.id,
      }));
    await ack({ options: filtered });
  };

  app.options("admin_user_select", handleUserOptions);
  app.options("admin_toggle_user_select", handleUserOptions);
  app.options("past_user_select", handleUserOptions);
  // Open admin panel from menu
  app.action("open_admin_panel", async ({ ack, body, client }) => {
    await ack();
    const db = getDb();
    const userRepo = createUserRepo(db);
    const user = userRepo.findById(body.user.id);
    if (!user?.isAdmin) return;

    const requestRepo = createRequestRepo(db);
    const pending = requestRepo.getPending();

    await client.views.push({
      trigger_id: (body as any).trigger_id,
      view: buildAdminPanelModal(user.language, pending, getCarryoverSettings(db)),
    });
  });

  // Admin panel submit — set allowance
  app.view("admin_panel_submit", async ({ ack, body, view, client }) => {
    const db = getDb();
    const userRepo = createUserRepo(db);
    const admin = userRepo.findById(body.user.id);
    if (!admin?.isAdmin) {
      await ack();
      return;
    }

    const values = view.state.values;

    // Handle set allowance
    const selectedUserId = values.user_select_block?.admin_user_select?.selected_option?.value;
    const newAllowance = values.allowance_block?.admin_allowance?.value;

    if (selectedUserId && newAllowance) {
      userRepo.upsert({ slackId: selectedUserId, name: selectedUserId });
      userRepo.setAllowance(selectedUserId, Number(newAllowance));
    }

    // Handle carryover days for selected user
    const carryoverDays = values.carryover_days_block?.admin_carryover_days?.value;
    if (selectedUserId && carryoverDays != null) {
      userRepo.setCarryoverDays(selectedUserId, Number(carryoverDays));
    }

    // Handle carryover cutoff setting
    const cutoffValue = values.carryover_cutoff_block?.carryover_cutoff?.value;
    if (cutoffValue) {
      const settingsRepo = createSettingsRepo(db);
      settingsRepo.set("carryover_cutoff", cutoffValue);
    }

    // Handle toggle admin
    const toggleUserId = values.admin_toggle_user_block?.admin_toggle_user_select?.selected_option?.value;
    if (toggleUserId) {
      userRepo.upsert({ slackId: toggleUserId, name: toggleUserId });
      const targetUser = userRepo.findById(toggleUserId);
      if (targetUser) {
        userRepo.setAdmin(toggleUserId, !targetUser.isAdmin);
      }
    }

    await ack();
  });

  // Admin overflow menu actions on pending requests
  app.action(/^admin_request_action_\d+$/, async ({ ack, action, body, client }) => {
    await ack();
    const db = getDb();
    const userRepo = createUserRepo(db);
    const requestRepo = createRequestRepo(db);

    const admin = userRepo.findById(body.user.id);
    if (!admin?.isAdmin) return;

    const selectedValue = (action as any).selected_option?.value as string;
    if (!selectedValue) return;

    const [actionType, requestIdStr] = selectedValue.split("_");
    const requestId = Number(requestIdStr);
    const adminId = body.user.id;

    if (actionType === "approve") {
      requestRepo.approve(requestId, adminId, null);
    } else if (actionType === "reject") {
      requestRepo.reject(requestId, adminId, null);
    }

    const request = requestRepo.findById(requestId);
    if (request) {
      const requester = userRepo.findById(request.userId);
      if (requester) {
        const key = actionType === "approve" ? "approval.approved" : "approval.rejected";
        await client.chat.postMessage({
          channel: requester.slackId,
          text: t(key, requester.language, {
            start: request.startDate,
            end: request.endDate,
          }),
        });
      }
    }

    // Refresh admin panel to remove the handled request
    const updatedPending = requestRepo.getPending();
    const viewId = (body as any).view?.id;
    if (viewId) {
      await client.views.update({
        view_id: viewId,
        view: buildAdminPanelModal(admin.language, updatedPending, getCarryoverSettings(db)),
      });
    }
  });

  // Toggle carryover setting
  app.action("toggle_carryover", async ({ ack, body, client }) => {
    await ack();
    const db = getDb();
    const userRepo = createUserRepo(db);
    const requestRepo = createRequestRepo(db);
    const settingsRepo = createSettingsRepo(db);

    const admin = userRepo.findById(body.user.id);
    if (!admin?.isAdmin) return;

    const currentlyEnabled = settingsRepo.isCarryoverEnabled();
    settingsRepo.set("carryover_enabled", currentlyEnabled ? "false" : "true");

    const pending = requestRepo.getPending();
    const viewId = (body as any).view?.id;
    if (viewId) {
      await client.views.update({
        view_id: viewId,
        view: buildAdminPanelModal(admin.language, pending, getCarryoverSettings(db)),
      });
    }
  });

  // Open "Add Past Holiday" modal
  app.action("open_add_past_holiday", async ({ ack, body, client }) => {
    await ack();
    const db = getDb();
    const userRepo = createUserRepo(db);
    const admin = userRepo.findById(body.user.id);
    if (!admin?.isAdmin) return;

    await client.views.push({
      trigger_id: (body as any).trigger_id,
      view: buildPastHolidayModal(admin.language),
    });
  });

  // Handle "Add Past Holiday" submission
  app.view("past_holiday_submit", async ({ ack, body, view, client }) => {
    const db = getDb();
    const userRepo = createUserRepo(db);
    const requestRepo = createRequestRepo(db);

    const admin = userRepo.findById(body.user.id);
    if (!admin?.isAdmin) {
      await ack();
      return;
    }

    const values = view.state.values;
    const selectedUserId = values.past_user_block?.past_user_select?.selected_option?.value;
    const startDate = values.past_start_block?.past_start_date?.selected_date;
    const endDate = values.past_end_block?.past_end_date?.selected_date;
    const halfDays = values.past_half_days_block?.past_half_days?.selected_options ?? [];
    const halfDayStart = halfDays.some((o: any) => o.value === "half_day_start");
    const halfDayEnd = halfDays.some((o: any) => o.value === "half_day_end");
    const reason = values.past_reason_block?.past_reason?.value ?? null;

    if (!selectedUserId || !startDate || !endDate) {
      await ack();
      return;
    }

    if (endDate < startDate) {
      await ack({
        response_action: "errors",
        errors: { past_end_block: t("request.invalid_dates", admin.language) },
      });
      return;
    }

    await ack();

    // Ensure user exists
    userRepo.upsert({ slackId: selectedUserId, name: selectedUserId });

    // Create as pending then immediately approve
    const requestId = requestRepo.create({
      userId: selectedUserId,
      startDate,
      endDate,
      halfDayStart,
      halfDayEnd,
      reason,
    });
    requestRepo.approve(requestId, body.user.id, null);

    await client.chat.postMessage({
      channel: body.user.id,
      text: t("admin.past_holiday_added", admin.language, {
        user: selectedUserId,
        start: startDate,
        end: endDate,
      }),
    });
  });

  // Open "Import Public Holidays" modal
  app.action("open_import_holidays", async ({ ack, body, client }) => {
    await ack();
    const db = getDb();
    const userRepo = createUserRepo(db);
    const admin = userRepo.findById(body.user.id);
    if (!admin?.isAdmin) return;

    await client.views.push({
      trigger_id: (body as any).trigger_id,
      view: buildImportHolidaysModal(admin.language),
    });
  });

  // Handle "Import Public Holidays" submission
  app.view("import_holidays_submit", async ({ ack, body, view, client }) => {
    const db = getDb();
    const userRepo = createUserRepo(db);
    const admin = userRepo.findById(body.user.id);
    if (!admin?.isAdmin) {
      await ack();
      return;
    }

    const values = view.state.values;
    const bundesland = values.bundesland_block?.bundesland_select?.selected_option?.value;
    const year = values.year_block?.year_select?.selected_option?.value;

    if (!bundesland || !year) {
      await ack();
      return;
    }

    await ack();

    try {
      const count = await seedPublicHolidays(Number(year), bundesland);
      const landName = BUNDESLAENDER[bundesland] ?? bundesland;
      await client.chat.postMessage({
        channel: body.user.id,
        text: t("admin.holidays_imported", admin.language, {
          count: String(count),
          land: landName,
          year,
        }),
      });
    } catch {
      await client.chat.postMessage({
        channel: body.user.id,
        text: t("error.generic", admin.language),
      });
    }
  });
}
