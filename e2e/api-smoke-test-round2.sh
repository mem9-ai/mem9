#!/bin/bash
# api-smoke-test-round2.sh
# Round 2 smoke test: per-ID operations (GET, PUT, DELETE) and If-Match version check.
#
# Supports both v1alpha1 (tenant ID in path) and v1alpha2 (X-API-Key header).
#
# Strategy: POST a direct content write (async 202), then poll GET /memories until
# the memory materialises (up to POLL_TIMEOUT_S seconds). Once a known ID is in
# hand, run the per-ID suite deterministically.
#
# Tests covered:
#   1. Provision fresh tenant
#   2. Write a known memory (direct content, 202)
#   3. Poll until memory appears in list (retry loop)
#   4. GET by ID — verify content roundtrip
#   5. PUT update — verify version bump + field update
#   6. PUT with stale If-Match — expect 200 (LWW semantics)
#   7. DELETE — expect 204
#   8. GET after delete — expect 404
#   9. DELETE again (idempotent) — expect 204
#  10. Summary
#
# Usage:
#   bash e2e/api-smoke-test-round2.sh
#   MNEMO_BASE=https://api.mem9.ai bash e2e/api-smoke-test-round2.sh
#   MNEMO_API_VERSION=v1alpha2 bash e2e/api-smoke-test-round2.sh
#   POLL_TIMEOUT_S=30 bash e2e/api-smoke-test-round2.sh
set -euo pipefail

BASE="${MNEMO_BASE:-https://api.mem9.ai}"
API_VERSION="${MNEMO_API_VERSION:-v1alpha1}"
AGENT_A="smoke-r2-agent"
SESSION_ID="smoke-r2-$(date +%s)"
POLL_TIMEOUT_S="${POLL_TIMEOUT_S:-20}"
POLL_INTERVAL_S=1
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
  curl -s -w '\n__HTTP__%{http_code}' "$@"
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
echo "  mnemos API smoke test — Round 2 (per-ID operations)"
echo "  Base URL      : $BASE"
echo "  API Mode      : $API_VERSION"
echo "  Session       : $SESSION_ID"
echo "  Poll timeout  : ${POLL_TIMEOUT_S}s"
echo "  Started       : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================================"

# ============================================================================
# TEST 1 — Provision fresh tenant
# ============================================================================
step "1" "Provision fresh tenant (POST /v1alpha1/mem9s)"
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

KNOWN_CONTENT="The mnemos API smoke test round-2 uses a poll loop to wait for async memory creation. The session ID is $SESSION_ID and the server stores memories in TiDB with hybrid vector and keyword search."

# ============================================================================
# TEST 2 — Write a known memory (direct content write, async 202)
# ============================================================================
step "2" "Write known memory (POST /memories with content)"
resp=$(curl_mem_json "$MEM_BASE" -X POST \
  -H "Content-Type: application/json" \
  -d "{
    \"content\": \"$KNOWN_CONTENT\",
    \"tags\": [\"smoke\", \"round2\"],
    \"session_id\": \"$SESSION_ID\"
  }")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "POST /memories returns 202" "$code" "202"
check_contains "response has status=accepted" "$bdy" '"accepted"'

# ============================================================================
# TEST 3 — Poll until memory appears (retry loop)
# ============================================================================
step "3" "Poll GET /memories until memory materialises (timeout=${POLL_TIMEOUT_S}s)"
FIRST_MEM_ID=""
ELAPSED=0
while [ "$ELAPSED" -lt "$POLL_TIMEOUT_S" ]; do
  list_resp=$(curl_mem_json "$MEM_BASE?limit=50")
  list_code=$(http_code "$list_resp")
  list_bdy=$(body "$list_resp")

  if [ "$list_code" = "200" ]; then
    FIRST_MEM_ID=$(printf '%s' "$list_bdy" | python3 -c "
import sys, json
mems = json.load(sys.stdin).get('memories', [])
print(mems[0]['id'] if mems else '')
" 2>/dev/null || true)

    if [ -n "$FIRST_MEM_ID" ]; then
      info "Memory appeared after ~${ELAPSED}s — ID: $FIRST_MEM_ID"
      TOTAL=$((TOTAL+1))
      ok "Memory materialised within ${POLL_TIMEOUT_S}s"
      PASS=$((PASS+1))
      break
    fi
  fi

  sleep "$POLL_INTERVAL_S"
  ELAPSED=$((ELAPSED+POLL_INTERVAL_S))
done

if [ -z "$FIRST_MEM_ID" ]; then
  TOTAL=$((TOTAL+1))
  fail "Memory did NOT appear within ${POLL_TIMEOUT_S}s — skipping per-ID tests"
  FAIL=$((FAIL+1))
  echo ""
  echo "========================================================"
  echo "  RESULTS: $PASS / $TOTAL passed, $FAIL failed"
  echo "  Base URL : $BASE"
  echo "  API Mode : $API_VERSION"
  echo "  Tenant   : $TENANT_ID"
  echo -e "  ${RED}$FAIL test(s) failed.${RESET}"
  echo "  Finished : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "========================================================"
  exit "$FAIL"
fi

# ============================================================================
# TEST 4 — GET by ID: verify content roundtrip
# ============================================================================
step "4" "GET memory by ID"
resp=$(curl_mem_json "$MEM_BASE/$FIRST_MEM_ID")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "GET /{id} returns 200" "$code" "200"

GOT_ID=$(printf '%s' "$bdy" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
check "returned ID matches" "$GOT_ID" "$FIRST_MEM_ID"

ORIG_VERSION=$(printf '%s' "$bdy" | python3 -c "import sys,json; print(json.load(sys.stdin).get('version',''))" 2>/dev/null || true)
check_contains "response has content field" "$bdy" '"content"'
info "Version: $ORIG_VERSION"

# ============================================================================
# TEST 5 — PUT update: verify version bump and field changes
# ============================================================================
step "5" "PUT update — verify version bump + tag update"
UPDATED_CONTENT="$KNOWN_CONTENT (updated)"
resp=$(curl_mem_json "$MEM_BASE/$FIRST_MEM_ID" -X PUT \
  -H "Content-Type: application/json" \
  -d "{
    \"content\": \"$UPDATED_CONTENT\",
    \"tags\": [\"smoke\", \"round2\", \"updated\"]
  }")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "PUT /{id} returns 200" "$code" "200"

UPD_VERSION=$(printf '%s' "$bdy" | python3 -c "import sys,json; print(json.load(sys.stdin).get('version',''))" 2>/dev/null || true)
TOTAL=$((TOTAL+1))
if [ -n "$UPD_VERSION" ] && [ "$UPD_VERSION" -gt "$ORIG_VERSION" ]; then
  ok "version advanced beyond $ORIG_VERSION (got=$UPD_VERSION)"
  PASS=$((PASS+1))
else
  fail "version did not advance — pre-PUT=$ORIG_VERSION, post-PUT=$UPD_VERSION"
  FAIL=$((FAIL+1))
fi
check_contains "updated content present" "$bdy" "(updated)"
check_contains "new tag present" "$bdy" '"updated"'

ETAG=$(printf '%s' "$resp" | grep -i 'ETag:' | tr -d '\r' | awk '{print $2}' || true)
info "ETag after update: ${ETAG:-<not captured from body>}"

# ============================================================================
# TEST 6 — PUT with stale If-Match: LWW semantics (write proceeds, 200)
# If-Match is advisory only — server logs a warning but applies LWW and
# returns 200. This is intentional design; no hard conflict rejection.
# ============================================================================
step "6" "PUT with stale If-Match — LWW: write still succeeds (200)"
STALE_VERSION=$((ORIG_VERSION))
LWW_CONTENT="lww overwrite via stale If-Match"
resp=$(curl_mem_json "$MEM_BASE/$FIRST_MEM_ID" -X PUT \
  -H "Content-Type: application/json" \
  -H "If-Match: $STALE_VERSION" \
  -d "{
    \"content\": \"$LWW_CONTENT\",
    \"tags\": [\"smoke\", \"lww\"]
  }")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "PUT with stale If-Match returns 200 (LWW)" "$code" "200"

LWW_VERSION=$(printf '%s' "$bdy" | python3 -c "import sys,json; print(json.load(sys.stdin).get('version',''))" 2>/dev/null || true)
TOTAL=$((TOTAL+1))
if [ -n "$LWW_VERSION" ] && [ "$LWW_VERSION" -gt "$UPD_VERSION" ]; then
  ok "version advanced beyond $UPD_VERSION (got=$LWW_VERSION)"
  PASS=$((PASS+1))
else
  fail "version did not advance — pre-LWW=$UPD_VERSION, post-LWW=$LWW_VERSION"
  FAIL=$((FAIL+1))
fi
check_contains "LWW content applied" "$bdy" "lww overwrite"

# ============================================================================
# TEST 7 — DELETE: expect 204
# ============================================================================
step "7" "DELETE memory — expect 204"
resp=$(curl_mem_json "$MEM_BASE/$FIRST_MEM_ID" -X DELETE)
code=$(http_code "$resp")
check "DELETE /{id} returns 204" "$code" "204"

# ============================================================================
# TEST 8 — GET after delete: expect 404
# ============================================================================
step "8" "GET deleted memory — expect 404"
resp=$(curl_mem_json "$MEM_BASE/$FIRST_MEM_ID")
code=$(http_code "$resp")
check "GET deleted memory returns 404" "$code" "404"

# ============================================================================
# TEST 9 — DELETE again (idempotent) — expect 204
# SoftDelete is a no-op when state is already 'deleted'; returns 204 (not 404).
# ============================================================================
step "9" "DELETE again (idempotent) — expect 204 (already-deleted is no-op)"
resp=$(curl_mem_json "$MEM_BASE/$FIRST_MEM_ID" -X DELETE)
code=$(http_code "$resp")
check "second DELETE returns 204 (idempotent no-op)" "$code" "204"

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "========================================================"
echo "  RESULTS: $PASS / $TOTAL passed, $FAIL failed"
echo "  Base URL : $BASE"
echo "  API Mode : $API_VERSION"
echo "  Tenant   : $TENANT_ID"
if [ "$FAIL" -eq 0 ]; then
  echo -e "  ${GREEN}All tests passed.${RESET}"
else
  echo -e "  ${RED}$FAIL test(s) failed.${RESET}"
fi
echo "  Finished : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================================"

exit "$FAIL"
