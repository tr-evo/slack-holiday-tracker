import type { App } from "@slack/bolt";
import { getDb } from "../db/connection.js";
import { createUserRepo } from "../db/repositories/userRepo.js";
import { createRequestRepo } from "../db/repositories/requestRepo.js";
import { buildAdminPanelModal } from "../modals/adminPanel.js";
import { t } from "../i18n/t.js";

export function registerAdminHandlers(app: App) {
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
      view: buildAdminPanelModal(user.language, pending),
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
    const selectedUserId = values.user_select_block?.admin_user_select?.selected_user;
    const newAllowance = values.allowance_block?.admin_allowance?.value;

    if (selectedUserId && newAllowance) {
      userRepo.upsert({ slackId: selectedUserId, name: selectedUserId });
      userRepo.setAllowance(selectedUserId, Number(newAllowance));
    }

    // Handle toggle admin
    const toggleUserId = values.admin_toggle_user_block?.admin_toggle_user_select?.selected_user;
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
  });
}
