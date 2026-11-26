#!/usr/bin/env bash
set -euo pipefail

# Clean baseline self-benchmark profile (server capacity focus):
# - hits a cheap endpoint
# - connection reuse enabled in Artillery script (use tuned script)
# - compare results against full self-load runs with ingest/dashboard/DB activity

BASE_URL="${BASE_URL:-http://localhost:3000}"
SCRIPT="${SCRIPT:-load-tests/load-test.yml}"

echo "== Broadside clean baseline benchmark =="
echo "BASE_URL=$BASE_URL"
echo "SCRIPT=$SCRIPT"
echo
echo "Pre-check /livez and /readyz:"
curl -fsS "$BASE_URL/livez" || true
echo
curl -fsS "$BASE_URL/readyz" || true
echo
echo "Run with: artillery run $SCRIPT --target $BASE_URL"
echo "Tip: for a minimal-DB path, target /livez (or /api/health/live) instead of endpoints that trigger heavier work."
