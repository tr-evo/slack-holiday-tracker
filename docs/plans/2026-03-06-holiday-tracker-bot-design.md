# Slack Holiday Tracker Bot — Design

## Overview

A Slack bot for tracking team holidays. Employees can request time off, view their remaining allowance, and receive approval notifications. Admins approve/reject requests. English-first with German language support.

## Architecture

- **Stack:** Node.js/TypeScript, Slack Bolt (Socket Mode), SQLite
- **Deployment:** Docker container on IONOS VM
- **Connectivity:** Socket Mode (outbound websocket only) — no inbound HTTP, no Traefik changes needed
- **Persistence:** SQLite file on a Docker volume

```
Slack API <--websocket--> Bolt App (Socket Mode) --> SQLite (Docker volume)
```

## Data Model

### users
| Column | Type | Notes |
|--------|------|-------|
| slack_id | TEXT PK | Slack user ID |
| name | TEXT | Display name |
| annual_allowance | INTEGER | Default 30 |
| language | TEXT | "en" or "de", default "en" |
| is_admin | BOOLEAN | Default false |

### holiday_requests
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| user_id | TEXT FK | References users.slack_id |
| start_date | DATE | |
| end_date | DATE | |
| half_day_start | BOOLEAN | Afternoon only on start date |
| half_day_end | BOOLEAN | Morning only on end date |
| status | TEXT | pending / approved / rejected |
| approved_by | TEXT | Slack ID of approver |
| reason | TEXT | Optional note from requester |
| reviewer_comment | TEXT | Optional note from approver |
| created_at | DATETIME | |

### public_holidays
| Column | Type | Notes |
|--------|------|-------|
| date | DATE PK | |
| name | TEXT | English name |
| name_de | TEXT | German name |

### settings
| Column | Type | Notes |
|--------|------|-------|
| key | TEXT PK | Setting name |
| value | TEXT | Setting value |

### Allowance Calculation

Remaining = annual_allowance - sum of approved request days

Each request's day count:
- Count business days (Mon-Fri) between start_date and end_date inclusive
- Subtract public holidays falling in that range
- Subtract 0.5 if half_day_start is true
- Subtract 0.5 if half_day_end is true

## User Interactions

### Slash Commands
- `/holiday` — Opens the main menu modal
- `/holiday request` — Opens the request modal directly
- `/holiday balance` — Shows remaining days (ephemeral message)
- `/holiday list` — Shows upcoming/past requests

### Modals
- **Request modal** — Date pickers (start/end), half-day checkboxes, optional reason
- **Admin panel modal** — Manage users (set allowance, toggle admin), view/approve/reject pending requests
- **Approval modal** — Request details with approve/reject buttons and optional comment

### Notifications
- Employee receives a DM when their request is approved or rejected
- All admins receive a DM with approve/reject action buttons when a new request is submitted

### Internationalization
- `/holiday language` command or setting in main menu to toggle en/de
- All bot messages and modals render in the user's chosen language
- Translation files: simple JSON key-value maps per language

## Phase 2: Holiday Notifications (Low Priority)

Not part of initial build. To be added later:

- Daily morning message to a configurable channel listing who's out today
- Weekly summary (Monday morning) showing who's out this week
- Both optional, toggled via admin settings
- Implementation: cron job inside the app querying approved requests

## Configuration Defaults

- Default annual allowance: 30 days
- Default language: English
- Admins: manually set via bot command or direct DB
