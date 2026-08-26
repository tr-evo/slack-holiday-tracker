<p align="center">
  <img src="assets/bot-avatar.png" width="128" height="128" alt="Holiday Tracker Bot" />
</p>

<h1 align="center">Slack Holiday Tracker</h1>

<p align="center">
  A Slack bot for managing holiday requests and approvals — built with Slack Bolt, TypeScript, and SQLite.
</p>

<p align="center">
  <strong>Bilingual (DE/EN)</strong> &middot; <strong>No external server needed</strong> &middot; <strong>Docker-ready</strong>
</p>

---

## Features

- **Home tab** — balance, your requests, and who else is off, with nothing typed
- **Request holidays** with a live day count: see the cost, the public holidays it
  skips, and what it leaves you with *before* submitting
- **Cancel your own holiday** — withdraw a pending request, or cancel an approved
  one that has not started yet; admins are notified
- **Approve or reject with a reason**, with the requester's balance and any
  clashing absences shown alongside the decision
- **Admin views** — Approvals, People, and Settings, each saving only its own thing
- **Retroactive entries** — paste a year of history in German or ISO date formats
- **German public holidays** computed offline per Bundesland via `feiertagejs`
- **Bilingual (DE/EN)** per user, including localized date formatting
- Connects via **Socket Mode** (websocket) — no public URL or reverse proxy needed

## Quick Start

```bash
git clone https://github.com/tr-evo/slack-holiday-tracker.git
cd slack-holiday-tracker
npm install
cp .env.example .env
# Fill in your Slack tokens (see Setup Guide)
npm run dev
```

## Setup

See [docs/SETUP.md](docs/SETUP.md) for the full step-by-step guide covering:

1. Creating the Slack app and configuring scopes
2. Setting up the `/holiday` slash command
3. Configuring environment variables
4. Running locally or deploying with Docker
5. Setting the first admin user

### Required Slack Bot Scopes

| Scope | Purpose |
|---|---|
| `chat:write` | Send messages and notifications |
| `commands` | Slash command `/holiday` |
| `im:write` | DM users with approval updates |
| `users:read` | Populate user select menus |

## Deployment

```bash
docker compose up -d --build
```

The SQLite database is persisted in `./data/`. The bot connects outbound via websocket — no inbound ports needed.

## Tech Stack

- [Slack Bolt](https://slack.dev/bolt-js) — Slack app framework
- [TypeScript](https://www.typescriptlang.org/) — type-safe Node.js
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — embedded SQLite
- [feiertagejs](https://github.com/sfakir/feiertagejs) — German public holidays, computed offline

## Project Structure

```
src/
  app.ts                  # Entry point
  db/                     # Schema, connection, repositories
  handlers/               # Slash command, actions, admin, submissions, home tab
  modals/                 # Slack Block Kit view builders
  services/               # Business logic (allowances, dates, balances, caching)
  i18n/                   # Translation files (en.json, de.json)
```

## License

MIT
