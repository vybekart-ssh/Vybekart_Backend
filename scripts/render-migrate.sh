#!/usr/bin/env sh
# Render / Docker entry: recover from P3009 (failed duplicate migration), then deploy, seed, start Nest.
set -e

# Duplicate `20260405134556_user_push_stream_reminder` failed after `20260405134500_*` had already
# applied the same schema. Mark the failed record rolled back so `migrate deploy` can apply the no-op SQL.
if npx prisma migrate resolve --rolled-back "20260405134556_user_push_stream_reminder" 2>/dev/null; then
  echo "render-migrate: cleared failed migration 20260405134556_user_push_stream_reminder"
else
  echo "render-migrate: no failed migration to resolve (normal after first successful deploy)"
fi

npx prisma migrate deploy

if [ "${RUN_DUMMY_SEED_ON_DEPLOY:-true}" = "true" ]; then
  node /app/prisma/seed-dummy.js
fi

exec node /app/dist/src/main.js
