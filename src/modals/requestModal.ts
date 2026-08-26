import { t } from "../i18n/t.js";
import { formatDays } from "./shared.js";

export interface RequestDraft {
  startDate?: string;
  endDate?: string;
  halfDayStart: boolean;
  halfDayEnd: boolean;
  reason?: string;
}

export interface RequestPreview {
  days: number;
  /** Public holidays falling inside the range, already in the user's language */
  holidayNames: string[];
  remaining: number;
  remainingAfter: number;
  problem?: "order" | "zero" | "insufficient";
}

export const EMPTY_DRAFT: RequestDraft = { halfDayStart: false, halfDayEnd: false };

/**
 * Read the half-day selection back out of view state. Single-day requests use a
 * three-way choice; longer ones keep the two independent checkboxes, because
 * you can genuinely want a half day at each end.
 */
export function readHalfDays(values: any, startDate?: string, endDate?: string) {
  if (startDate && startDate === endDate) {
    const choice = values?.half_choice_block?.half_choice?.selected_option?.value ?? "full";
    return { halfDayStart: choice === "morning", halfDayEnd: choice === "afternoon" };
  }
  const selected = values?.half_days_block?.half_days?.selected_options ?? [];
  return {
    halfDayStart: selected.some((o: any) => o.value === "half_day_start"),
    halfDayEnd: selected.some((o: any) => o.value === "half_day_end"),
  };
}

export function readDraft(values: any): RequestDraft {
  const startDate = values?.start_date_block?.start_date?.selected_date ?? undefined;
  const endDate = values?.end_date_block?.end_date?.selected_date ?? undefined;
  return {
    startDate,
    endDate,
    ...readHalfDays(values, startDate, endDate),
    reason: values?.reason_block?.reason?.value ?? undefined,
  };
}

/**
 * The request form. Re-rendered on every date or half-day change so the cost is
 * visible before submitting rather than arriving as a validation error after.
 * Because views.update replaces the whole view, every in-progress value has to
 * be re-applied here from the draft.
 */
export function buildRequestModal(lang: string, draft: RequestDraft = EMPTY_DRAFT, preview?: RequestPreview) {
  const singleDay = Boolean(draft.startDate && draft.startDate === draft.endDate);
  const blocks: any[] = [];

  blocks.push({
    type: "input",
    block_id: "start_date_block",
    dispatch_action: true,
    element: {
      type: "datepicker",
      action_id: "start_date",
      placeholder: { type: "plain_text", text: t("request.start_date", lang) },
      ...(draft.startDate ? { initial_date: draft.startDate } : {}),
    },
    label: { type: "plain_text", text: t("request.start_date", lang) },
  });

  blocks.push({
    type: "input",
    block_id: "end_date_block",
    dispatch_action: true,
    element: {
      type: "datepicker",
      action_id: "end_date",
      placeholder: { type: "plain_text", text: t("request.end_date", lang) },
      ...(draft.endDate ? { initial_date: draft.endDate } : {}),
    },
    label: { type: "plain_text", text: t("request.end_date", lang) },
    hint: { type: "plain_text", text: t("request.end_date_hint", lang) },
  });

  const previewBlock = buildPreviewBlock(lang, preview);
  if (previewBlock) blocks.push(previewBlock);

  if (singleDay) {
    blocks.push({
      type: "input",
      block_id: "half_choice_block",
      dispatch_action: true,
      optional: true,
      element: {
        type: "radio_buttons",
        action_id: "half_choice",
        initial_option: halfChoiceOption(lang, draft.halfDayStart ? "morning" : draft.halfDayEnd ? "afternoon" : "full"),
        options: [
          halfChoiceOption(lang, "full"),
          halfChoiceOption(lang, "morning"),
          halfChoiceOption(lang, "afternoon"),
        ],
      },
      label: { type: "plain_text", text: t("request.length", lang) },
    });
  } else {
    const selected = [
      ...(draft.halfDayStart ? [halfDayOption(lang, "half_day_start")] : []),
      ...(draft.halfDayEnd ? [halfDayOption(lang, "half_day_end")] : []),
    ];
    blocks.push({
      type: "input",
      block_id: "half_days_block",
      dispatch_action: true,
      optional: true,
      element: {
        type: "checkboxes",
        action_id: "half_days",
        options: [halfDayOption(lang, "half_day_start"), halfDayOption(lang, "half_day_end")],
        ...(selected.length > 0 ? { initial_options: selected } : {}),
      },
      label: { type: "plain_text", text: t("request.length", lang) },
    });
  }

  blocks.push({
    type: "input",
    block_id: "reason_block",
    optional: true,
    element: {
      type: "plain_text_input",
      action_id: "reason",
      multiline: true,
      placeholder: { type: "plain_text", text: t("request.reason", lang) },
      ...(draft.reason ? { initial_value: draft.reason } : {}),
    },
    label: { type: "plain_text", text: t("request.reason", lang) },
  });

  return {
    type: "modal" as const,
    callback_id: "submit_holiday_request",
    title: { type: "plain_text" as const, text: t("request.title", lang) },
    submit: { type: "plain_text" as const, text: t("request.submit", lang) },
    close: { type: "plain_text" as const, text: t("common.cancel", lang) },
    blocks,
  };
}

function buildPreviewBlock(lang: string, preview?: RequestPreview): any | null {
  if (!preview) {
    return { type: "context", elements: [{ type: "mrkdwn", text: t("request.pick_dates", lang) }] };
  }

  if (preview.problem === "order") {
    return { type: "context", elements: [{ type: "mrkdwn", text: `:warning: ${t("request.invalid_dates", lang)}` }] };
  }
  if (preview.problem === "zero") {
    return { type: "context", elements: [{ type: "mrkdwn", text: `:warning: ${t("request.zero_days", lang)}` }] };
  }

  const lines = [
    `*${t("request.preview_days", lang, { days: formatDays(preview.days, lang) })}*`,
  ];
  if (preview.holidayNames.length > 0) {
    lines.push(t("request.preview_holidays", lang, { names: preview.holidayNames.join(", ") }));
  }
  lines.push(
    preview.problem === "insufficient"
      ? `:warning: ${t("request.insufficient_days", lang, { remaining: formatDays(preview.remaining, lang), requested: formatDays(preview.days, lang) })}`
      : t("request.preview_remaining", lang, {
          after: formatDays(preview.remainingAfter, lang),
          before: formatDays(preview.remaining, lang),
        })
  );

  return { type: "context", elements: [{ type: "mrkdwn", text: lines.join("\n") }] };
}

function halfChoiceOption(lang: string, value: "full" | "morning" | "afternoon") {
  return {
    text: { type: "plain_text" as const, text: t(`request.length_${value}`, lang) },
    value,
  };
}

function halfDayOption(lang: string, value: "half_day_start" | "half_day_end") {
  return {
    text: { type: "plain_text" as const, text: t(`request.${value}`, lang) },
    value,
  };
}
