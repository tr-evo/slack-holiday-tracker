# Holiday Tracker Bot — Setup Guide

## 1. Create Slack App

1. Go to https://api.slack.com/apps and click **Create New App** > **From scratch**
2. Name it (e.g., "Holiday Tracker") and select your workspace

## 2. Enable Socket Mode

1. Go to **Settings** > **Socket Mode**
2. Toggle **Enable Socket Mode** on
3. Create an App-Level Token with the `connections:write` scope
4. Save the token (`xapp-...`) — this is your `SLACK_APP_TOKEN`

## 3. Add Bot Scopes

1. Go to **Features** > **OAuth & Permissions**
2. Under **Bot Token Scopes**, add:
   - `chat:write` — send messages
   - `commands` — slash commands
   - `im:write` — DM users
   - `users:read` — read user info

## 4. Create Slash Command

1. Go to **Features** > **Slash Commands**
2. Click **Create New Command**
   - Command: `/holiday`
   - Description: "Open the holiday tracker"
   - Usage hint: `[request | balance | list]`

## 5. Enable Interactivity

1. Go to **Features** > **Interactivity & Shortcuts**
2. Toggle **Interactivity** on (no URL needed for Socket Mode)

## 6. Install to Workspace

1. Go to **Settings** > **Install App**
2. Click **Install to Workspace** and authorize
3. Copy the **Bot User OAuth Token** (`xoxb-...`) — this is your `SLACK_BOT_TOKEN`

## 7. Get Signing Secret

1. Go to **Settings** > **Basic Information**
2. Under **App Credentials**, copy the **Signing Secret** — this is your `SLACK_SIGNING_SECRET`

## 8. Configure Environment

```bash
cp .env.example .env
```

Fill in your `.env`:
```
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...
DB_PATH=./data/holidays.db
DEFAULT_ALLOWANCE=30
```

## 9. Run Locally

```bash
npm install
npx tsx src/app.ts
```

## 10. Deploy with Docker

```bash
# On your server, with .env file in place:
docker compose up -d --build
```

The bot connects outbound via websocket — no inbound ports or reverse proxy config needed.

## 11. Set First Admin

After running any `/holiday` command once (to register your user), set yourself as admin:

```bash
# Local
sqlite3 data/holidays.db "UPDATE users SET is_admin = 1 WHERE slack_id = 'YOUR_SLACK_ID';"

# Docker
docker compose exec holiday-bot sh -c "apk add sqlite && sqlite3 /app/data/holidays.db \"UPDATE users SET is_admin = 1 WHERE slack_id = 'YOUR_SLACK_ID';\""
```

Find your Slack ID: click your profile picture in Slack > **Profile** > **...** > **Copy member ID**.
