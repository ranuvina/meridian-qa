#!/usr/bin/env bash
# Runs every test layer and writes all reports to ./reports. Exit code is non-zero if any layer fails.
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p reports
status=0

echo "== Typecheck (API)"
(cd apps/api && npx tsc --noEmit -p tsconfig.json) || status=1

echo "== API: unit + integration + API layers, with coverage thresholds"
(cd apps/api && npx jest --ci --coverage) || status=1

echo "== End-to-end (Playwright)"
(cd e2e && npx playwright test) || status=1

node scripts/summarise-reports.mjs || true
exit $status
