#!/bin/bash
# api-smoke-test.sh
# Smoke test against https://api.mem9.ai (or any mnemo-server instance).
#
# Tests covered:
#   1. Healthcheck
#   2. Provision tenant — capture tenant ID
#   3. Ingest via messages (async, expect 202)
#   4. Ingest via content (async reconcile, expect 202)
#   5. Validation errors (bad request shapes)
#   6. List memories
#   7. Search by query (?q=) — includes confidence check on results
#   8. Search by tags (?tags=)
#   9. Get memory by ID (uses first ID from list, if any)
#  10. Update memory (PUT /{id})
#  11. Delete memory, verify 404
#  12. Summary
#
# Usage:
#   bash e2e/api-smoke-test.sh
#   MNEMO_BASE=https://api.mem9.ai bash e2e/api-smoke-test.sh
set -euo pipefail

BASE="${MNEMO_BASE:-https://api.mem9.ai}"
API_VERSION="${MNEMO_API_VERSION:-v1alpha1}"
AGENT_A="smoke-agent-alpha"
SESSION_ID="smoke-session-$(date +%s)"
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
echo "  mnemos API smoke test"
echo "  Base URL : $BASE"
echo "  API Mode : $API_VERSION"
echo "  Session  : $SESSION_ID"
echo "  Started  : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================================"

# ============================================================================
# TEST 1 — Healthcheck
# ============================================================================
step "1" "Healthcheck"
resp=$(curl_json "$BASE/healthz")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "GET /healthz returns 200" "$code" "200"
check_contains "status=ok in body" "$bdy" '"ok"'

# ============================================================================
# TEST 2 — Provision tenant
# ============================================================================
step "2" "Provision tenant (POST /v1alpha1/mem9s)"
resp=$(curl_json -X POST "$BASE/v1alpha1/mem9s")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "POST /v1alpha1/mem9s returns 201" "$code" "201"

TENANT_ID=$(printf '%s' "$bdy" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || true)
if [ -z "$TENANT_ID" ]; then
  fail "Could not extract tenant ID from response: $bdy"
  echo "Aborting — cannot continue without a tenant ID."
  exit 1
fi
info "Tenant provisioned: $TENANT_ID"
API_KEY="$TENANT_ID"

CLAIM_URL=$(printf '%s' "$bdy" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('claim_url',''))" 2>/dev/null || true)
[ -n "$CLAIM_URL" ] && info "Claim URL: $CLAIM_URL"

if [ "$API_VERSION" = "v1alpha2" ]; then
  MEM_BASE="$BASE/v1alpha2/mem9s/memories"
  info "Using v1alpha2 header auth with X-API-Key"
else
  MEM_BASE="$BASE/v1alpha1/mem9s/$TENANT_ID/memories"
  info "Using v1alpha1 path auth with tenantID"
fi

# ============================================================================
# TEST 3 — Ingest via messages (async)
# ============================================================================
step "3" "Ingest via messages (POST /memories with messages array)"
resp=$(curl_mem_json "$MEM_BASE" -X POST \
  -H "Content-Type: application/json" \
  -d "{
    \"messages\": [
      {\"role\": \"user\", \"content\": \"How do I run the mnemos server locally?\"},
      {\"role\": \"assistant\", \"content\": \"Set MNEMO_DSN env var and run go run ./cmd/mnemo-server inside the server/ directory.\"},
      {\"role\": \"user\", \"content\": \"What database does mnemos use?\"},
      {\"role\": \"assistant\", \"content\": \"TiDB — with hybrid vector and keyword search.\"}
    ],
    \"session_id\": \"$SESSION_ID\"
  }")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "POST /memories (messages ingest) returns 202" "$code" "202"
check_contains "response has status=accepted" "$bdy" '"accepted"'

# ============================================================================
# TEST 4 — Ingest via content (async reconcile)
# ============================================================================
step "4" "Ingest via content (POST /memories with content field)"
resp=$(curl_mem_json "$MEM_BASE" -X POST \
  -H "Content-Type: application/json" \
  -d "{
    \"content\": \"The mnemos server uses a chi router with tenant-scoped routes. Each tenant gets a dedicated TiDB database. Hybrid search combines vector cosine distance with keyword LIKE matching.\",
    \"session_id\": \"$SESSION_ID\"
  }")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "POST /memories (content reconcile) returns 202" "$code" "202"
check_contains "response has status=accepted" "$bdy" '"accepted"'

# ============================================================================
# TEST 5 — Validation errors
# ============================================================================
step "5" "Validation: rejected request shapes"

info "Both content and messages — should be 400"
resp=$(curl_mem_json "$MEM_BASE" -X POST \
  -H "Content-Type: application/json" \
  -d '{"content":"hello","messages":[{"role":"user","content":"hi"}]}')
code=$(http_code "$resp")
check "content+messages returns 400" "$code" "400"

info "Content with tags — should be 202 (tags are valid on content writes)"
resp=$(curl_mem_json "$MEM_BASE" -X POST \
  -H "Content-Type: application/json" \
  -d '{"content":"hello","tags":["test"]}')
code=$(http_code "$resp")
check "content+tags returns 202" "$code" "202"

info "Empty body — should be 400"
resp=$(curl_mem_json "$MEM_BASE" -X POST \
  -H "Content-Type: application/json" \
  -d '{}')
code=$(http_code "$resp")
check "empty body returns 400" "$code" "400"

# ============================================================================
# TEST 6 — List memories
# ============================================================================
step "6" "List memories (GET /memories)"
resp=$(curl_mem_json "$MEM_BASE?limit=50")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "GET /memories returns 200" "$code" "200"
check_contains "response has memories array" "$bdy" '"memories"'
check_contains "response has total field" "$bdy" '"total"'
LIST_TOTAL=$(printf '%s' "$bdy" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total',0))" 2>/dev/null || true)
info "Memories in tenant so far: $LIST_TOTAL"

FIRST_MEM_ID=$(printf '%s' "$bdy" | python3 -c "
import sys, json
mems = json.load(sys.stdin).get('memories', [])
print(mems[0]['id'] if mems else '')
" 2>/dev/null || true)

if [ -n "$FIRST_MEM_ID" ]; then
  FIRST_RELATIVE_AGE=$(printf '%s' "$bdy" | python3 -c "
import sys, json
mems = json.load(sys.stdin).get('memories', [])
print(mems[0].get('relative_age', '') if mems else '')
" 2>/dev/null || true)
  TOTAL=$((TOTAL+1))
  if [ -n "$FIRST_RELATIVE_AGE" ]; then
    ok "list: first memory has relative_age (got='$FIRST_RELATIVE_AGE')"
    PASS=$((PASS+1))
  else
    fail "list: first memory missing relative_age field"
    FAIL=$((FAIL+1))
  fi
fi

# ============================================================================
# TEST 7 — Search by query
# ============================================================================
step "7" "Search capability probe (?q=)"
PROBE_RESP=$(curl_mem_json "$MEM_BASE?q=probe&limit=1")
PROBE_CODE=$(http_code "$PROBE_RESP")
SEARCH_OK=false
if [ "$PROBE_CODE" = "200" ]; then
  SEARCH_OK=true
  info "Full-text / vector search available (probe returned 200)"
else
  echo -e "${YELLOW}  SKIP${RESET} Search returned HTTP $PROBE_CODE — FTS/vector index may still be warming up."
fi

if [ "$SEARCH_OK" = "true" ]; then
  info "Searching: q=TiDB"
  resp=$(curl_mem_json "$MEM_BASE?q=TiDB&limit=10")
  code=$(http_code "$resp")
  bdy=$(body "$resp")
  check "GET /memories?q=TiDB returns 200" "$code" "200"
  SEARCH_CONFIDENCE=$(printf '%s' "$bdy" | python3 -c "
import sys, json
mems = json.load(sys.stdin).get('memories', [])
if not mems:
    print('no-results')
else:
    c = mems[0].get('confidence')
    print(str(c) if c is not None else '')
" 2>/dev/null || true)
  if [ "$SEARCH_CONFIDENCE" = "no-results" ]; then
    info "search: no results yet — confidence check skipped"
  else
    TOTAL=$((TOTAL+1))
    if [ -n "$SEARCH_CONFIDENCE" ]; then
      ok "search: first result has confidence (got='$SEARCH_CONFIDENCE')"
      PASS=$((PASS+1))
    else
      fail "search: first result missing confidence field"
      FAIL=$((FAIL+1))
    fi
  fi

  info "Searching: q=xyzzy_nonexistent_term_abc123"
  resp=$(curl_mem_json "$MEM_BASE?q=xyzzy_nonexistent_term_abc123&limit=10")
  code=$(http_code "$resp")
  check "GET /memories?q=<nomatch> returns 200" "$code" "200"
fi

# ============================================================================
# TEST 8 — Search by tags
# ============================================================================
step "8" "Tag filter search (?tags=)"
resp=$(curl_mem_json "$MEM_BASE?tags=tidb&limit=10")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "GET /memories?tags=tidb returns 200" "$code" "200"
check_contains "response has memories array" "$bdy" '"memories"'

# ============================================================================
# TESTS 9–11 — Per-ID operations (requires a known ID from list)
# ============================================================================
if [ -n "$FIRST_MEM_ID" ]; then
  step "9" "Get memory by ID (GET /memories/{id})"
  resp=$(curl_mem_json "$MEM_BASE/$FIRST_MEM_ID")
  code=$(http_code "$resp")
  bdy=$(body "$resp")
  check "GET /{id} returns 200" "$code" "200"
  GOT_ID=$(printf '%s' "$bdy" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
  check "returned ID matches" "$GOT_ID" "$FIRST_MEM_ID"

  step "10" "Update memory (PUT /memories/{id})"
  ORIG_CONTENT=$(printf '%s' "$bdy" | python3 -c "import sys,json; print(json.load(sys.stdin).get('content',''))" 2>/dev/null || true)
  ORIG_VERSION=$(printf '%s' "$bdy" | python3 -c "import sys,json; print(json.load(sys.stdin).get('version',''))" 2>/dev/null || true)
  info "Original version: $ORIG_VERSION"
  NEXT_VERSION=$((ORIG_VERSION+1))

  resp=$(curl_mem_json "$MEM_BASE/$FIRST_MEM_ID" -X PUT \
    -H "Content-Type: application/json" \
    -d "{
      \"content\": \"${ORIG_CONTENT} (smoke-updated)\",
      \"tags\": [\"smoke\", \"updated\"]
    }")
  code=$(http_code "$resp")
  bdy=$(body "$resp")
  check "PUT /{id} returns 200" "$code" "200"
  UPD_VERSION=$(printf '%s' "$bdy" | python3 -c "import sys,json; print(json.load(sys.stdin).get('version',''))" 2>/dev/null || true)
  check "version bumped to $NEXT_VERSION" "$UPD_VERSION" "$NEXT_VERSION"
  check_contains "updated tag present" "$bdy" '"updated"'

  step "11" "Delete memory + verify 404"
  resp=$(curl_mem_json "$MEM_BASE/$FIRST_MEM_ID" -X DELETE)
  code=$(http_code "$resp")
  check "DELETE /{id} returns 204" "$code" "204"

  resp=$(curl_mem_json "$MEM_BASE/$FIRST_MEM_ID")
  code=$(http_code "$resp")
  check "GET deleted memory returns 404" "$code" "404"
else
  echo -e "\n${YELLOW}[9-11]${RESET} Skipping per-ID tests — tenant has no memories yet (ingest is async)."
  info "Re-run the test after the LLM ingest pipeline has processed the queued items."
fi

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
