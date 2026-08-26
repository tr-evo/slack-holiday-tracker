# Deployment

The bot runs as a Docker container on the IONOS VM, alongside several unrelated
projects. It connects outbound over a websocket, so nothing is exposed and no
reverse proxy or port mapping is involved.

## The target

| | |
|---|---|
| SSH alias | `ionos-showcase` (in `~/.ssh/config`) |
| Host | `212.227.180.167`, user `deploy`, key `~/.ssh/respeak-ionos-showcase` |
| Checkout | `/root/slack-holiday-tracker` — **root-owned**, so every command needs `sudo` |
| Compose project | `slack-holiday-tracker` |
| Container | `holiday-tracker-bot`, `restart: unless-stopped` |
| Data | named volume `slack-holiday-tracker_bot-data` → `/app/data` |
| Remote | pulls `main` from `https://github.com/tr-evo/slack-holiday-tracker.git` |

`.env` lives at `/root/slack-holiday-tracker/.env` on the server only. It is
gitignored and is **not** part of a deploy — a fresh checkout needs it copied in
by hand or the container will start and immediately fail to authenticate.

The `deploy` user has passwordless sudo. Because the checkout is root-owned,
even `cd` into it fails without sudo, so the whole remote script runs as root:
`ssh ionos-showcase 'sudo bash -s' <<'EOF' … EOF`.

## Deploying

```bash
./scripts/deploy.sh
```

That backs up the database, pulls `main`, rebuilds, force-recreates the
container, and verifies the result. To do it by hand:

```bash
ssh ionos-showcase 'sudo bash -s' <<'REMOTE'
cd /root/slack-holiday-tracker
git fetch origin main && git reset --hard origin/main
docker compose up -d --build --force-recreate
docker logs holiday-tracker-bot --since 2m
REMOTE
```

### `--force-recreate` is not optional

`docker compose up -d --build` alone **silently does not deploy**. It rebuilds
the image, prints `Container holiday-tracker-bot Running`, and leaves the old
container in place on the old image. The output looks like success. Always pass
`--force-recreate`, and always verify afterwards that the container's image
digest matches the image that was just built:

```bash
ssh ionos-showcase 'sudo docker images slack-holiday-tracker_holiday-bot --format "{{.ID}}"'
ssh ionos-showcase 'sudo docker inspect holiday-tracker-bot --format "{{.Image}}"'
```

`--force-recreate` does not touch the named volume. Only `docker compose down -v`
would delete the database, so never use `-v` here.

## Backups

**Never back up by copying `holidays.db`.** The database runs in WAL mode with a
long-lived connection, and the WAL is not checkpointed while the bot is running.
At the time of writing `holidays.db` was 4 KB and `holidays.db-wal` was 704 KB —
copying only the first file yields an empty database that still opens cleanly.

Use SQLite's online backup API, which is safe against a live database:

```bash
ssh ionos-showcase 'sudo bash -s' <<'REMOTE'
TS=$(date +%Y%m%d-%H%M%S)
docker exec holiday-tracker-bot node -e '
  const D = require("better-sqlite3");
  new D("/app/data/holidays.db", { readonly: true })
    .backup(process.argv[1])
    .then(() => process.exit(0));
' "/app/data/predeploy-$TS.db"
mkdir -p /root/backups
docker cp "holiday-tracker-bot:/app/data/predeploy-$TS.db" "/root/backups/predeploy-$TS.db"
docker exec holiday-tracker-bot rm -f "/app/data/predeploy-$TS.db"
REMOTE
```

`scripts/deploy.sh` does this on every run. Backups accumulate in
`/root/backups/`; it keeps the 10 most recent.

## Rolling back

Code only — the database is untouched by a normal deploy:

```bash
ssh ionos-showcase 'sudo bash -s' <<'REMOTE'
cd /root/slack-holiday-tracker
git reset --hard <previous-sha>
docker compose up -d --build --force-recreate
REMOTE
```

Restoring data, if a deploy ever corrupts it:

```bash
ssh ionos-showcase 'sudo bash -s' <<'REMOTE'
cd /root/slack-holiday-tracker
docker compose stop
docker run --rm -v slack-holiday-tracker_bot-data:/data -v /root/backups:/b alpine \
  sh -c 'rm -f /data/holidays.db /data/holidays.db-wal /data/holidays.db-shm &&
         cp /b/predeploy-YYYYMMDD-HHMMSS.db /data/holidays.db'
docker compose up -d
REMOTE
```

Deleting the stale `-wal` and `-shm` alongside the old database matters: leaving
them next to a restored file makes SQLite replay a WAL that no longer matches.

## Checking a deploy worked

```bash
ssh ionos-showcase 'sudo docker logs holiday-tracker-bot --since 5m'
```

Expect `Holiday Tracker bot is running!`. There is no healthcheck and no HTTP
endpoint, so that log line plus a working `/holiday` in Slack is the signal.

Slack-side configuration is separate from deploys and is not in this repo — the
Home tab needs *App Home → Home Tab* plus the `app_home_opened` bot event, as
described in [SETUP.md](SETUP.md#5a-enable-the-home-tab--required). Changing
those does not require a redeploy.

## Other things on this host

`docker ps` shows unrelated containers (traefik, hoppscotch, fom-*, chartdb,
recap, reinickendorf-voice-demo). Always scope commands to the
`holiday-tracker-bot` container or the `slack-holiday-tracker` compose project —
a bare `docker compose down` from the wrong directory, or a `docker system
prune`, would take other projects with it.
