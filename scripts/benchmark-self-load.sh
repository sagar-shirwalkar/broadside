#!/usr/bin/env bash
set -euo pipefail

# Full self-load benchmark profile:
# - exercises API under load while Broadside ingests/stores metrics and serves dashboard/SSE
# - on Docker Desktop/localhost this may hit loopback/socket limits before app limits

BASE_URL="${BASE_URL:-http://localhost:3000}"
SCRIPT="${SCRIPT:-load-tests/ramp-sessions.yml}"

echo "== Broadside full self-load benchmark =="
echo "BASE_URL=$BASE_URL"
echo "SCRIPT=$SCRIPT"
echo
echo "Pre-check /livez and /readyz:"
curl -fsS "$BASE_URL/livez" || true
echo
curl -fsS "$BASE_URL/readyz" || true
echo
echo "Start run via API (example):"
echo "curl -s -X POST $BASE_URL/api/runs -H 'content-type: application/json' -d '{\"script_path\":\"$SCRIPT\"}'"
echo
echo "During run, sample readiness telemetry:"
echo "curl -fsS $BASE_URL/readyz | jq '.flusher'"
echo
echo "Compare against scripts/benchmark-clean-baseline.sh to separate server capacity from ingest/loopback contention."
