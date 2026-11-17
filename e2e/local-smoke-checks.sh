#!/bin/bash
# Shared local smoke assertions for CI/dev. Requires a running mnemo-server and
# a seeded active tenant, but does not require dev/staging, secrets, LLMs, or
# embeddings.
set -euo pipefail

export NO_PROXY="${NO_PROXY:+$NO_PROXY,}127.0.0.1,localhost"
export no_proxy="${no_proxy:+$no_proxy,}127.0.0.1,localhost"

BASE="${MNEMO_BASE:-http://127.0.0.1:18081}"
TENANT_ID="${MNEMO_SMOKE_TENANT_ID:-ci-local-smoke}"
AGENT_ID="${MNEMO_SMOKE_AGENT_ID:-ci-local-agent}"
RUN_ID="${MNEMO_SMOKE_RUN_ID:-$(date +%s)}"
MARKER="CI_SMOKE_${RUN_ID}"
SEARCH_QUERY="what is ${MARKER}"
MEM_BASE="$BASE/v1alpha2/mem9s/memories"

PASS=0
FAIL=0
TOTAL=0

info() {
  printf '  -> %s\n' "$*"
}

ok() {
  printf '  PASS %s\n' "$*"
}

fail() {
  printf '  FAIL %s\n' "$*" >&2
}

step() {
  printf '\n[%s] %s\n' "$1" "$2"
}

curl_json() {
  curl -sS --connect-timeout 5 --max-time 30 -w '\n__HTTP__%{http_code}' "$@"
}

http_code() {
  printf '%s' "$1" | grep '__HTTP__' | sed 's/__HTTP__//'
}

body() {
  printf '%s' "$1" | grep -v '__HTTP__'
}

urlencode() {
  python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
}

json_payload() {
  python3 -c '
import json
import sys

print(json.dumps({
    "content": sys.argv[1],
    "tags": ["ci-local-smoke", sys.argv[2]],
    "sync": True,
}))
' "$1" "$2"
}

extract_memory_id_with_marker() {
  local marker="$1"
  python3 -c '
import json
import sys

marker = sys.argv[1]
try:
    data = json.load(sys.stdin)
except Exception:
    print("")
    sys.exit(0)

for memory in data.get("memories", []):
    if marker in memory.get("content", ""):
        print(memory.get("id", ""))
        sys.exit(0)
print("")
' "$marker"
}

check() {
  local desc="$1"
  local got="$2"
  local want="$3"

  TOTAL=$((TOTAL + 1))
  if [ "$got" = "$want" ]; then
    ok "$desc (got=$got)"
    PASS=$((PASS + 1))
    return 0
  fi

  fail "$desc - expected '$want', got '$got'"
  FAIL=$((FAIL + 1))
  return 1
}

check_contains() {
  local desc="$1"
  local haystack="$2"
  local needle="$3"

  TOTAL=$((TOTAL + 1))
  if printf '%s' "$haystack" | grep -Fq "$needle"; then
    ok "$desc"
    PASS=$((PASS + 1))
    return 0
  fi

  fail "$desc - '$needle' not found in response"
  printf '%s\n' "$haystack" >&2
  FAIL=$((FAIL + 1))
  return 1
}

authed_curl() {
  local url="$1"
  shift

  curl_json "$@" \
    -H "X-API-Key: $TENANT_ID" \
    -H "X-Mnemo-Agent-Id: $AGENT_ID" \
    "$url"
}

echo "========================================================"
echo "  Mem9 local smoke checks"
echo "  Base URL : $BASE"
echo "  Tenant   : $TENANT_ID"
echo "  Marker   : $MARKER"
echo "========================================================"

step "1" "Healthcheck"
resp=$(curl_json "$BASE/healthz")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "GET /healthz returns 200" "$code" "200"
check_contains "health response contains ok" "$bdy" '"ok"'

step "2" "Version endpoint"
resp=$(curl_json "$BASE/versionz")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "GET /versionz returns 200" "$code" "200"
check_contains "version response contains go_version" "$bdy" '"go_version"'

step "3" "Auth failures"
resp=$(curl_json "$MEM_BASE?limit=1")
code=$(http_code "$resp")
check "missing X-API-Key returns 400" "$code" "400"

resp=$(curl_json -H "X-API-Key: invalid-local-smoke-key" "$MEM_BASE?limit=1")
code=$(http_code "$resp")
check "invalid X-API-Key returns 400" "$code" "400"

step "4" "Create memory through local server"
CONTENT="${SEARCH_QUERY}? \"${MARKER}\" is \"LOCAL_SERVER\"."
payload=$(json_payload "$CONTENT" "$MARKER")
resp=$(authed_curl "$MEM_BASE" -X POST -H "Content-Type: application/json" -d "$payload")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "POST /memories sync direct content returns 200" "$code" "200"
check_contains "create response contains ok" "$bdy" '"ok"'

step "5" "List by tag"
resp=$(authed_curl "$MEM_BASE?tags=ci-local-smoke&limit=20")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "GET /memories tag filter returns 200" "$code" "200"
check_contains "tag list includes marker" "$bdy" "$MARKER"

MEMORY_ID=$(printf '%s' "$bdy" | extract_memory_id_with_marker "$MARKER")
if [ -z "$MEMORY_ID" ]; then
  fail "could not find memory ID for marker $MARKER"
  exit 1
fi
info "Memory ID: $MEMORY_ID"

step "6" "Keyword recall"
query=$(urlencode "$SEARCH_QUERY")
resp=$(authed_curl "$MEM_BASE?q=$query&memory_type=insight&limit=10")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "GET /memories?q=... returns 200" "$code" "200"
check_contains "query recall includes marker" "$bdy" "$MARKER"
check_contains "query recall includes confidence" "$bdy" '"confidence"'

step "7" "Get by ID"
resp=$(authed_curl "$MEM_BASE/$MEMORY_ID")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "GET /memories/{id} returns 200" "$code" "200"
check_contains "get response includes marker" "$bdy" "$MARKER"

step "8" "Update by ID"
updated_content="$CONTENT updated"
payload=$(json_payload "$updated_content" "$MARKER")
resp=$(authed_curl "$MEM_BASE/$MEMORY_ID" -X PUT -H "Content-Type: application/json" -d "$payload")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "PUT /memories/{id} returns 200" "$code" "200"
check_contains "update response includes updated content" "$bdy" "updated"

step "9" "Delete by ID"
resp=$(authed_curl "$MEM_BASE/$MEMORY_ID" -X DELETE)
code=$(http_code "$resp")
check "DELETE /memories/{id} returns 204" "$code" "204"

resp=$(authed_curl "$MEM_BASE/$MEMORY_ID")
code=$(http_code "$resp")
check "GET deleted memory returns 404" "$code" "404"

echo ""
echo "========================================================"
echo "  RESULTS: $PASS / $TOTAL passed, $FAIL failed"
echo "========================================================"

if [ "$FAIL" -ne 0 ]; then
  exit 1
fi
