#!/usr/bin/env bash
# Usage: scripts/exercise.sh <main-url> <submission-url>   (no trailing slashes)
# Exercises spike items 3-6 against a running stack (local `alchemy dev` or deployed workers.dev URLs).
set -euo pipefail
M=${1:?main url}; S=${2:?submission url}
echo "== POST /orgs"; R=$(curl -s -X POST "$M/orgs" -H 'content-type: application/json' -d '{"name":"Acme"}'); echo "$R"
ID=$(echo "$R" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
echo "== GET /orgs/$ID"; curl -s -w ' [%{http_code}]\n' "$M/orgs/$ID"
echo "== GET missing"; curl -s -w ' [%{http_code}]\n' "$M/orgs/00000000000000000000000000000000"
echo "== schema (WITHOUT ROWID? rowid select must fail)"; curl -s "$M/debug/orgs/$ID/schema" | python3 -m json.tool
echo "== transaction rollback"; curl -s -X POST "$M/debug/orgs/$ID/create-then-fail"; echo
echo "== arm alarm (3 s); it re-arms once for +30 s"; curl -s -X POST "$M/debug/orgs/$ID/arm-alarm?ms=3000"; echo
sleep 6; echo "alarm log after 6 s:"; curl -s "$M/debug/orgs/$ID/alarm-log"; echo
echo "== queue: ok message, then a failing one that must reach the DLQ consumer"
curl -s -X POST "$M/queue/send?id=ok1"; echo; curl -s -X POST "$M/queue/send?id=bad1&fail=1"; echo
sleep 20; echo "DLQ rows:"; curl -s "$M/debug/dlq"; echo
sleep 30; echo "alarm log after 36 s (expect 2 rows, then no more):"; curl -s "$M/debug/orgs/$ID/alarm-log"; echo
echo "== submission worker"; curl -s -i -X POST "$S/submit" -d 'x' | head -8
echo "== cold-start timing (first request is only cold if the isolate was idle)"
curl -s -o /dev/null -w 'total=%{time_total}s connect=%{time_connect}s ttfb=%{time_starttransfer}s\n' "$M/orgs/$ID"
