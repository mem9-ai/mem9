#!/bin/bash
# api-smoke-test-sessions.sh
# Session storage smoke test: verifies raw session write, deduplication,
# memory_type filtering, and metadata projection.
#
# Tests covered:
#   1. Provision tenant
#   2. Session write via messages — expect 202
#   3. Poll until sessions appear via memory_type=session filter
#   4. Unified search (no memory_type) excludes session rows
#   5. memory_type=session filter returns only sessions
#   6. memory_type=insight filter excludes sessions
#   7. Session metadata projection (role, seq, content_type in metadata field)
#   8. No-query list excludes sessions
#   9. session_id scoped filter
#  10. Deduplication — same messages sent twice produce no extra rows
#  11. Existing tenant: session write triggers lazy migration (requires MNEMO_EXISTING_TENANT_ID)
#  12. Existing tenant: poll + retry until sessions appear after lazy table creation
#  13. Existing tenant: memory_type=session filter works after migration
#
# Usage:
#   bash e2e/api-smoke-test-sessions.sh
#   MNEMO_BASE=https://api.mem9.ai bash e2e/api-smoke-test-sessions.sh
#   MNEMO_API_VERSION=v1alpha2 bash e2e/api-smoke-test-sessions.sh
#   POLL_TIMEOUT_S=60 bash e2e/api-smoke-test-sessions.sh
#   MNEMO_EXISTING_TENANT_ID=<id> bash e2e/api-smoke-test-sessions.sh
set -euo pipefail

BASE="${MNEMO_BASE:-https://api.mem9.ai}"
API_VERSION="${MNEMO_API_VERSION:-v1alpha1}"
AGENT_A="smoke-sessions-agent"
UNIQUE_MARKER="MNEMO_SESS_TEST_$(date +%s)"
SESSION_ID="smoke-sessions-${UNIQUE_MARKER}"
POLL_TIMEOUT_S="${POLL_TIMEOUT_S:-30}"
POLL_INTERVAL_S=2
EXISTING_TENANT_ID="${MNEMO_EXISTING_TENANT_ID:-}"
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
  curl -s --connect-timeout 5 --max-time 30 -w '\n__HTTP__%{http_code}' "$@"
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

  if [ "$API_VERSION" = "v1alpha2" ]; then
    curl_json "$@" \
      -H "X-Mnemo-Agent-Id: $AGENT_A" \
      -H "X-API-Key: $API_KEY" \
      "$url"
    return
  fi

  curl_json "$@" \
    -H "X-Mnemo-Agent-Id: $AGENT_A" \
    "$url"
}

echo "========================================================"
echo "  mnemos API smoke test — session storage"
echo "  Base URL      : $BASE"
echo "  API Mode      : $API_VERSION"
echo "  Session ID    : $SESSION_ID"
echo "  Unique marker : $UNIQUE_MARKER"
echo "  Poll timeout  : ${POLL_TIMEOUT_S}s"
echo "  Started       : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================================"

# ============================================================================
# TEST 1 — Provision tenant
# ============================================================================
step "1" "Provision tenant (POST /v1alpha1/mem9s)"
resp=$(curl_json -X POST "$BASE/v1alpha1/mem9s")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "POST /v1alpha1/mem9s returns 201" "$code" "201"

TENANT_ID=$(printf '%s' "$bdy" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || true)
if [ -z "$TENANT_ID" ]; then
  fail "Could not extract tenant ID — aborting."
  exit 1
fi
info "Tenant: $TENANT_ID"
API_KEY="$TENANT_ID"

if [ "$API_VERSION" = "v1alpha2" ]; then
  MEM_BASE="$BASE/v1alpha2/mem9s/memories"
  info "Using v1alpha2 header auth with X-API-Key"
else
  MEM_BASE="$BASE/v1alpha1/mem9s/$TENANT_ID/memories"
  info "Using v1alpha1 path auth with tenantID"
fi

# ============================================================================
# TEST 2 — Session write via messages
# ============================================================================
step "2" "Session write via messages (POST /memories with messages[])"
resp=$(curl_mem_json "$MEM_BASE" -X POST \
  -H "Content-Type: application/json" \
  -d "{
    \"messages\": [
      {\"role\": \"user\",      \"content\": \"$UNIQUE_MARKER what is mnemos?\"},
      {\"role\": \"assistant\", \"content\": \"mnemos is persistent memory for AI agents.\"},
      {\"role\": \"user\",      \"content\": \"$UNIQUE_MARKER does it use TiDB?\"},
      {\"role\": \"assistant\", \"content\": \"Yes, TiDB with hybrid vector and keyword search.\"}
    ],
    \"session_id\": \"$SESSION_ID\"
  }")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "POST /memories (messages) returns 202" "$code" "202"
check_contains "response has status=accepted" "$bdy" '"accepted"'

# ============================================================================
# TEST 3 — Poll until sessions appear via memory_type=session filter
# ============================================================================
step "3" "Poll until sessions appear via memory_type=session filter (timeout=${POLL_TIMEOUT_S}s)"
SESSION_APPEARED=false
ELAPSED=0
while [ "$ELAPSED" -lt "$POLL_TIMEOUT_S" ]; do
  list_resp=$(curl_mem_json "$MEM_BASE?q=${UNIQUE_MARKER}&memory_type=session&limit=10")
  list_code=$(http_code "$list_resp")
  list_bdy=$(body "$list_resp")

  if [ "$list_code" = "200" ]; then
    SESSION_COUNT=$(printf '%s' "$list_bdy" | python3 -c "
import sys, json
mems = json.load(sys.stdin).get('memories', [])
print(len(mems))
" 2>/dev/null || true)

    if [ -n "$SESSION_COUNT" ] && [ "$SESSION_COUNT" -gt 0 ]; then
      info "Sessions appeared after ~${ELAPSED}s (count=$SESSION_COUNT)"
      TOTAL=$((TOTAL+1))
      ok "Sessions materialised within ${POLL_TIMEOUT_S}s"
      PASS=$((PASS+1))
      SESSION_APPEARED=true
      break
    fi
  fi

  sleep "$POLL_INTERVAL_S"
  ELAPSED=$((ELAPSED+POLL_INTERVAL_S))
done

if [ "$SESSION_APPEARED" = "false" ]; then
  TOTAL=$((TOTAL+1))
  fail "Sessions did NOT appear within ${POLL_TIMEOUT_S}s — skipping session-dependent tests"
  FAIL=$((FAIL+1))
  echo ""
  echo "========================================================"
  echo "  RESULTS: $PASS / $TOTAL passed, $FAIL failed"
  echo "  Tenant : $TENANT_ID"
  echo -e "  ${RED}$FAIL test(s) failed.${RESET}"
  echo "  Finished : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "========================================================"
  exit "$FAIL"
fi

# ============================================================================
# TEST 4 — Unified search (no memory_type) includes session rows via recall
# Since PR #202 (enable raw session recall), unified recall intentionally
# includes session candidates alongside insights and pinned memories.
# ============================================================================
step "4" "Unified search (no memory_type): GET /memories?q= includes session rows via recall"
resp=$(curl_mem_json "$MEM_BASE?q=${UNIQUE_MARKER}&limit=20")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "GET /memories?q= returns 200" "$code" "200"

HAS_SESSION=$(printf '%s' "$bdy" | python3 -c "
import sys, json
mems = json.load(sys.stdin).get('memories', [])
print('yes' if any(m.get('memory_type') == 'session' for m in mems) else 'no')
" 2>/dev/null || true)
check "unified recall includes memory_type=session rows (PR #202)" "$HAS_SESSION" "yes"

# ============================================================================
# TEST 5 — memory_type=session filter returns ONLY sessions
# ============================================================================
step "5" "memory_type=session filter returns only sessions"
resp=$(curl_mem_json "$MEM_BASE?q=${UNIQUE_MARKER}&memory_type=session&limit=20")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "GET /memories?memory_type=session returns 200" "$code" "200"

SESSION_ONLY=$(printf '%s' "$bdy" | python3 -c "
import sys, json
mems = json.load(sys.stdin).get('memories', [])
if not mems:
    print('no-results')
elif all(m.get('memory_type') == 'session' for m in mems):
    print('yes')
else:
    non = [m.get('memory_type') for m in mems if m.get('memory_type') != 'session']
    print('no: found ' + str(non))
" 2>/dev/null || true)
check "all results have memory_type=session" "$SESSION_ONLY" "yes"

# ============================================================================
# TEST 6 — memory_type=insight filter excludes sessions
# ============================================================================
step "6" "memory_type=insight filter excludes sessions"
resp=$(curl_mem_json "$MEM_BASE?q=${UNIQUE_MARKER}&memory_type=insight&limit=20")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "GET /memories?memory_type=insight returns 200" "$code" "200"

HAS_SESSION_IN_INSIGHT=$(printf '%s' "$bdy" | python3 -c "
import sys, json
mems = json.load(sys.stdin).get('memories', [])
print('yes' if any(m.get('memory_type') == 'session' for m in mems) else 'no')
" 2>/dev/null || true)
check "insight filter has no memory_type=session rows" "$HAS_SESSION_IN_INSIGHT" "no"

# ============================================================================
# TEST 7 — Session metadata projection (role, seq, content_type)
# ============================================================================
step "7" "Session metadata projection: role, seq, content_type present"
resp=$(curl_mem_json "$MEM_BASE?q=${UNIQUE_MARKER}&memory_type=session&limit=10")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "GET /memories?memory_type=session returns 200" "$code" "200"

META_CHECK=$(printf '%s' "$bdy" | python3 -c "
import sys, json
mems = json.load(sys.stdin).get('memories', [])
if not mems:
    print('no-results')
    sys.exit()
m = mems[0]
meta = m.get('metadata')
if meta is None:
    print('no-metadata')
    sys.exit()
if isinstance(meta, str):
    import json as j
    meta = j.loads(meta)
missing = [f for f in ('role', 'seq', 'content_type') if f not in meta]
print('missing:' + ','.join(missing) if missing else 'ok')
" 2>/dev/null || true)
check "first session has role, seq, content_type in metadata" "$META_CHECK" "ok"

# ============================================================================
# TEST 8 — No-query list excludes sessions
# ============================================================================
step "8" "No-query list (GET /memories) excludes sessions"
resp=$(curl_mem_json "$MEM_BASE?limit=50")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "GET /memories (no ?q=) returns 200" "$code" "200"

HAS_SESSION_IN_LIST=$(printf '%s' "$bdy" | python3 -c "
import sys, json
mems = json.load(sys.stdin).get('memories', [])
print('yes' if any(m.get('memory_type') == 'session' for m in mems) else 'no')
" 2>/dev/null || true)
check "list without query has no memory_type=session rows" "$HAS_SESSION_IN_LIST" "no"

# ============================================================================
# TEST 9 — session_id scoped filter
# ============================================================================
step "9" "session_id scoped filter: GET /memories?session_id=&memory_type=session"
resp=$(curl_mem_json "$MEM_BASE?session_id=${SESSION_ID}&memory_type=session&q=${UNIQUE_MARKER}&limit=20")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "GET /memories?session_id=&memory_type=session returns 200" "$code" "200"

SESSION_SCOPED=$(printf '%s' "$bdy" | python3 -c "
import sys, json
mems = json.load(sys.stdin).get('memories', [])
if not mems:
    print('no-results')
    sys.exit()
wrong = [m.get('session_id') for m in mems if m.get('session_id') != '$SESSION_ID']
print('ok' if not wrong else 'wrong-sessions:' + str(wrong))
" 2>/dev/null || true)
check "all session_id-filtered results belong to session" "$SESSION_SCOPED" "ok"

# ============================================================================
# TEST 10 — Deduplication: sending the same messages twice produces no extra rows
# ============================================================================
step "10" "Deduplication: same messages sent twice produce no extra session rows"

resp=$(curl_mem_json "$MEM_BASE?q=${UNIQUE_MARKER}&memory_type=session&limit=100")
COUNT_BEFORE=$(body "$resp" | python3 -c "
import sys, json
print(len(json.load(sys.stdin).get('memories', [])))
" 2>/dev/null || true)
info "Session rows before re-send: $COUNT_BEFORE"

resp=$(curl_mem_json "$MEM_BASE" -X POST \
  -H "Content-Type: application/json" \
  -d "{
    \"messages\": [
      {\"role\": \"user\",      \"content\": \"$UNIQUE_MARKER what is mnemos?\"},
      {\"role\": \"assistant\", \"content\": \"mnemos is persistent memory for AI agents.\"},
      {\"role\": \"user\",      \"content\": \"$UNIQUE_MARKER does it use TiDB?\"},
      {\"role\": \"assistant\", \"content\": \"Yes, TiDB with hybrid vector and keyword search.\"}
    ],
    \"session_id\": \"$SESSION_ID\"
  }")
code=$(http_code "$resp")
check "second POST /memories (same messages) returns 202" "$code" "202"

sleep 3

resp=$(curl_mem_json "$MEM_BASE?q=${UNIQUE_MARKER}&memory_type=session&limit=100")
COUNT_AFTER=$(body "$resp" | python3 -c "
import sys, json
print(len(json.load(sys.stdin).get('memories', [])))
" 2>/dev/null || true)
info "Session rows after re-send: $COUNT_AFTER"

check "row count unchanged after duplicate send (dedup via content hash)" "$COUNT_AFTER" "$COUNT_BEFORE"

# ============================================================================
# TESTS 11-13 — Existing tenant: lazy sessions table migration
# Only runs when MNEMO_EXISTING_TENANT_ID is set.
# The tenant database must NOT have a sessions table yet (created before PR #103).
# On first request, EnsureSessionsTable fires in background (error 1146 is
# swallowed); subsequent writes succeed once the table exists. The test retries
# the write until sessions appear, proving the lazy migration path works end-to-end.
# ============================================================================
if [ -n "$EXISTING_TENANT_ID" ]; then
  echo ""
  echo "========================================================"
  echo "  Existing-tenant lazy migration tests"
  echo "  Tenant ID : $EXISTING_TENANT_ID"
  echo "========================================================"

  if [ "$API_VERSION" = "v1alpha2" ]; then
    EXIST_MEM_BASE="$BASE/v1alpha2/mem9s/memories"
  else
    EXIST_MEM_BASE="$BASE/v1alpha1/mem9s/$EXISTING_TENANT_ID/memories"
  fi

  curl_exist_json() {
    local url="$1"
    shift
    if [ "$API_VERSION" = "v1alpha2" ]; then
      curl_json "$@" \
        -H "X-Mnemo-Agent-Id: $AGENT_A" \
        -H "X-API-Key: $EXISTING_TENANT_ID" \
        "$url"
      return
    fi
    curl_json "$@" \
      -H "X-Mnemo-Agent-Id: $AGENT_A" \
      "$url"
  }

  EXIST_UNIQUE_MARKER="MNEMO_EXIST_SESS_$(date +%s)"
  EXIST_SESSION_ID="smoke-exist-sessions-${EXIST_UNIQUE_MARKER}"

  step "11" "Existing tenant: session write triggers lazy migration (POST /memories)"
  resp=$(curl_exist_json "$EXIST_MEM_BASE" -X POST \
    -H "Content-Type: application/json" \
    -d "{
      \"messages\": [
        {\"role\": \"user\",      \"content\": \"$EXIST_UNIQUE_MARKER lazy migration test\"},
        {\"role\": \"assistant\", \"content\": \"sessions table should be created in flight.\"}
      ],
      \"session_id\": \"$EXIST_SESSION_ID\"
    }")
  code=$(http_code "$resp")
  bdy=$(body "$resp")
  check "existing tenant POST /memories (messages) returns 202" "$code" "202"
  check_contains "response has status=accepted" "$bdy" '"accepted"'

  step "12" "Existing tenant: poll + retry writes until sessions appear (lazy table creation)"
  info "First write may be silently dropped (error 1146 swallowed) — retrying until table is ready"
  EXIST_SESSION_APPEARED=false
  ELAPSED=0
  while [ "$ELAPSED" -lt "$POLL_TIMEOUT_S" ]; do
    list_resp=$(curl_exist_json "$EXIST_MEM_BASE?q=${EXIST_UNIQUE_MARKER}&memory_type=session&limit=10")
    list_code=$(http_code "$list_resp")
    list_bdy=$(body "$list_resp")

    if [ "$list_code" = "200" ]; then
      EXIST_COUNT=$(printf '%s' "$list_bdy" | python3 -c "
import sys, json
print(len(json.load(sys.stdin).get('memories', [])))
" 2>/dev/null || true)
      if [ -n "$EXIST_COUNT" ] && [ "$EXIST_COUNT" -gt 0 ]; then
        info "Sessions appeared after ~${ELAPSED}s (count=$EXIST_COUNT)"
        TOTAL=$((TOTAL+1))
        ok "Existing tenant sessions materialised within ${POLL_TIMEOUT_S}s"
        PASS=$((PASS+1))
        EXIST_SESSION_APPEARED=true
        break
      fi
    fi

    resp=$(curl_exist_json "$EXIST_MEM_BASE" -X POST \
      -H "Content-Type: application/json" \
      -d "{
        \"messages\": [
          {\"role\": \"user\",      \"content\": \"$EXIST_UNIQUE_MARKER lazy migration test\"},
          {\"role\": \"assistant\", \"content\": \"sessions table should be created in flight.\"}
        ],
        \"session_id\": \"$EXIST_SESSION_ID\"
      }")

    sleep "$POLL_INTERVAL_S"
    ELAPSED=$((ELAPSED+POLL_INTERVAL_S))
  done

  if [ "$EXIST_SESSION_APPEARED" = "false" ]; then
    TOTAL=$((TOTAL+1))
    fail "Existing tenant sessions did NOT appear within ${POLL_TIMEOUT_S}s — lazy migration may have failed"
    FAIL=$((FAIL+1))
  fi

  step "13" "Existing tenant: session memory_type=session filter works after migration"
  resp=$(curl_exist_json "$EXIST_MEM_BASE?q=${EXIST_UNIQUE_MARKER}&memory_type=session&limit=10")
  code=$(http_code "$resp")
  bdy=$(body "$resp")
  check "existing tenant GET /memories?memory_type=session returns 200" "$code" "200"

  EXIST_SESSION_ONLY=$(printf '%s' "$bdy" | python3 -c "
import sys, json
mems = json.load(sys.stdin).get('memories', [])
if not mems:
    print('no-results')
elif all(m.get('memory_type') == 'session' for m in mems):
    print('yes')
else:
    non = [m.get('memory_type') for m in mems if m.get('memory_type') != 'session']
    print('no: found ' + str(non))
" 2>/dev/null || true)
  check "existing tenant: all results have memory_type=session" "$EXIST_SESSION_ONLY" "yes"
else
  info "MNEMO_EXISTING_TENANT_ID not set — skipping lazy migration tests (11-13)"
fi


echo ""
echo "========================================================"
echo "  RESULTS: $PASS / $TOTAL passed, $FAIL failed"
echo "  Base URL      : $BASE"
echo "  API Mode      : $API_VERSION"
echo "  Tenant        : $TENANT_ID"
echo "  Session       : $SESSION_ID"
if [ "$FAIL" -eq 0 ]; then
  echo -e "  ${GREEN}All tests passed.${RESET}"
else
  echo -e "  ${RED}$FAIL test(s) failed.${RESET}"
fi
echo "  Finished      : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================================"

exit "$FAIL"
