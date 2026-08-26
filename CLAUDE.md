# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Slack bot for managing employee holiday/vacation requests. Slack Bolt (socket mode), SQLite (better-sqlite3), TypeScript. Bilingual (EN/DE) with per-user language preference. German public holidays are computed offline via the `feiertagejs` library.

## Commands

```bash
npm run dev          # Dev mode with hot reload (tsx watch)
npm run build        # tsc + copy i18n JSON into dist/ (the copy is required — see below)
npm start            # Run compiled app (dist/app.js)
npm test             # Run all tests (vitest run)
npm run test:watch   # Watch mode
npx vitest run src/services/__tests__/allowance.test.ts   # Single test file
npx vitest run -t "carryover"                              # Single test by name
./scripts/deploy.sh                                        # Deploy (see docs/DEPLOYMENT.md)
```

## Architecture

**Layered:** Handlers → Services → Repositories → SQLite. `app.ts` initializes the DB, registers the five handler modules, and starts socket mode.

```
src/
├── app.ts               # Entry point + global error handlers
├── handlers/            # holiday.ts (slash command), actions.ts (buttons/menus),
│                        # submissions.ts (view submits), admin.ts (admin views + options),
│                        # views.ts (App Home, openOrPush, shared view builders)
├── modals/              # Block Kit builders — pure functions (lang, ...data) => view
│                        # shared.ts holds the cross-view block helpers
├── services/            # allowance.ts (day counting), balance.ts (snapshots + approval
│                        # context), dates.ts (format/parse), requestPreview.ts,
│                        # cancellation.ts, batchParser.ts, publicHolidays.ts,
│                        # memberDirectory.ts (cached users.list), slack.ts (DMs)
├── db/                  # connection.ts (singleton), schema.ts, repositories/
└── i18n/                # t.ts + en.json / de.json
```

### Surfaces

The app renders to three surfaces and handlers must not assume which one they are on.

- **App Home tab** (`views.publish`) is the primary surface — balance, own requests, team absences, admin queue. Built by `modals/homeTab.ts`, published by `publishHomeTab`/`refreshHome` in `handlers/views.ts`. It requires *App Home → Home Tab* plus the `app_home_opened` bot event in the Slack app config; without both it silently never appears (documented in `docs/SETUP.md`).
- **Modals** (`views.open` / `views.push` / `views.update`).
- **Ephemeral messages** — slash subcommands answer with `respond()` in place, not by DMing the user. DMs are reserved for things that must persist: decisions, cancellations, admin notices.

**`openOrPush(client, body, view)`** in `handlers/views.ts` is mandatory for anything opened from a button. A Home tab click has no modal stack to push onto, so the same handler must `views.open` there and `views.push` inside a modal. Use `isHomeSurface(body)` to decide between `refreshHome` and `views.update` after a mutation.

### Hard Slack limits the code is built around

- **Views cap at 100 blocks.** Every list is paginated through `paginate()` / `showMoreBlock()` in `modals/shared.ts` (`MAX_ROWS_PER_PAGE = 20`), with the offset carried in `private_metadata`. `modals/__tests__/viewLimits.test.ts` renders every builder with 200–400 rows in both languages and fails if any exceeds the cap, so new list views must be paginated to pass.
- **Modal stacks cap at 3 views.** A slash command opens view 1, so a pushed view can only be pushed from twice more. Prefer `views.update` with an in-view `dispatch_action` picker over pushing another view — that's why `manageHolidaysModal` holds its own user picker.
- Modal titles cap at 24 characters, overflow menus at 5 options, actions blocks at 25 elements. The view-limit test asserts these too.

### Key patterns

- **Repositories are factory functions** taking a `Database`: handlers call `getDb()` then `createUserRepo(db)` per invocation. Rows are snake_case in SQLite and mapped to camelCase domain objects by `rowToUser` / `rowToRequest`.
- **`getBalanceSnapshot(db, user)`** is the single source for allowance/used/remaining/carryover breakdown. It was previously reassembled by hand in five places, each repeating the cross-year holiday lookup. Never recompute a balance inline — extend the snapshot.
- **Cross-year holiday lookup**: never fetch holidays for just the current year. `yearsSpannedBy(requests, year)` collects every year the requests touch, then `getHolidayDatesForYears`.
- **`previewRequest`** drives both the live preview in the request modal and the validation on submit, so the number the user sees is the number enforced. Its `problem` field (`order` / `zero` / `insufficient`) maps to the form errors.
- **Interactive re-render**: `views.update` replaces the whole view, so `buildRequestModal(lang, draft, preview)` receives a full draft and re-applies every in-progress value. `readDraft(view.state.values)` reads it back. Adding a field to that form means adding it to the draft too, or it resets on the next keystroke.
- **Two-step confirm flow**: a submit handler acks with `response_action: "push"` and stashes parsed data as JSON in `private_metadata`; the pushed view's `callback_id` (`*_confirm`) handler parses it and writes. Used by both batch "nachtragen" flows.
- **Destructive actions carry Slack's native `confirm` object** rather than pushing a confirmation view — it costs no stack level. Buttons and overflow elements both support it. Never trigger a browser-style dialog.
- **Prefer cancel over delete.** `requestRepo.cancel` sets `status = 'cancelled'` and keeps the row; `deleteById` destroys it. Admin menus list cancel first and reserve delete for entries that should never have existed.
- **Ownership checks**: handlers keyed on a record id (`cancel_request_<id>`) must verify the record belongs to `body.user.id` — the action id travels with the payload and cannot be trusted.
- **Admin gating**: `requireAdmin(userId)` re-checks after `ack()` and returns null; never trust the button's presence.
- **User pickers** use `external_select` backed by `services/memberDirectory.ts`, which caches a fully paginated `users.list` for 5 minutes. Never call `users.list` directly from an options handler — it is rate-limited and sits in the interaction path. Read the picked name from `selected_option.text.text`, not just the id, so users aren't stored with their Slack ID as their name.
- **DMs**: `sendDM()` (caches the `conversations.open` channel id) and `sendDMs()` for parallel fan-out. A sequential loop over admins costs two serial API calls each.
- **Regex action ids**: per-row controls register as `app.action(/^cancel_request_\d+$/)`.

### Business logic (`services/allowance.ts`)

- `countBusinessDays` skips weekends and public holidays, and iterates in **UTC** (`T00:00:00Z`, `getUTCDay`, `setUTCDate`). Do not switch it to local-time `Date` methods: parsing `YYYY-MM-DD` as local midnight and formatting back with `toISOString()` shifts every date one day in zones ahead of UTC, which silently mis-matched public holidays under `npm run dev` in Europe/Berlin while looking fine in the UTC container. `services/dates.ts` pins `Intl` to `timeZone: "UTC"` for the same reason. Both have timezone regression tests.
- Half days: `halfDayStart`/`halfDayEnd` mean "morning only"/"afternoon only" on a single-day request and "starts/ends midday" on a longer one. A single day carrying **both** flags is a full day — that predates the three-way choice, so old rows still have to render correctly (`describeHalfDay` in `modals/shared.ts`).
- Carryover is consumed **first, FIFO by start date** (`calculateUsageBreakdown`), and `getEffectiveCarryover` returns 0 once past `carryover_cutoff` (MM-DD, cutoff day inclusive) or when carryover is disabled.
- **Request lifecycle**: `pending → approved | rejected | cancelled`. `services/cancellation.ts` owns employee eligibility (pending = always withdrawable, approved = only before it starts, otherwise admin-only). Balances recover for free because every balance query filters `status = 'approved'`. `applyDecision` re-checks the request is still `pending` — an employee can withdraw between the admin DM being posted and the button being clicked.

## Database

SQLite at `DB_PATH` (default `./data/holidays.db`), WAL mode, foreign keys on. Tables: `users`, `holiday_requests`, `public_holidays`, `settings`. `holiday_requests.status` is free-text TEXT: `pending`, `approved`, `rejected`, `cancelled` — adding a status needs no migration, but does need a matching `list.status.<value>` key in both translation files.

- **Migrations** are inline in `schema.ts`: `pragma table_info` check + `ALTER TABLE`. No migration framework. `initializeSchema` runs on every startup and must stay idempotent.
- **Settings** is a key-value store: `carryover_enabled`, `carryover_cutoff` (MM-DD), `bundesland` (two-letter code, empty = no public holidays applied). New configuration goes here rather than into new DDL. The seeded `default_allowance` row is **not read anywhere** — the actual default comes from the `DEFAULT_ALLOWANCE` env var in `userRepo.upsert`.
- `holiday_requests.reviewer_comment` holds the approver's note; it is surfaced in the decision DM and in the employee's list.
- `user_id` is a foreign key into `users(slack_id)` — tests that insert requests must insert the users first.

## Gotchas

- **Imports must use `.js` extensions** (`moduleResolution: Node16`) even though output is CommonJS and `t.ts` relies on the CommonJS `__dirname`.
- **`tsc` alone does not copy the i18n JSON** that `t.ts` reads at runtime. `npm run build` now copies it into `dist/i18n/`; the Dockerfile does the same. Anything that compiles by calling `tsc` directly must replicate that or the compiled app crashes on startup.
- **Both translation files must be updated together** when adding a key. `t()` falls back to English, then to the raw key, so a missing German string fails silently. (`__test_only_en__` in `en.json` exists only to test that fallback.) A string with `{placeholders}` needs the params passed at every call site or the braces render literally — the view-limit test scans rendered views for leftover placeholders.
- **Dead code from the pre-`feiertagejs` era**: the `public_holidays` table, `db/repositories/publicHolidayRepo.ts`, and `modals/importHolidaysModal.ts` are unreferenced by any handler. Public holidays are computed from `feiertagejs` per request; don't wire new code into them.
- **Dates are stored ISO and formatted at render time** via `services/dates.ts`. Never put a raw `YYYY-MM-DD` in user-facing copy — German users read `19.03.2026`.
- Bolt handler param types are loose here: `(body as any).trigger_id`, `(body as any).view` etc. are the established idiom rather than fighting the union types.

## Deployment

Runs as a Docker container on an IONOS VM at `/root/slack-holiday-tracker` (root-owned; the SSH alias is `ionos-showcase`). `./scripts/deploy.sh` backs up the DB, pulls, rebuilds and verifies. Two things that bite:

- **`docker compose up -d --build` alone does not deploy.** It rebuilds the image, prints `Container holiday-tracker-bot Running`, and leaves the old container on the old image. `--force-recreate` is mandatory, and the deploy must verify the running container's image digest matches the freshly built one.
- **The SQLite database cannot be backed up by copying `holidays.db`.** WAL mode plus a long-lived connection means the main file stays near-empty (4 KB against a 704 KB WAL) and a copy of it opens cleanly as an empty database. Use `better-sqlite3`'s `.backup()`, which is safe against the live connection.

Full details, including rollback and the unrelated containers sharing that host, are in `docs/DEPLOYMENT.md`.

## Testing

Vitest, real in-memory SQLite (`new Database(":memory:")` + `initializeSchema` in `beforeEach`) — no DB mocking. Tests live in `__tests__/` next to the source. Coverage is on the services, the repositories, `schema.ts`, `i18n/t.ts`, and the view builders (`modals/__tests__/viewLimits.test.ts`, which renders every view in both languages against Slack's documented limits). Handlers are untested.
