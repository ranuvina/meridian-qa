#!/usr/bin/env bash
# Runs every test layer and writes all reports to ./reports. Exit code is non-zero if any layer fails.
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p reports
status=0
run() { # run <name> <command...>
  local name=$1; shift
  echo "== $name"
  "$@"; local rc=$?
  echo "== RESULT $name: exit $rc"
  [ $rc -eq 0 ] || status=1
}

run "Typecheck (API)" bash -c "cd apps/api && ./node_modules/.bin/tsc --noEmit --pretty false -p tsconfig.json"
run "API: unit + integration + API layers, with coverage thresholds" bash -c "cd apps/api && ./node_modules/.bin/jest --ci --coverage"
run "End-to-end (Playwright)" bash -c "cd e2e && ./node_modules/.bin/playwright test"

node scripts/summarise-reports.mjs || true
exit $status
