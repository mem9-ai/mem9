#!/bin/bash
# api-smoke-test-existing-tenant.sh
# Backward-compatibility smoke test: verifies that a pre-existing tenant and
# its stored memories continue to work correctly after a server upgrade.
#
# Unlike the other smoke scripts, this test does NOT provision a new tenant.
# It requires a tenant that was created before the current deployment so that
# the full read/write lifecycle is proven against real, pre-existing data.
#
# Tests covered:
#   1. v1alpha1: List existing memories — tenant has data
#   2. v1alpha2: List same tenant via X-API-Key — same result
#   3. v1alpha1: GET by ID — content roundtrip
#   4. v1alpha2: GET by ID — matches v1alpha1
#   5. v1alpha1: Search by query (?q=)
#   6. v1alpha2: Search by query (?q=)
#   7. v1alpha1: Tag filter (?tags=)
#   8. v1alpha1: PUT update — version bump + tag change
#   9. v1alpha2: PUT update — version bump + tag change
#  10. Write new memory via v1alpha1 (async 202)
#  11. Write new memory via v1alpha2 (async 202)
#  12. Poll until new memories materialise
#  13. Summary
#
# Usage:
#   MNEMO_EXISTING_TENANT_ID=<id> bash e2e/api-smoke-test-existing-tenant.sh
#   MNEMO_BASE=http://my-dev-alb MNEMO_EXISTING_TENANT_ID=<id> bash e2e/api-smoke-test-existing-tenant.sh
#   POLL_TIMEOUT_S=60 MNEMO_EXISTING_TENANT_ID=<id> bash e2e/api-smoke-test-existing-tenant.sh
set -euo pipefail

BASE="${MNEMO_BASE:-https://api.mem9.ai}"
TENANT_ID="${MNEMO_EXISTING_TENANT_ID:-}"
POLL_TIMEOUT_S="${POLL_TIMEOUT_S:-30}"
POLL_INTERVAL_S=2
AGENT_ID="smoke-compat-agent"
SESSION_ID="smoke-compat-$(date +%s)"
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

check_gt() {
  local desc="$1" got="$2" want="$3"
  TOTAL=$((TOTAL+1))
  if [ -n "$got" ] && [ "$got" -gt "$want" ]; then
    ok "$desc (got=$got > $want)"
    PASS=$((PASS+1))
    return 0
  else
    fail "$desc — expected >$want, got '$got'"
    FAIL=$((FAIL+1))
    return 1
  fi
}

if [ -z "$TENANT_ID" ]; then
  echo "ERROR: MNEMO_EXISTING_TENANT_ID is required."
  echo "Usage: MNEMO_EXISTING_TENANT_ID=<id> bash e2e/api-smoke-test-existing-tenant.sh"
  exit 2
fi

V1_MEM_BASE="$BASE/v1alpha1/mem9s/$TENANT_ID/memories"
V2_MEM_BASE="$BASE/v1alpha2/mem9s/memories"

curl_v1() {
  local url="$1"; shift
  curl_json "$@" -H "X-Mnemo-Agent-Id: $AGENT_ID" "$url"
}

curl_v2() {
  local url="$1"; shift
  curl_json "$@" -H "X-Mnemo-Agent-Id: $AGENT_ID" -H "X-API-Key: $TENANT_ID" "$url"
}

echo "========================================================"
echo "  mnemos API smoke test — existing tenant compat"
echo "  Base URL     : $BASE"
echo "  Tenant ID    : $TENANT_ID"
echo "  Session      : $SESSION_ID"
echo "  Poll timeout : ${POLL_TIMEOUT_S}s"
echo "  Started      : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================================"

# ============================================================================
# TEST 1 — v1alpha1: list existing memories, expect at least one
# ============================================================================
step "1" "v1alpha1: List existing memories — expect pre-existing data"
resp=$(curl_v1 "$V1_MEM_BASE?limit=50")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "v1alpha1 GET /memories returns 200" "$code" "200"
check_contains "response has memories array" "$bdy" '"memories"'
check_contains "response has total field" "$bdy" '"total"'

V1_TOTAL=$(printf '%s' "$bdy" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total',0))" 2>/dev/null || true)
info "Pre-existing memories found: $V1_TOTAL"
TOTAL=$((TOTAL+1))
if [ -n "$V1_TOTAL" ] && [ "$V1_TOTAL" -gt 0 ]; then
  ok "tenant has pre-existing memories (total=$V1_TOTAL)"
  PASS=$((PASS+1))
else
  fail "tenant has no pre-existing memories — verify MNEMO_EXISTING_TENANT_ID is a real tenant"
  FAIL=$((FAIL+1))
fi

FIRST_ID=$(printf '%s' "$bdy" | python3 -c "
import sys, json
mems = json.load(sys.stdin).get('memories', [])
print(mems[0]['id'] if mems else '')
" 2>/dev/null || true)
FIRST_VERSION=$(printf '%s' "$bdy" | python3 -c "
import sys, json
mems = json.load(sys.stdin).get('memories', [])
print(mems[0].get('version', 0) if mems else 0)
" 2>/dev/null || true)

if [ -z "$FIRST_ID" ]; then
  fail "Could not extract first memory ID — aborting per-ID tests"
  echo ""
  echo "========================================================"
  echo "  RESULTS: $PASS / $TOTAL passed, $FAIL failed"
  echo "  Tenant   : $TENANT_ID"
  echo -e "  ${RED}$FAIL test(s) failed.${RESET}"
  echo "  Finished : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "========================================================"
  exit "$FAIL"
fi

info "Using memory ID: $FIRST_ID  version: $FIRST_VERSION"

# ============================================================================
# TEST 2 — v1alpha2: same list via X-API-Key, total must match
# ============================================================================
step "2" "v1alpha2: List same tenant via X-API-Key — total must match v1alpha1"
resp=$(curl_v2 "$V2_MEM_BASE?limit=50")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "v1alpha2 GET /memories returns 200" "$code" "200"

V2_TOTAL=$(printf '%s' "$bdy" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total',0))" 2>/dev/null || true)
check "v1alpha2 total matches v1alpha1 ($V1_TOTAL)" "$V2_TOTAL" "$V1_TOTAL"

# ============================================================================
# TEST 3 — v1alpha1: GET by ID — content roundtrip
# ============================================================================
step "3" "v1alpha1: GET by ID"
resp=$(curl_v1 "$V1_MEM_BASE/$FIRST_ID")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "v1alpha1 GET /{id} returns 200" "$code" "200"
GOT_ID=$(printf '%s' "$bdy" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
check "returned ID matches" "$GOT_ID" "$FIRST_ID"
check_contains "response has content field" "$bdy" '"content"'

# ============================================================================
# TEST 4 — v1alpha2: GET same ID — must match
# ============================================================================
step "4" "v1alpha2: GET by ID — matches v1alpha1"
resp=$(curl_v2 "$V2_MEM_BASE/$FIRST_ID")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "v1alpha2 GET /{id} returns 200" "$code" "200"
GOT_ID_V2=$(printf '%s' "$bdy" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
check "v1alpha2 returned ID matches" "$GOT_ID_V2" "$FIRST_ID"

# ============================================================================
# TEST 5 — v1alpha1: search by query
# ============================================================================
step "5" "v1alpha1: Search by query (?q=memory)"
resp=$(curl_v1 "$V1_MEM_BASE?q=memory&limit=10")
code=$(http_code "$resp")
check "v1alpha1 GET /memories?q=memory returns 200" "$code" "200"

# ============================================================================
# TEST 6 — v1alpha2: same search
# ============================================================================
step "6" "v1alpha2: Search by query (?q=memory)"
resp=$(curl_v2 "$V2_MEM_BASE?q=memory&limit=10")
code=$(http_code "$resp")
check "v1alpha2 GET /memories?q=memory returns 200" "$code" "200"

# ============================================================================
# TEST 7 — v1alpha1: tag filter
# ============================================================================
step "7" "v1alpha1: Tag filter (?tags=smoke)"
resp=$(curl_v1 "$V1_MEM_BASE?tags=smoke&limit=50")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "v1alpha1 GET /memories?tags=smoke returns 200" "$code" "200"
check_contains "response has memories array" "$bdy" '"memories"'

# ============================================================================
# TEST 8 — v1alpha1: PUT update — version must advance
# ============================================================================
step "8" "v1alpha1: PUT update — verify version bump"
_get_resp=$(curl_v1 "$V1_MEM_BASE/$FIRST_ID")
ORIG_CONTENT=$(body "$_get_resp" | python3 -c \
  "import sys,json; print(json.load(sys.stdin).get('content',''))" 2>/dev/null || true)
resp=$(curl_v1 "$V1_MEM_BASE/$FIRST_ID" -X PUT \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"$ORIG_CONTENT (compat-verified $SESSION_ID)\",\"tags\":[\"smoke\",\"round2\",\"compat-check\"]}")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "v1alpha1 PUT /{id} returns 200" "$code" "200"
UPD_VERSION=$(printf '%s' "$bdy" | python3 -c "import sys,json; print(json.load(sys.stdin).get('version',0))" 2>/dev/null || true)
check_gt "v1alpha1 version advanced beyond $FIRST_VERSION" "$UPD_VERSION" "$FIRST_VERSION"
check_contains "compat-check tag present" "$bdy" '"compat-check"'

# ============================================================================
# TEST 9 — v1alpha2: PUT update on second memory (if available), else same ID
# ============================================================================
step "9" "v1alpha2: PUT update — verify version bump"
_list_resp=$(curl_v2 "$V2_MEM_BASE?limit=50")
SECOND_ID=$(body "$_list_resp" | python3 -c "
import sys, json
mems = json.load(sys.stdin).get('memories', [])
ids = [m['id'] for m in mems]
other = [i for i in ids if i != '$FIRST_ID']
print(other[0] if other else ('$FIRST_ID' if ids else ''))
" 2>/dev/null || true)

if [ -n "$SECOND_ID" ]; then
  _get2_resp=$(curl_v2 "$V2_MEM_BASE/$SECOND_ID")
  SECOND_CONTENT=$(body "$_get2_resp" | python3 -c \
    "import sys,json; print(json.load(sys.stdin).get('content',''))" 2>/dev/null || true)
  SECOND_VERSION=$(body "$_get2_resp" | python3 -c \
    "import sys,json; print(json.load(sys.stdin).get('version',0))" 2>/dev/null || true)
  resp=$(curl_v2 "$V2_MEM_BASE/$SECOND_ID" -X PUT \
    -H "Content-Type: application/json" \
    -d "{\"content\":\"$SECOND_CONTENT (compat-verified $SESSION_ID)\",\"tags\":[\"smoke\",\"round2\",\"compat-check\"]}")
  code=$(http_code "$resp")
  bdy=$(body "$resp")
  check "v1alpha2 PUT /{id} returns 200" "$code" "200"
  V2_UPD_VERSION=$(printf '%s' "$bdy" | python3 -c "import sys,json; print(json.load(sys.stdin).get('version',0))" 2>/dev/null || true)
  check_gt "v1alpha2 version advanced beyond $SECOND_VERSION" "$V2_UPD_VERSION" "$SECOND_VERSION"
  check_contains "compat-check tag present" "$bdy" '"compat-check"'
else
  TOTAL=$((TOTAL+1))
  fail "v1alpha2 PUT — could not find a memory ID to update"
  FAIL=$((FAIL+1))
fi

# ============================================================================
# TEST 10 — v1alpha1: write new memory (async 202)
# ============================================================================
step "10" "v1alpha1: Write new memory (POST /memories)"
resp=$(curl_v1 "$V1_MEM_BASE" -X POST \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"Compat smoke test: existing tenant verified against new deployment. Session $SESSION_ID.\",\"tags\":[\"compat-check\",\"new-write\"]}")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "v1alpha1 POST /memories returns 202" "$code" "202"
check_contains "response has status=accepted" "$bdy" '"accepted"'

# ============================================================================
# TEST 11 — v1alpha2: write new memory (async 202)
# ============================================================================
step "11" "v1alpha2: Write new memory (POST /memories)"
resp=$(curl_v2 "$V2_MEM_BASE" -X POST \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"Compat smoke test v1alpha2: existing tenant verified against new deployment. Session $SESSION_ID.\",\"tags\":[\"compat-check\",\"new-write-v2\"]}")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "v1alpha2 POST /memories returns 202" "$code" "202"
check_contains "response has status=accepted" "$bdy" '"accepted"'

# ============================================================================
# TEST 12 — Poll until new compat-check memories appear
# ============================================================================
step "12" "Poll GET /memories?tags=compat-check until new writes materialise (timeout=${POLL_TIMEOUT_S}s)"
ELAPSED=0
COMPAT_COUNT=0
while [ "$ELAPSED" -lt "$POLL_TIMEOUT_S" ]; do
  list_resp=$(curl_v1 "$V1_MEM_BASE?tags=compat-check&limit=50")
  list_bdy=$(body "$list_resp")
  COMPAT_COUNT=$(printf '%s' "$list_bdy" | python3 -c \
    "import sys,json; print(json.load(sys.stdin).get('total',0))" 2>/dev/null || true)
  info "attempt $((ELAPSED/POLL_INTERVAL_S+1)): compat-check memories=$COMPAT_COUNT"
  if [ -n "$COMPAT_COUNT" ] && [ "$COMPAT_COUNT" -gt 0 ]; then
    TOTAL=$((TOTAL+1))
    ok "new memories materialised within ${ELAPSED}s (count=$COMPAT_COUNT)"
    PASS=$((PASS+1))
    break
  fi
  sleep "$POLL_INTERVAL_S"
  ELAPSED=$((ELAPSED+POLL_INTERVAL_S))
done

if [ "$COMPAT_COUNT" -eq 0 ]; then
  TOTAL=$((TOTAL+1))
  fail "new compat-check memories did NOT appear within ${POLL_TIMEOUT_S}s"
  FAIL=$((FAIL+1))
fi

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "========================================================"
echo "  RESULTS: $PASS / $TOTAL passed, $FAIL failed"
echo "  Base URL : $BASE"
echo "  Tenant   : $TENANT_ID"
if [ "$FAIL" -eq 0 ]; then
  echo -e "  ${GREEN}All tests passed.${RESET}"
else
  echo -e "  ${RED}$FAIL test(s) failed.${RESET}"
fi
echo "  Finished : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================================"

exit "$FAIL"
