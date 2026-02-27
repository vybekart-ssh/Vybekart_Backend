#!/usr/bin/env bash
# Run from directory that contains dist/main.js (repo root); works even if script lives in src/
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR"
while [ ! -f "$ROOT/dist/main.js" ] && [ "$ROOT" != "/" ]; do
  ROOT="$(cd "$ROOT/.." && pwd)"
done
if [ ! -f "$ROOT/dist/main.js" ]; then
  echo "ERROR: dist/main.js not found (searched from $SCRIPT_DIR)" >&2
  exit 1
fi
cd "$ROOT"
npx prisma migrate deploy
exec node dist/main.js
