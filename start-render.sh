#!/usr/bin/env bash
# Run from repo root so dist/ and prisma/ are found (Render may set CWD to src/)
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
npx prisma migrate deploy
exec node dist/main.js
