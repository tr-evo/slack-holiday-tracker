import type { App } from "@slack/bolt";
import { getDb } from "../db/connection.js";
import { createUserRepo } from "../db/repositories/userRepo.js";
import { createRequestRepo } from "../db/repositories/requestRepo.js";
import { getRequestContext } from "../services/balance.js";
import { previewRequest } from "../services/requestPreview.js";
import { parseDateRanges } from "../services/batchParser.js";
import { formatRange, todayIso } from "../services/dates.js";
import { sendDM, sendDMs } from "../services/slack.js";
import { buildNachtragenPreviewModal } from "../modals/batchPastHolidayModal.js";
import { contextBlocks } from "../modals/reviewModal.js";
import { readDraft } from "../modals/requestModal.js";
import { formatDays } from "../modals/shared.js";
import { t } from "../i18n/t.js";
import { applyDecision } from "./actions.js";
import { previewEntries } from "./admin.js";
import { refreshHome } from "./views.js";

export function registerSubmissionHandlers(app: App) {
  // ------------------------------------------------------- new holiday request
  app.view("submit_holiday_request", async ({ ack, body, view, client }) => {
    const db = getDb();
    const userRepo = createUserRepo(db);
    const requestRepo = createRequestRepo(db);

    const user = userRepo.findById(body.user.id);
    if (!user) {
      await ack();
      return;
    }

    const draft = readDraft(view.state.values);
    if (!draft.startDate || !draft.endDate) {
      await ack({
        response_action: "errors",
        errors: { end_date_block: t("request.pick_dates", user.language) },
      });
      return;
    }

    // The same computation that drove the live preview, so the number the user
    // saw is the number enforced here.
    const preview = await previewRequest(db, user, draft, user.language);
    if (!preview) {
      await ack();
      return;
    }

    if (preview.problem === "order") {
      await ack({
        response_action: "errors",
        errors: { end_date_block: t("request.invalid_dates", user.language) },
      });
      return;
    }

    // A weekends-only range used to pass validation and land a worthless
    // request in an admin's queue: `0 > remaining` is false.
    if (preview.problem === "zero") {
      await ack({
        response_action: "errors",
        errors: { end_date_block: t("request.zero_days", user.language) },
      });
      return;
    }

    if (preview.problem === "insufficient") {
      await ack({
        response_action: "errors",
        errors: {
          end_date_block: t("request.insufficient_days", user.language, {
            remaining: formatDays(preview.remaining, user.language),
            requested: formatDays(preview.days, user.language),
          }),
        },
      });
      return;
    }

    await ack();

    const requestId = requestRepo.create({
      userId: user.slackId,
      startDate: draft.startDate,
      endDate: draft.endDate,
      halfDayStart: draft.halfDayStart,
      halfDayEnd: draft.halfDayEnd,
      reason: draft.reason ?? null,
    });

    const isPast = draft.endDate < todayIso();

    if (isPast) {
      requestRepo.approve(requestId, user.slackId, null);
      await sendDM(
        client,
        user.slackId,
        t("request.past_auto_approved", user.language, {
          range: formatRange(draft.startDate, draft.endDate, user.language),
        })
      );
      await refreshHome(client, user);
      return;
    }

    await sendDM(client, user.slackId, t("request.submitted", user.language));
    await refreshHome(client, user);

    const request = requestRepo.findById(requestId)!;
    const context = await getRequestContext(db, user, request);
    const admins = userRepo.getAdmins();

    // Fan out in parallel — this used to be two serial API calls per admin
    await sendDMs(
      client,
      admins.map((admin) => ({
        userId: admin.slackId,
        text: t("approval.new_request", admin.language, { name: user.name }),
        blocks: approvalBlocks(admin.language, user.name, request, context, draft.reason ?? null),
      }))
    );

    await Promise.all(admins.map((admin) => refreshHome(client, admin)));
  });

  // --------------------------------------------------- approve / reject a request
  app.view("review_submit", async ({ ack, body, view, client }) => {
    await ack();
    const { requestId, action } = JSON.parse(view.private_metadata);
    const comment = view.state.values.review_comment_block?.review_comment?.value?.trim() || null;
    await applyDecision(client, body, requestId, action, comment, false);
  });

  // ------------------------------------------------ employee batch past holidays
  app.view("user_nachtragen_submit", async ({ ack, body, view }) => {
    const user = createUserRepo(getDb()).findById(body.user.id);
    if (!user) {
      await ack();
      return;
    }

    const datesText = view.state.values.batch_dates_block?.batch_dates?.value;
    if (!datesText) {
      await ack();
      return;
    }

    const { ranges, errors } = parseDateRanges(datesText);
    if (errors.length > 0) {
      await ack({
        response_action: "errors",
        errors: { batch_dates_block: t("admin.batch_parse_error", user.language, { line: errors.join(", ") }) },
      });
      return;
    }

    await ack({
      response_action: "push",
      view: buildNachtragenPreviewModal(
        user.language,
        await previewEntries(ranges),
        "user_nachtragen_confirm",
        JSON.stringify({ ranges })
      ),
    } as any);
  });

  app.view("user_nachtragen_confirm", async ({ ack, body, view, client }) => {
    await ack();
    const db = getDb();
    const user = createUserRepo(db).findById(body.user.id);
    if (!user) return;

    const requestRepo = createRequestRepo(db);
    const { ranges } = JSON.parse(view.private_metadata);

    for (const range of ranges) {
      const id = requestRepo.create({
        userId: user.slackId,
        startDate: range.startDate,
        endDate: range.endDate,
        halfDayStart: false,
        halfDayEnd: false,
        reason: null,
      });
      requestRepo.approve(id, user.slackId, null);
    }

    await sendDM(client, user.slackId, t("nachtragen.done", user.language, { count: String(ranges.length) }));
    await refreshHome(client, user);
  });
}

/** The approval DM: the decision plus the context it needs, not just the dates. */
function approvalBlocks(lang: string, name: string, request: any, context: any, reason: string | null): any[] {
  const blocks: any[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*${t("approval.new_request", lang, { name })}*`,
          `${formatRange(request.startDate, request.endDate, lang)}  ·  ${t("common.days", lang, { days: formatDays(context.days, lang) })}`,
        ].join("\n"),
      },
    },
  ];

  if (reason) blocks.push({ type: "section", text: { type: "mrkdwn", text: `> ${reason}` } });

  blocks.push(...contextBlocks(lang, context));

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        style: "primary",
        action_id: "approve_request",
        value: String(request.id),
        text: { type: "plain_text", text: t("approval.approve", lang) },
      },
      {
        type: "button",
        style: "danger",
        action_id: "reject_request",
        value: String(request.id),
        text: { type: "plain_text", text: t("approval.reject_with_reason", lang) },
      },
    ],
  });

  return blocks;
}
