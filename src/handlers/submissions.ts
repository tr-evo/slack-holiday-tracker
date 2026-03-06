import type { App } from "@slack/bolt";
import { getDb } from "../db/connection.js";
import { createUserRepo } from "../db/repositories/userRepo.js";
import { createRequestRepo } from "../db/repositories/requestRepo.js";
import { createPublicHolidayRepo } from "../db/repositories/publicHolidayRepo.js";
import { calculateRequestDays, calculateRemainingDays } from "../services/allowance.js";
import { t } from "../i18n/t.js";

export function registerSubmissionHandlers(app: App) {
  app.view("submit_holiday_request", async ({ ack, body, view, client }) => {
    const db = getDb();
    const userRepo = createUserRepo(db);
    const requestRepo = createRequestRepo(db);
    const publicHolidayRepo = createPublicHolidayRepo(db);

    const userId = body.user.id;
    const user = userRepo.findById(userId);
    if (!user) {
      await ack({ response_action: "errors", errors: {} });
      return;
    }

    const values = view.state.values;
    const startDate = values.start_date_block.start_date.selected_date!;
    const endDate = values.end_date_block.end_date.selected_date!;
    const halfDays = values.half_days_block?.half_days?.selected_options ?? [];
    const halfDayStart = halfDays.some((o: any) => o.value === "half_day_start");
    const halfDayEnd = halfDays.some((o: any) => o.value === "half_day_end");
    const reason = values.reason_block?.reason?.value ?? null;

    // Validate dates
    if (endDate < startDate) {
      await ack({
        response_action: "errors",
        errors: { end_date_block: t("request.invalid_dates", user.language) },
      });
      return;
    }

    // Check remaining allowance
    const year = new Date().getFullYear();
    const publicHolidays = publicHolidayRepo.getDatesForYear(year);
    const requestedDays = calculateRequestDays(startDate, endDate, halfDayStart, halfDayEnd, publicHolidays);
    const approved = requestRepo.getApprovedForUserInYear(userId, year);
    const remaining = calculateRemainingDays(user.annualAllowance, approved, publicHolidays);

    if (requestedDays > remaining) {
      await ack({
        response_action: "errors",
        errors: {
          end_date_block: t("request.insufficient_days", user.language, {
            remaining: String(remaining),
            requested: String(requestedDays),
          }),
        },
      });
      return;
    }

    await ack();

    // Create the request
    const requestId = requestRepo.create({
      userId,
      startDate,
      endDate,
      halfDayStart,
      halfDayEnd,
      reason,
    });

    // Notify user
    await client.chat.postMessage({
      channel: userId,
      text: t("request.submitted", user.language),
    });

    // Notify admins
    const admins = userRepo.getAdmins();
    const daysText = t("approval.days", user.language, { count: String(requestedDays) });
    for (const admin of admins) {
      const adminLang = admin.language;
      await client.chat.postMessage({
        channel: admin.slackId,
        text: t("approval.new_request", adminLang, { name: user.name }),
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: [
                `*${t("approval.new_request", adminLang, { name: user.name })}*`,
                t("approval.dates", adminLang, { start: startDate, end: endDate }),
                daysText,
                reason ? `> ${reason}` : "",
              ].filter(Boolean).join("\n"),
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: t("approval.approve", adminLang) },
                style: "primary",
                action_id: "approve_request",
                value: String(requestId),
              },
              {
                type: "button",
                text: { type: "plain_text", text: t("approval.reject", adminLang) },
                style: "danger",
                action_id: "reject_request",
                value: String(requestId),
              },
            ],
          },
        ],
      });
    }
  });
}
