#!/bin/bash
# api-smoke-test-space-chain.sh
# Live Space Chain smoke test against https://api.mem9.ai or any mnemo-server.
#
# Tests covered:
#   1. Healthcheck
#   2. Provision two fresh Spaces
#   3. Create a Space Chain and capture the chain_ key
#   4. Validate chain key status
#   5. Verify empty-chain runtime writes fail clearly
#   6. Resolve chain by key
#   7. List initial chain bindings
#   8. Reject duplicate nodes
#   9. Replace nodes with two Spaces
#  10. List nodes and verify order
#  11. Write a deterministic memory through the chain key
#  12. Poll until the memory materialises with chain_source
#  13. Get, update, and delete the memory by id through the chain key
#  14. Soft-delete the chain and verify the key is inactive
#
# Usage:
#   bash e2e/api-smoke-test-space-chain.sh
#   MNEMO_BASE=http://<dev-alb> POLL_TIMEOUT_S=60 bash e2e/api-smoke-test-space-chain.sh
set -euo pipefail

BASE="${MNEMO_BASE:-https://api.mem9.ai}"
AGENT_A="smoke-chain-agent"
RUN_ID="$(date +%s)-$$"
SESSION_ID="smoke-chain-$RUN_ID"
POLL_TIMEOUT_S="${POLL_TIMEOUT_S:-30}"
POLL_INTERVAL_S=1

CHAIN_ID=""
CHAIN_API_KEY=""
CHAIN_DELETED=false
PROVISIONED_TENANT_ID=""
PASS=0
FAIL=0
TOTAL=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

info()  { echo -e "${CYAN}  ->${RESET} $*"; }
ok()    { echo -e "${GREEN}  PASS${RESET} $*"; }
fail()  { echo -e "${RED}  FAIL${RESET} $*"; }
step()  { echo -e "\n${YELLOW}[$1]${RESET} $2"; }

cleanup() {
  if [ -n "${CHAIN_ID:-}" ] && [ -n "${CHAIN_API_KEY:-}" ] && [ "$CHAIN_DELETED" != "true" ]; then
    curl -s --connect-timeout 5 --max-time 30 -o /dev/null \
      -X DELETE \
      -H "X-API-Key: $CHAIN_API_KEY" \
      "$BASE/v1alpha2/space-chains/$CHAIN_ID" || true
  fi
}
trap cleanup EXIT

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
  fi
  fail "$desc - expected '$want', got '$got'"
  FAIL=$((FAIL+1))
  return 1
}

check_secret_equal() {
  local desc="$1" got="$2" want="$3"
  TOTAL=$((TOTAL+1))
  if [ "$got" = "$want" ]; then
    ok "$desc"
    PASS=$((PASS+1))
    return 0
  fi
  fail "$desc - expected value did not match actual value (redacted)"
  FAIL=$((FAIL+1))
  return 1
}

check_contains() {
  local desc="$1" haystack="$2" needle="$3"
  TOTAL=$((TOTAL+1))
  if printf '%s' "$haystack" | grep -q "$needle"; then
    ok "$desc (contains '$needle')"
    PASS=$((PASS+1))
    return 0
  fi
  fail "$desc - '$needle' not found in: $haystack"
  FAIL=$((FAIL+1))
  return 1
}

check_nonempty() {
  local desc="$1" got="$2"
  TOTAL=$((TOTAL+1))
  if [ -n "$got" ]; then
    ok "$desc"
    PASS=$((PASS+1))
    return 0
  fi
  fail "$desc - value is empty"
  FAIL=$((FAIL+1))
  return 1
}

check_gt() {
  local desc="$1" got="$2" min="$3"
  TOTAL=$((TOTAL+1))
  if [[ "$got" =~ ^[0-9]+$ ]] && [[ "$min" =~ ^[0-9]+$ ]] && [ "$got" -gt "$min" ]; then
    ok "$desc (got=$got, before=$min)"
    PASS=$((PASS+1))
    return 0
  fi
  fail "$desc - expected integer > $min, got '$got'"
  FAIL=$((FAIL+1))
  return 1
}

json_field() {
  local path="$1"
  python3 -c '
import json
import sys

path = sys.argv[1].split(".")
try:
    cur = json.load(sys.stdin)
    for part in path:
        if isinstance(cur, list):
            cur = cur[int(part)]
        elif isinstance(cur, dict):
            cur = cur.get(part, "")
        else:
            cur = ""
            break
    if cur is None:
        cur = ""
    if isinstance(cur, (dict, list)):
        print(json.dumps(cur, separators=(",", ":")))
    else:
        print(cur)
except Exception:
    print("")
' "$path"
}

memory_field_by_tag() {
  local tag="$1"
  local path="$2"
  python3 -c '
import json
import sys

tag = sys.argv[1]
path = sys.argv[2].split(".")
try:
    data = json.load(sys.stdin)
    found = None
    for mem in data.get("memories", []):
        if tag in mem.get("tags", []):
            found = mem
            break
    if found is None:
        print("")
        sys.exit(0)
    cur = found
    for part in path:
        if isinstance(cur, list):
            cur = cur[int(part)]
        elif isinstance(cur, dict):
            cur = cur.get(part, "")
        else:
            cur = ""
            break
    if cur is None:
        cur = ""
    print(cur)
except Exception:
    print("")
' "$tag" "$path"
}

curl_chain_json() {
  local url="$1"
  shift
  curl_json "$@" \
    -H "X-API-Key: $CHAIN_API_KEY" \
    "$url"
}

curl_chain_mem_json() {
  local url="$1"
  shift
  curl_json "$@" \
    -H "X-Mnemo-Agent-Id: $AGENT_A" \
    -H "X-API-Key: $CHAIN_API_KEY" \
    "$url"
}

provision_space() {
  local label="$1"
  local resp code bdy tenant_id
  resp=$(curl_json -X POST "$BASE/v1alpha1/mem9s")
  code=$(http_code "$resp")
  bdy=$(body "$resp")
  check "POST /v1alpha1/mem9s returns 201 for $label" "$code" "201"
  tenant_id=$(printf '%s' "$bdy" | json_field "id")
  check_nonempty "tenant ID extracted for $label" "$tenant_id"
  PROVISIONED_TENANT_ID="$tenant_id"
}

echo "========================================================"
echo "  mnemos API smoke test - Space Chain"
echo "  Base URL      : $BASE"
echo "  Session       : $SESSION_ID"
echo "  Poll timeout  : ${POLL_TIMEOUT_S}s"
echo "  Started       : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================================"

# ============================================================================
# TEST 1 - Healthcheck
# ============================================================================
step "1" "Healthcheck"
resp=$(curl_json "$BASE/healthz")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "GET /healthz returns 200" "$code" "200"
check_contains "status=ok in body" "$bdy" '"ok"'

# ============================================================================
# TEST 2 - Provision two fresh Spaces
# ============================================================================
step "2" "Provision two fresh Spaces"
provision_space "space-1"
SPACE1_ID="$PROVISIONED_TENANT_ID"
provision_space "space-2"
SPACE2_ID="$PROVISIONED_TENANT_ID"
info "Space 1 tenant: $SPACE1_ID"
info "Space 2 tenant: $SPACE2_ID"

# ============================================================================
# TEST 3 - Create Space Chain
# ============================================================================
step "3" "Create Space Chain"
CREATE_PAYLOAD=$(RUN_ID="$RUN_ID" python3 -c '
import json
import os

print(json.dumps({
    "project_id": "e2e-space-chain-project",
    "name": "E2E Space Chain " + os.environ["RUN_ID"],
    "description": "Created by api-smoke-test-space-chain.sh",
    "created_by_user_id": "e2e-space-chain",
}))
')
resp=$(curl_json -X POST "$BASE/v1alpha2/space-chains" \
  -H "Content-Type: application/json" \
  -d "$CREATE_PAYLOAD")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "POST /v1alpha2/space-chains returns 201" "$code" "201"
CHAIN_ID=$(printf '%s' "$bdy" | json_field "chain.id")
CHAIN_API_KEY=$(printf '%s' "$bdy" | json_field "chain_api_key")
BINDING_ID=$(printf '%s' "$bdy" | json_field "binding_id")
KEY_PREFIX=$(printf '%s' "$bdy" | json_field "key_prefix")
check_nonempty "chain ID extracted" "$CHAIN_ID"
check_nonempty "chain API key extracted" "$CHAIN_API_KEY"
check_nonempty "binding ID extracted" "$BINDING_ID"
check "key prefix is chain_" "$KEY_PREFIX" "chain_"
info "Chain: $CHAIN_ID"
info "Binding: $BINDING_ID"

# ============================================================================
# TEST 4 - Validate chain key status
# ============================================================================
step "4" "Validate chain key status"
resp=$(curl_chain_json "$BASE/v1alpha2/status")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "GET /v1alpha2/status returns 200 for chain key" "$code" "200"
STATUS=$(printf '%s' "$bdy" | json_field "status")
check "chain key status is active" "$STATUS" "active"

# ============================================================================
# TEST 5 - Empty-chain runtime write fails clearly
# ============================================================================
step "5" "Empty-chain runtime write fails clearly"
EMPTY_WRITE_PAYLOAD=$(SESSION_ID="$SESSION_ID" python3 -c '
import json
import os

print(json.dumps({
    "content": "This write should fail because the Space Chain has no nodes.",
    "tags": ["space-chain-empty"],
    "session_id": os.environ["SESSION_ID"],
}))
')
resp=$(curl_chain_mem_json "$BASE/v1alpha2/mem9s/memories" -X POST \
  -H "Content-Type: application/json" \
  -d "$EMPTY_WRITE_PAYLOAD")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "empty-chain POST /memories returns 400" "$code" "400"
check_contains "empty-chain error is clear" "$bdy" "Space Chain has no nodes"

# ============================================================================
# TEST 6 - Resolve chain by key
# ============================================================================
step "6" "Resolve chain by key"
resp=$(curl_chain_json "$BASE/v1alpha2/space-chains/by-key")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "GET /space-chains/by-key returns 200" "$code" "200"
BY_KEY_ID=$(printf '%s' "$bdy" | json_field "id")
check "by-key chain ID matches" "$BY_KEY_ID" "$CHAIN_ID"

# ============================================================================
# TEST 7 - List initial bindings
# ============================================================================
step "7" "List initial chain bindings"
resp=$(curl_chain_json "$BASE/v1alpha2/space-chains/$CHAIN_ID/bindings")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "GET /space-chains/{id}/bindings returns 200" "$code" "200"
GOT_BINDING_ID=$(printf '%s' "$bdy" | json_field "bindings.0.id")
GOT_BINDING_KEY=$(printf '%s' "$bdy" | json_field "bindings.0.chain_api_key")
check "initial binding ID matches" "$GOT_BINDING_ID" "$BINDING_ID"
check_secret_equal "initial binding key matches" "$GOT_BINDING_KEY" "$CHAIN_API_KEY"

# ============================================================================
# TEST 8 - Duplicate node replacement is rejected
# ============================================================================
step "8" "Reject duplicate nodes"
DUP_NODE_PAYLOAD=$(SPACE1_ID="$SPACE1_ID" RUN_ID="$RUN_ID" python3 -c '
import json
import os

space_id = os.environ["SPACE1_ID"]
print(json.dumps({
    "nodes": [
        {"tenant_id": space_id, "external_space_id": "e2e-dup-a-" + os.environ["RUN_ID"]},
        {"tenant_id": space_id, "external_space_id": "e2e-dup-b-" + os.environ["RUN_ID"]},
    ],
}))
')
resp=$(curl_chain_json "$BASE/v1alpha2/space-chains/$CHAIN_ID/nodes" -X PUT \
  -H "Content-Type: application/json" \
  -d "$DUP_NODE_PAYLOAD")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "duplicate node replacement returns 400" "$code" "400"
check_contains "duplicate error mentions tenant_id" "$bdy" "duplicate tenant_id"

# ============================================================================
# TEST 9 - Replace nodes with two Spaces
# ============================================================================
step "9" "Replace chain nodes"
NODE_PAYLOAD=$(SPACE1_ID="$SPACE1_ID" SPACE2_ID="$SPACE2_ID" RUN_ID="$RUN_ID" python3 -c '
import json
import os

print(json.dumps({
    "nodes": [
        {
            "tenant_id": os.environ["SPACE1_ID"],
            "external_space_id": "e2e-space-chain-space-1-" + os.environ["RUN_ID"],
            "display_name": "E2E Space Chain Node 1",
        },
        {
            "tenant_id": os.environ["SPACE2_ID"],
            "external_space_id": "e2e-space-chain-space-2-" + os.environ["RUN_ID"],
            "display_name": "E2E Space Chain Node 2",
        },
    ],
}))
')
resp=$(curl_chain_json "$BASE/v1alpha2/space-chains/$CHAIN_ID/nodes" -X PUT \
  -H "Content-Type: application/json" \
  -d "$NODE_PAYLOAD")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "PUT /space-chains/{id}/nodes returns 200" "$code" "200"
NODE0_TENANT=$(printf '%s' "$bdy" | json_field "nodes.0.tenant_id")
NODE1_TENANT=$(printf '%s' "$bdy" | json_field "nodes.1.tenant_id")
NODE0_POS=$(printf '%s' "$bdy" | json_field "nodes.0.position")
NODE1_POS=$(printf '%s' "$bdy" | json_field "nodes.1.position")
check "node 0 tenant matches first Space" "$NODE0_TENANT" "$SPACE1_ID"
check "node 1 tenant matches second Space" "$NODE1_TENANT" "$SPACE2_ID"
check "node 0 position is 0" "$NODE0_POS" "0"
check "node 1 position is 1" "$NODE1_POS" "1"

# ============================================================================
# TEST 10 - List nodes and verify order
# ============================================================================
step "10" "List chain nodes"
resp=$(curl_chain_json "$BASE/v1alpha2/space-chains/$CHAIN_ID/nodes")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "GET /space-chains/{id}/nodes returns 200" "$code" "200"
LIST_NODE0_TENANT=$(printf '%s' "$bdy" | json_field "nodes.0.tenant_id")
LIST_NODE1_TENANT=$(printf '%s' "$bdy" | json_field "nodes.1.tenant_id")
LIST_NODE0_POS=$(printf '%s' "$bdy" | json_field "nodes.0.position")
LIST_NODE1_POS=$(printf '%s' "$bdy" | json_field "nodes.1.position")
check "listed node 0 tenant matches first Space" "$LIST_NODE0_TENANT" "$SPACE1_ID"
check "listed node 1 tenant matches second Space" "$LIST_NODE1_TENANT" "$SPACE2_ID"
check "listed node 0 position is 0" "$LIST_NODE0_POS" "0"
check "listed node 1 position is 1" "$LIST_NODE1_POS" "1"

# ============================================================================
# TEST 11 - Write deterministic memory through chain key
# ============================================================================
step "11" "Write deterministic memory through chain key"
RUN_TAG="space-chain-e2e-$RUN_ID"
KNOWN_CONTENT="Space Chain smoke test $RUN_ID writes through a chain key to the first node."
WRITE_PAYLOAD=$(KNOWN_CONTENT="$KNOWN_CONTENT" RUN_TAG="$RUN_TAG" SESSION_ID="$SESSION_ID" python3 -c '
import json
import os

print(json.dumps({
    "content": os.environ["KNOWN_CONTENT"],
    "tags": ["space-chain-smoke", os.environ["RUN_TAG"]],
    "session_id": os.environ["SESSION_ID"],
}))
')
resp=$(curl_chain_mem_json "$BASE/v1alpha2/mem9s/memories" -X POST \
  -H "Content-Type: application/json" \
  -d "$WRITE_PAYLOAD")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "POST /memories with chain key returns 202" "$code" "202"
check_contains "write response has status=accepted" "$bdy" '"accepted"'

# ============================================================================
# TEST 12 - Poll until memory materialises with chain_source
# ============================================================================
step "12" "Poll chain list until memory materialises"
FIRST_MEM_ID=""
ELAPSED=0
while [ "$ELAPSED" -lt "$POLL_TIMEOUT_S" ]; do
  list_resp=$(curl_chain_mem_json "$BASE/v1alpha2/mem9s/memories?limit=50")
  list_code=$(http_code "$list_resp")
  list_bdy=$(body "$list_resp")

  if [ "$list_code" = "200" ]; then
    FIRST_MEM_ID=$(printf '%s' "$list_bdy" | memory_field_by_tag "$RUN_TAG" "id")
    if [ -n "$FIRST_MEM_ID" ]; then
      info "Memory appeared after ~${ELAPSED}s - ID: $FIRST_MEM_ID"
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
  fail "Memory did NOT appear within ${POLL_TIMEOUT_S}s"
  FAIL=$((FAIL+1))
  exit "$FAIL"
fi

LIST_CHAIN_ID=$(printf '%s' "$list_bdy" | memory_field_by_tag "$RUN_TAG" "chain_source.chain_id")
LIST_NODE_POS=$(printf '%s' "$list_bdy" | memory_field_by_tag "$RUN_TAG" "chain_source.node_position")
LIST_SOURCE_TENANT=$(printf '%s' "$list_bdy" | memory_field_by_tag "$RUN_TAG" "chain_source.tenant_id")
check "list chain_source.chain_id matches" "$LIST_CHAIN_ID" "$CHAIN_ID"
check "list chain_source.node_position is 0" "$LIST_NODE_POS" "0"
check "list chain_source.tenant_id is first Space" "$LIST_SOURCE_TENANT" "$SPACE1_ID"

# ============================================================================
# TEST 13 - Get memory by id through chain key
# ============================================================================
step "13" "Get memory by ID through chain key"
resp=$(curl_chain_mem_json "$BASE/v1alpha2/mem9s/memories/$FIRST_MEM_ID")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "GET /memories/{id} returns 200" "$code" "200"
GOT_ID=$(printf '%s' "$bdy" | json_field "id")
ORIG_VERSION=$(printf '%s' "$bdy" | json_field "version")
GET_CHAIN_ID=$(printf '%s' "$bdy" | json_field "chain_source.chain_id")
GET_NODE_POS=$(printf '%s' "$bdy" | json_field "chain_source.node_position")
GET_SOURCE_TENANT=$(printf '%s' "$bdy" | json_field "chain_source.tenant_id")
check "returned ID matches" "$GOT_ID" "$FIRST_MEM_ID"
check_nonempty "original version extracted" "$ORIG_VERSION"
check "get chain_source.chain_id matches" "$GET_CHAIN_ID" "$CHAIN_ID"
check "get chain_source.node_position is 0" "$GET_NODE_POS" "0"
check "get chain_source.tenant_id is first Space" "$GET_SOURCE_TENANT" "$SPACE1_ID"

# ============================================================================
# TEST 14 - Update memory by id through chain key
# ============================================================================
step "14" "Update memory by ID through chain key"
UPDATED_CONTENT="$KNOWN_CONTENT (updated)"
UPDATE_PAYLOAD=$(UPDATED_CONTENT="$UPDATED_CONTENT" RUN_TAG="$RUN_TAG" python3 -c '
import json
import os

print(json.dumps({
    "content": os.environ["UPDATED_CONTENT"],
    "tags": ["space-chain-smoke", os.environ["RUN_TAG"], "updated"],
}))
')
resp=$(curl_chain_mem_json "$BASE/v1alpha2/mem9s/memories/$FIRST_MEM_ID" -X PUT \
  -H "Content-Type: application/json" \
  -d "$UPDATE_PAYLOAD")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "PUT /memories/{id} returns 200" "$code" "200"
UPD_VERSION=$(printf '%s' "$bdy" | json_field "version")
UPD_CHAIN_ID=$(printf '%s' "$bdy" | json_field "chain_source.chain_id")
UPD_NODE_POS=$(printf '%s' "$bdy" | json_field "chain_source.node_position")
UPD_SOURCE_TENANT=$(printf '%s' "$bdy" | json_field "chain_source.tenant_id")
check_gt "version advanced" "$UPD_VERSION" "$ORIG_VERSION"
check_contains "updated tag present" "$bdy" '"updated"'
check "update chain_source.chain_id matches" "$UPD_CHAIN_ID" "$CHAIN_ID"
check "update chain_source.node_position is 0" "$UPD_NODE_POS" "0"
check "update chain_source.tenant_id is first Space" "$UPD_SOURCE_TENANT" "$SPACE1_ID"

# ============================================================================
# TEST 15 - Delete memory by id through chain key
# ============================================================================
step "15" "Delete memory by ID through chain key"
resp=$(curl_chain_mem_json "$BASE/v1alpha2/mem9s/memories/$FIRST_MEM_ID" -X DELETE)
code=$(http_code "$resp")
check "DELETE /memories/{id} returns 204" "$code" "204"

# ============================================================================
# TEST 16 - Verify deleted memory returns 404 through chain key
# ============================================================================
step "16" "Verify deleted memory returns 404"
resp=$(curl_chain_mem_json "$BASE/v1alpha2/mem9s/memories/$FIRST_MEM_ID")
code=$(http_code "$resp")
check "GET deleted memory returns 404" "$code" "404"

# ============================================================================
# TEST 17 - Soft-delete chain
# ============================================================================
step "17" "Soft-delete Space Chain"
resp=$(curl_chain_json "$BASE/v1alpha2/space-chains/$CHAIN_ID" -X DELETE)
code=$(http_code "$resp")
check "DELETE /space-chains/{id} returns 204" "$code" "204"
CHAIN_DELETED=true

# ============================================================================
# TEST 18 - Deleted chain key is no longer active
# ============================================================================
step "18" "Verify deleted chain key is inactive"
resp=$(curl_chain_json "$BASE/v1alpha2/status")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "GET /v1alpha2/status returns 200 for deleted chain key" "$code" "200"
STATUS=$(printf '%s' "$bdy" | json_field "status")
check "deleted chain key status is inactive" "$STATUS" "inactive"

echo ""
echo "========================================================"
echo "  RESULTS: $PASS / $TOTAL passed, $FAIL failed"
echo "  Base URL : $BASE"
echo "  Chain    : $CHAIN_ID"
if [ "$FAIL" -eq 0 ]; then
  echo -e "  ${GREEN}All tests passed.${RESET}"
else
  echo -e "  ${RED}$FAIL test(s) failed.${RESET}"
fi
echo "  Finished : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================================"

exit "$FAIL"
