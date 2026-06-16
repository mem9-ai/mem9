#!/bin/bash
# api-smoke-test-metadata.sh
# Smoke test: verifies user-supplied metadata round-trips through the
# messages + mode:smart ingest path and the content + pinned write path.
#
# Background: metadata was silently dropped in the messages/ingest path
# (GitHub issue #361). This test ensures both paths preserve metadata.
#
# Tests covered:
#   1. Provision tenant
#   2. POST messages with mode:smart + metadata → verify metadata in response
#   3. Poll until insight memory materialises
#   4. GET by ID — verify metadata matches what was sent
#   5. POST content with memory_type:pinned + metadata → verify metadata in response
#   6. GET by ID — verify metadata matches what was sent
#   7. Summary
#
# Usage:
#   bash e2e/api-smoke-test-metadata.sh
#   MNEMO_BASE=http://127.0.0.1:8080 bash e2e/api-smoke-test-metadata.sh
#   POLL_TIMEOUT_S=60 bash e2e/api-smoke-test-metadata.sh
set -euo pipefail

BASE="${MNEMO_BASE:-https://api.mem9.ai}"
AGENT_A="smoke-metadata-agent"
SESSION_ID="smoke-metadata-$(date +%s)"
POLL_TIMEOUT_S="${POLL_TIMEOUT_S:-60}"
POLL_INTERVAL_S=3
PASS=0
FAIL=0
TOTAL=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

info()  { echo -e "${CYAN}  →${RESET} $*"; }
ok()    { echo -e "${GREEN}  PASS${RESET} $*"; }
fail()  { echo -e "${RED}  FAIL${RESET} $*"; }
step()  { echo -e "\n${YELLOW}[$1]${RESET} $2"; }

curl_json() {
  curl -s --connect-timeout 5 --max-time 120 -w '\n__HTTP__%{http_code}' "$@"
}

http_code() { printf '%s' "$1" | grep '__HTTP__' | sed 's/__HTTP__//'; }
body()      { printf '%s' "$1" | grep -v '__HTTP__'; }

check() {
  local desc="$1" got="$2" want="$3"
  TOTAL=$((TOTAL+1))
  if [ "$got" = "$want" ]; then
    ok "$desc (got=$got)"
    PASS=$((PASS+1))
    return 0
  else
    fail "$desc — expected '$want', got '$got'"
    FAIL=$((FAIL+1))
    return 1
  fi
}

check_contains() {
  local desc="$1" haystack="$2" needle="$3"
  TOTAL=$((TOTAL+1))
  if printf '%s' "$haystack" | grep -q "$needle"; then
    ok "$desc (contains '$needle')"
    PASS=$((PASS+1))
    return 0
  else
    fail "$desc — '$needle' not found in: $haystack"
    FAIL=$((FAIL+1))
    return 1
  fi
}

curl_mem_json() {
  local url="$1"
  shift
  curl_json "$@" \
    -H "X-Mnemo-Agent-Id: $AGENT_A" \
    "$url"
}

echo "========================================================"
echo "  mem9 API smoke test — metadata preservation"
echo "  Base URL      : $BASE"
echo "  Session ID    : $SESSION_ID"
echo "  Poll timeout  : ${POLL_TIMEOUT_S}s"
echo "  Started       : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================================"

# ============================================================================
# TEST 1 — Provision tenant
# ============================================================================
step "1" "Provision fresh tenant"
resp=$(curl_json -X POST "$BASE/v1alpha1/mem9s")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "provision returns 201" "$code" "201"

TENANT_ID=$(printf '%s' "$bdy" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))")
if [ -z "$TENANT_ID" ]; then
  fail "failed to extract tenant ID from response: $bdy"
  exit 1
fi
ok "Tenant ID obtained"
MEM_BASE="$BASE/v1alpha1/mem9s/$TENANT_ID"

# ============================================================================
# TEST 2 — POST messages with mode:smart + metadata
# ============================================================================
METADATA_JSON='{"source_kind":"e2e-test","test_run":"metadata-smoke","occurred_at":"2026-01-01T00:00:00Z"}'

step "2" "POST messages with mode:smart + metadata"
resp=$(curl_mem_json "$MEM_BASE/memories" -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "agent_id": "'$AGENT_A'",
    "session_id": "'$SESSION_ID'",
    "mode": "smart",
    "sync": true,
    "messages": [
      {"role": "user", "content": "Please remember: the project codename is Nebula and it uses Rust for the backend."},
      {"role": "assistant", "content": "Got it. Project Nebula, backend in Rust. I will remember this."}
    ],
    "metadata": '"$METADATA_JSON"'
  }')
code=$(http_code "$resp")
bdy=$(body "$resp")

check "sync POST /memories returns 200" "$code" "200"
check_contains "response has status=ok" "$bdy" '"ok"'

# ============================================================================
# TEST 3 — Poll until insight memory materialises
# ============================================================================
step "3" "Poll until insight memory materialises (timeout=${POLL_TIMEOUT_S}s)"
INSIGHT_ID=""
ELAPSED=0
while [ "$ELAPSED" -lt "$POLL_TIMEOUT_S" ]; do
  list_resp=$(curl_mem_json "$MEM_BASE/memories?limit=50&memory_type=insight")
  list_code=$(http_code "$list_resp")
  list_bdy=$(body "$list_resp")

  if [ "$list_code" = "200" ]; then
    INSIGHT_ID=$(printf '%s' "$list_bdy" | python3 -c "
import sys, json
mems = json.load(sys.stdin).get('memories', [])
# Find the memory whose content contains 'Nebula'
for m in mems:
    if 'Nebula' in m.get('content', ''):
        print(m['id'])
        break
" 2>/dev/null || true)

    if [ -n "$INSIGHT_ID" ]; then
      info "Insight materialised after ~${ELAPSED}s (id=$INSIGHT_ID)"
      TOTAL=$((TOTAL+1))
      ok "Insight memory materialised within ${POLL_TIMEOUT_S}s"
      PASS=$((PASS+1))
      break
    fi
  fi

  sleep "$POLL_INTERVAL_S"
  ELAPSED=$((ELAPSED+POLL_INTERVAL_S))
done

if [ -z "$INSIGHT_ID" ]; then
  TOTAL=$((TOTAL+1))
  fail "Insight did NOT materialise within ${POLL_TIMEOUT_S}s"
  FAIL=$((FAIL+1))
fi

# ============================================================================
# TEST 4 — GET by ID — verify metadata matches
# ============================================================================
if [ -n "$INSIGHT_ID" ]; then
  step "4" "GET /memories/{id} — verify metadata on insight"
  get_resp=$(curl_mem_json "$MEM_BASE/memories/$INSIGHT_ID")
  get_code=$(http_code "$get_resp")
  get_bdy=$(body "$get_resp")

  check "GET by ID returns 200" "$get_code" "200"

  # Verify each metadata key matches what was sent.
  META_CHECK=$(printf '%s' "$get_bdy" | python3 -c "
import sys, json
m = json.load(sys.stdin)
meta = m.get('metadata')
if meta is None:
    print('NO_METADATA')
    sys.exit(0)

# Handle metadata as either dict or string
if isinstance(meta, str):
    import json as j
    meta = j.loads(meta)

errors = []
if meta.get('source_kind') != 'e2e-test':
    errors.append('source_kind mismatch: ' + str(meta.get('source_kind')))
if meta.get('test_run') != 'metadata-smoke':
    errors.append('test_run mismatch: ' + str(meta.get('test_run')))
if meta.get('occurred_at') != '2026-01-01T00:00:00Z':
    errors.append('occurred_at mismatch: ' + str(meta.get('occurred_at')))

if errors:
    print('FAIL: ' + '; '.join(errors))
else:
    print('OK')
")
  check "insight metadata matches sent values" "$META_CHECK" "OK"
fi

# ============================================================================
# TEST 5 — POST content with memory_type:pinned + metadata
# ============================================================================
step "5" "POST content with memory_type:pinned + metadata (control)"
resp=$(curl_mem_json "$MEM_BASE/memories" -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "content": "Pinned control: Nebula project pinned reference",
    "agent_id": "'$AGENT_A'",
    "memory_type": "pinned",
    "metadata": '"$METADATA_JSON"'
  }')
code=$(http_code "$resp")
bdy=$(body "$resp")

check "POST pinned returns 201" "$code" "201"

PINNED_ID=$(printf '%s' "$bdy" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))")

PINNED_META_CHECK=$(printf '%s' "$bdy" | python3 -c "
import sys, json
m = json.load(sys.stdin)
meta = m.get('metadata')
if meta is None:
    print('NO_METADATA')
    sys.exit(0)
if isinstance(meta, str):
    import json as j
    meta = j.loads(meta)
if meta.get('source_kind') == 'e2e-test' and meta.get('test_run') == 'metadata-smoke':
    print('OK')
else:
    print('FAIL: got ' + str(meta))
")
check "pinned response metadata matches sent values" "$PINNED_META_CHECK" "OK"

# ============================================================================
# TEST 6 — GET pinned by ID — verify metadata persisted
# ============================================================================
if [ -n "$PINNED_ID" ]; then
  step "6" "GET /memories/{id} — verify metadata on pinned memory"
  get_resp=$(curl_mem_json "$MEM_BASE/memories/$PINNED_ID")
  get_code=$(http_code "$get_resp")
  get_bdy=$(body "$get_resp")

  check "GET pinned by ID returns 200" "$get_code" "200"

  PINNED_GET_META_CHECK=$(printf '%s' "$get_bdy" | python3 -c "
import sys, json
m = json.load(sys.stdin)
meta = m.get('metadata')
if meta is None:
    print('NO_METADATA')
    sys.exit(0)
if isinstance(meta, str):
    import json as j
    meta = j.loads(meta)
if meta.get('source_kind') == 'e2e-test' and meta.get('test_run') == 'metadata-smoke':
    print('OK')
else:
    print('FAIL: got ' + str(meta))
")
  check "pinned GET metadata matches sent values" "$PINNED_GET_META_CHECK" "OK"
fi

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "========================================================"
echo "  RESULTS: $PASS / $TOTAL passed, $FAIL failed"
echo "  Tenant : $TENANT_ID"
if [ "$FAIL" -gt 0 ]; then
  echo -e "  ${RED}$FAIL test(s) failed.${RESET}"
else
  echo -e "  ${GREEN}All tests passed.${RESET}"
fi
echo "  Finished : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================================"
exit "$FAIL"
