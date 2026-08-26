#!/usr/bin/env bash
#
# Deploy main to the IONOS VM. See docs/DEPLOYMENT.md.
#
#   ./scripts/deploy.sh            # deploy origin/main
#   ./scripts/deploy.sh <sha>      # deploy or roll back to a specific commit
#
# Backs up the database first, then pulls, rebuilds, force-recreates and
# verifies. Refuses to continue if the container does not come up on the image
# that was just built — `docker compose up --build` alone silently leaves the
# old container running.
set -euo pipefail

HOST=${DEPLOY_HOST:-ionos-showcase}
REF=${1:-origin/main}

echo "==> deploying '${REF}' to ${HOST}"

ssh -o ConnectTimeout=20 "${HOST}" "sudo REF='${REF}' bash -s" <<'REMOTE'
set -euo pipefail
cd /root/slack-holiday-tracker

CONTAINER=holiday-tracker-bot
IMAGE=slack-holiday-tracker_holiday-bot

say() { printf '\n--- %s ---\n' "$1"; }

say "backing up the database"
# WAL mode: copying holidays.db alone yields an EMPTY database. Use the online
# backup API, which is also safe against the running connection.
TS=$(date +%Y%m%d-%H%M%S)
docker exec "$CONTAINER" node -e '
  const D = require("better-sqlite3");
  new D("/app/data/holidays.db", { readonly: true })
    .backup(process.argv[1])
    .then(() => { console.log("backup ok"); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
' "/app/data/predeploy-$TS.db"
mkdir -p /root/backups
docker cp "$CONTAINER:/app/data/predeploy-$TS.db" "/root/backups/predeploy-$TS.db"
docker exec "$CONTAINER" rm -f "/app/data/predeploy-$TS.db"
echo "saved /root/backups/predeploy-$TS.db ($(stat -c%s "/root/backups/predeploy-$TS.db") bytes)"
ls -1t /root/backups/predeploy-*.db 2>/dev/null | tail -n +11 | xargs -r rm -f

BEFORE_ROWS=$(docker exec "$CONTAINER" node -e '
  const D = require("better-sqlite3");
  process.stdout.write(String(new D("/app/data/holidays.db",{readonly:true})
    .prepare("SELECT COUNT(*) c FROM holiday_requests").get().c));')

say "checking out $REF"
git fetch origin --quiet
git reset --hard "$REF" --quiet
git --no-pager log --oneline -1

say "building and recreating"
# --force-recreate is required: without it compose rebuilds the image, prints
# "Running", and leaves the old container on the old image.
docker compose up -d --build --force-recreate 2>&1 | tail -5
sleep 6

say "verifying"
NEW_IMAGE=$(docker images "$IMAGE" --no-trunc --format '{{.ID}}' | head -1)
RUNNING_IMAGE=$(docker inspect "$CONTAINER" --format '{{.Image}}')
if [ "$NEW_IMAGE" != "$RUNNING_IMAGE" ]; then
  echo "FAILED: container is on $RUNNING_IMAGE but the build produced $NEW_IMAGE" >&2
  exit 1
fi
echo "image:  $RUNNING_IMAGE"

STATUS=$(docker inspect "$CONTAINER" --format '{{.State.Status}}')
[ "$STATUS" = "running" ] || { echo "FAILED: container is $STATUS" >&2; docker logs "$CONTAINER" --tail 40; exit 1; }
echo "status: $STATUS"

AFTER=$(docker exec "$CONTAINER" node -e '
  const D = require("better-sqlite3");
  const db = new D("/app/data/holidays.db", { readonly: true });
  console.log(JSON.stringify({
    requests: db.prepare("SELECT COUNT(*) c FROM holiday_requests").get().c,
    users: db.prepare("SELECT COUNT(*) c FROM users").get().c,
    integrity: db.pragma("integrity_check")[0].integrity_check,
  }));')
echo "data:   $AFTER"
echo "$AFTER" | grep -q '"integrity":"ok"' || { echo "FAILED: integrity check" >&2; exit 1; }

AFTER_ROWS=$(echo "$AFTER" | sed -E 's/.*"requests":([0-9]+).*/\1/')
if [ "$AFTER_ROWS" -lt "$BEFORE_ROWS" ]; then
  echo "FAILED: request count dropped from $BEFORE_ROWS to $AFTER_ROWS" >&2
  exit 1
fi

say "logs"
docker logs "$CONTAINER" --since 3m 2>&1 | tail -10
docker logs "$CONTAINER" --since 3m 2>&1 | grep -q "bot is running" \
  || { echo "FAILED: no startup line in logs" >&2; exit 1; }

printf '\n==> deployed: %s\n' "$(git --no-pager log --oneline -1)"
REMOTE
