# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Slack bot for managing employee holiday/vacation requests. Built with Slack Bolt (socket mode), SQLite (better-sqlite3), and TypeScript. Bilingual (EN/DE) with per-user language preference.

## Commands

```bash
npm run dev          # Dev mode with hot reload (tsx watch)
npm run build        # Compile TypeScript to dist/
npm start            # Run compiled app (dist/app.js)
npm test             # Run all tests (vitest)
npm run test:watch   # Run tests in watch mode
npx vitest run src/services/__tests__/allowance.test.ts  # Run a single test file
```

Docker: `docker compose up -d --build`

## Architecture

**Layered design:** Handlers → Services → Repositories → SQLite

```
src/
├── app.ts                    # Entry point: init DB, register handlers, start socket mode
├── handlers/                 # Slack event handlers (slash commands, actions, modals, admin)
│   ├── holiday.ts            # /holiday slash command routing
│   ├── actions.ts            # Button clicks, menu selections
│   ├── submissions.ts        # Modal form submissions (validates dates, checks allowance)
│   └── admin.ts              # Admin panel (manage users, import holidays, settings)
├── modals/                   # Slack Block Kit modal JSON builders
├── services/                 # Pure business logic
│   ├── allowance.ts          # Business day counting, holiday balance calculations
│   └── publicHolidays.ts     # Fetches German public holidays from feiertage-api.de
├── db/
│   ├── connection.ts         # SQLite connection singleton (WAL mode, foreign keys)
│   ├── schema.ts             # Schema creation + column migrations via ALTER TABLE
│   └── repositories/         # Data access layer (userRepo, requestRepo, etc.)
└── i18n/                     # Translation system: t(key, lang, params)
    ├── t.ts                  # Lookup function with English fallback
    ├── en.json               # English strings
    └── de.json               # German strings
```

### Key patterns

- **Socket mode**: Outbound websocket only, no public URL needed.
- **Slash command**: `/holiday [request|balance|list|public]` — no args opens a main menu modal.
- **Admin notifications**: When a user submits a request, all admins receive a DM with approve/reject buttons.
- **DMs**: Use `conversations.open` to get a DM channel ID before posting.
- **Schema migrations**: Done inline in `schema.ts` using `pragma table_info` checks + `ALTER TABLE`. No migration framework.
- **Settings table**: Key-value store for app-wide config (default_allowance, carryover_enabled, carryover_cutoff).
- **Carryover**: Holiday days from prior year, with configurable cutoff date (default March 31). After cutoff, carryover returns 0.

## Database

SQLite at path from `DB_PATH` env var (default `./data/holidays.db`). Four tables: `users`, `holiday_requests`, `public_holidays`, `settings`. See `src/db/schema.ts` for full schema.

## Environment Variables

See `.env.example`. Required: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET`. Optional: `DB_PATH`, `DEFAULT_ALLOWANCE`.

## Testing

Vitest with in-memory SQLite for DB tests. Test files live in `__tests__/` subdirectories next to source. No mocking of the database — tests use real in-memory SQLite instances.
