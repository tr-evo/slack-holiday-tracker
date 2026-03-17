import type { App } from "@slack/bolt";
import { getDb } from "../db/connection.js";
import { createUserRepo } from "../db/repositories/userRepo.js";
import { createRequestRepo } from "../db/repositories/requestRepo.js";
import { createPublicHolidayRepo } from "../db/repositories/publicHolidayRepo.js";
import { calculateRequestDays, calculateRemainingDays, getEffectiveCarryover } from "../services/allowance.js";
import { createSettingsRepo } from "../db/repositories/settingsRepo.js";
import { parseDateRanges, buildNachtragenPreviewModal } from "../modals/batchPastHolidayModal.js";
import { sendDM } from "../services/slack.js";
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

    // Validate half-day options for single-day requests
    if (startDate === endDate && halfDayStart && halfDayEnd) {
      await ack({
        response_action: "errors",
        errors: { half_days_block: t("request.half_day_single_day_error", user.language) },
      });
      return;
    }

    // Check remaining allowance
    const year = new Date().getFullYear();
    const publicHolidays = publicHolidayRepo.getDatesForYear(year);
    const requestedDays = calculateRequestDays(startDate, endDate, halfDayStart, halfDayEnd, publicHolidays);
    const approved = requestRepo.getApprovedForUserInYear(userId, year);
    const settingsRepo = createSettingsRepo(db);
    const carryover = getEffectiveCarryover(
      user.carryoverDays,
      settingsRepo.isCarryoverEnabled(),
      settingsRepo.getCarryoverCutoff()
    );
    const remaining = calculateRemainingDays(user.annualAllowance, approved, publicHolidays, carryover);

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

    // Auto-approve past holidays, require approval for future ones
    const today = new Date().toISOString().slice(0, 10);
    const isPast = endDate < today;

    if (isPast) {
      requestRepo.approve(requestId, userId, null);
      await sendDM(client, userId, t("request.past_auto_approved", user.language, { start: startDate, end: endDate }));
    } else {
      // Notify user
      await sendDM(client, userId, t("request.submitted", user.language));

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
    }
  });

  // User batch nachtragen — parse and show preview
  app.view("user_nachtragen_submit", async ({ ack, body, view }) => {
    const db = getDb();
    const userRepo = createUserRepo(db);

    const user = userRepo.findById(body.user.id);
    if (!user) {
      await ack();
      return;
    }

    const values = view.state.values;
    const datesText = values.batch_dates_block?.batch_dates?.value;

    if (!datesText) {
      await ack();
      return;
    }

    const { ranges, errors } = parseDateRanges(datesText);

    if (errors.length > 0) {
      await ack({
        response_action: "errors",
        errors: {
          batch_dates_block: errors
            .map((line: string) => t("admin.batch_parse_error", user.language, { line }))
            .join("; "),
        },
      });
      return;
    }

    const metadata = JSON.stringify({ ranges });
    await ack({
      response_action: "push",
      view: buildNachtragenPreviewModal(user.language, ranges, "user_nachtragen_confirm", metadata),
    } as any);
  });

  // User nachtragen confirm — actually create the entries
  app.view("user_nachtragen_confirm", async ({ ack, body, view, client }) => {
    const db = getDb();
    const userRepo = createUserRepo(db);
    const requestRepo = createRequestRepo(db);

    const userId = body.user.id;
    const user = userRepo.findById(userId);
    if (!user) {
      await ack();
      return;
    }

    const { ranges } = JSON.parse(view.private_metadata);
    await ack();

    for (const range of ranges) {
      const requestId = requestRepo.create({
        userId,
        startDate: range.startDate,
        endDate: range.endDate,
        halfDayStart: false,
        halfDayEnd: false,
        reason: null,
      });
      requestRepo.approve(requestId, userId, null);
    }

    await sendDM(client, userId, t("nachtragen.done", user.language, { count: String(ranges.length) }));
  });
}
