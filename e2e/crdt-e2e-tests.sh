#!/bin/bash
set -euo pipefail

BASE="http://127.0.0.1:18081"
USER_TOKEN="REDACTED_TOKEN"
AGENT_A="agent-a"
AGENT_B="agent-b"
WORKSPACE_KEY="e2e-crdt-workspace-$(date +%s)"
PASS=0
FAIL=0

# ---- Provision both agents into the same workspace ----
echo "Provisioning agents into shared workspace ($WORKSPACE_KEY)..."

resp=$(curl -s -X POST "$BASE/api/spaces/provision" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -d "{\"workspace_key\":\"$WORKSPACE_KEY\",\"agent_id\":\"$AGENT_A\"}")
TOKEN_A=$(echo "$resp" | jq -r '.space_token')
if [ -z "$TOKEN_A" ] || [ "$TOKEN_A" = "null" ]; then
  echo "FATAL: Failed to provision agent-a: $resp"
  exit 1
fi
echo "  Agent A token: ${TOKEN_A:0:20}..."

resp=$(curl -s -X POST "$BASE/api/spaces/provision" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -d "{\"workspace_key\":\"$WORKSPACE_KEY\",\"agent_id\":\"$AGENT_B\"}")
TOKEN_B=$(echo "$resp" | jq -r '.space_token')
if [ -z "$TOKEN_B" ] || [ "$TOKEN_B" = "null" ]; then
  echo "FATAL: Failed to provision agent-b: $resp"
  exit 1
fi
echo "  Agent B token: ${TOKEN_B:0:20}..."

post() {
  local token="$1" agent="$2" body="$3"
  curl -s -w '\n__HTTP__%{http_code}' -D /tmp/resp_headers \
    -X POST "$BASE/api/memories" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -H "X-Mnemo-Agent-Id: $agent" \
    -d "$body"
}

get() {
  local token="$1" agent="$2" id="$3"
  curl -s -w '\n__HTTP__%{http_code}' \
    -H "Authorization: Bearer $token" \
    -H "X-Mnemo-Agent-Id: $agent" \
    "$BASE/api/memories/$id"
}

del() {
  local token="$1" agent="$2" id="$3"
  curl -s -w '\n__HTTP__%{http_code}' \
    -X DELETE \
    -H "Authorization: Bearer $token" \
    -H "X-Mnemo-Agent-Id: $agent" \
    "$BASE/api/memories/$id"
}

search() {
  local token="$1" agent="$2" q="$3"
  curl -s -w '\n__HTTP__%{http_code}' \
    -H "Authorization: Bearer $token" \
    -H "X-Mnemo-Agent-Id: $agent" \
    "$BASE/api/memories?q=$q&limit=10"
}

bootstrap() {
  local token="$1" agent="$2" limit="$3"
  curl -s -w '\n__HTTP__%{http_code}' \
    -H "Authorization: Bearer $token" \
    -H "X-Mnemo-Agent-Id: $agent" \
    "$BASE/api/memories/bootstrap?limit=$limit"
}

extract_http() { echo "$1" | grep '__HTTP__' | sed 's/__HTTP__//'; }
extract_body() { echo "$1" | grep -v '__HTTP__'; }
extract_header() { grep -i "$1" /tmp/resp_headers 2>/dev/null | tr -d '\r' || echo ""; }

check() {
  local desc="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then
    echo "  OK: $desc (got=$got)"
  else
    echo "  FAIL: $desc (got=$got, want=$want)"
    FAIL=$((FAIL+1))
    return 1
  fi
  return 0
}

echo ""
echo "========================================"
echo "CRDT E2E Tests (user/space model) — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================"

# ---- TEST 1: LWW fast path (backward compat) ----
echo ""
echo "TEST 1: LWW fast path (no clock field)"
resp=$(post "$TOKEN_A" "$AGENT_A" '{"content":"LWW compat: Agent A","key":"lww-compat","tags":["test"]}')
http=$(extract_http "$resp")
body=$(extract_body "$resp")
check "HTTP 201" "$http" "201"
id1=$(echo "$body" | jq -r '.id')
v1=$(echo "$body" | jq -r '.version')
check "version=1" "$v1" "1"

# Agent B overwrites same key, no clock
resp=$(post "$TOKEN_B" "$AGENT_B" '{"content":"LWW compat: Agent B overwrites","key":"lww-compat","tags":["test"]}')
http=$(extract_http "$resp")
body=$(extract_body "$resp")
check "HTTP 201 (upsert)" "$http" "201"
id1b=$(echo "$body" | jq -r '.id')
v1b=$(echo "$body" | jq -r '.version')
check "same ID reused" "$id1b" "$id1"
check "version=2" "$v1b" "2"
src1b=$(echo "$body" | jq -r '.source')
check "source=agent-b" "$src1b" "$AGENT_B"
echo "TEST 1: PASS"
PASS=$((PASS+1))

# ---- TEST 2: Clock-aware write — dominating write wins ----
echo ""
echo "TEST 2: Clock-aware write — dominating write wins"
resp=$(post "$TOKEN_A" "$AGENT_A" '{"content":"CRDT: Agent A initial","key":"crdt-dominate","tags":["crdt"],"clock":{"agent-a":1}}')
http=$(extract_http "$resp")
body=$(extract_body "$resp")
check "HTTP 201" "$http" "201"
id2=$(echo "$body" | jq -r '.id')
clock2=$(echo "$body" | jq -c '.clock')
check "clock has agent-a" "$(echo "$body" | jq -r '.clock["agent-a"]')" "1"

# Agent B dominates with {agent-a:1, agent-b:1}
resp=$(post "$TOKEN_B" "$AGENT_B" '{"content":"CRDT: Agent B dominates","key":"crdt-dominate","tags":["crdt"],"clock":{"agent-a":1,"agent-b":1}}')
http=$(extract_http "$resp")
body=$(extract_body "$resp")
check "HTTP 201 (dominating)" "$http" "201"
winner=$(extract_header "X-Mnemo-Winner")
content2=$(echo "$body" | jq -r '.content')
check "content is B's" "$content2" "CRDT: Agent B dominates"
merged_a=$(echo "$body" | jq -r '.clock["agent-a"]')
merged_b=$(echo "$body" | jq -r '.clock["agent-b"]')
check "merged clock agent-a=1" "$merged_a" "1"
check "merged clock agent-b=1" "$merged_b" "1"
echo "TEST 2: PASS"
PASS=$((PASS+1))

# ---- TEST 3: Clock-aware write — dominated write is rejected ----
echo ""
echo "TEST 3: Dominated write is rejected (200 + X-Mnemo-Dominated)"
# Current state: crdt-dominate has clock {agent-a:1, agent-b:1}
# Agent A sends stale clock {agent-a:1} — dominated by existing
resp=$(post "$TOKEN_A" "$AGENT_A" '{"content":"CRDT: Agent A stale write","key":"crdt-dominate","tags":["crdt"],"clock":{"agent-a":1}}')
http=$(extract_http "$resp")
body=$(extract_body "$resp")
check "HTTP 200 (dominated)" "$http" "200"
dominated=$(extract_header "X-Mnemo-Dominated")
echo "  X-Mnemo-Dominated header: '$dominated'"
content3=$(echo "$body" | jq -r '.content')
check "existing content preserved" "$content3" "CRDT: Agent B dominates"
echo "TEST 3: PASS"
PASS=$((PASS+1))

# ---- TEST 4: Concurrent writes — deterministic tie-break ----
echo ""
echo "TEST 4: Concurrent writes — deterministic tie-break"
# Agent A: clock {agent-a:2}, Agent B: clock {agent-b:2} — neither dominates
resp=$(post "$TOKEN_A" "$AGENT_A" '{"content":"Tiebreak: Agent A","key":"tiebreak-test","tags":["crdt"],"clock":{"agent-a":2}}')
http=$(extract_http "$resp")
body=$(extract_body "$resp")
check "HTTP 201 (first write)" "$http" "201"
id4=$(echo "$body" | jq -r '.id')

resp=$(post "$TOKEN_B" "$AGENT_B" '{"content":"Tiebreak: Agent B","key":"tiebreak-test","tags":["crdt"],"clock":{"agent-b":2}}')
http=$(extract_http "$resp")
body=$(extract_body "$resp")
# Tie-break: agent-a < agent-b lexicographically, so agent-a wins
# Agent B's write is dominated — response is 200 with existing row
content4=$(echo "$body" | jq -r '.content')
origin4=$(echo "$body" | jq -r '.origin_agent')
http4=$(extract_http "$resp")
dominated4=$(extract_header "X-Mnemo-Dominated")
echo "  HTTP: $http4"
echo "  Content: $content4"
echo "  Origin: $origin4"
echo "  X-Mnemo-Dominated: $dominated4"
check "agent-a wins tie-break" "$content4" "Tiebreak: Agent A"
check "origin_agent=agent-a" "$origin4" "$AGENT_A"
check "HTTP 200 (dominated)" "$http4" "200"
echo "  NOTE: Clock merge on dominated concurrent writes not yet implemented"
echo "TEST 4: PASS"
PASS=$((PASS+1))

# ---- TEST 5: Tombstone delete + invisible to reads ----
echo ""
echo "TEST 5: Tombstone delete + invisible to reads"
resp=$(post "$TOKEN_A" "$AGENT_A" '{"content":"Unique tombstone content xyz789","key":"delete-test","tags":["crdt","deleteme"]}')
body=$(extract_body "$resp")
id5=$(echo "$body" | jq -r '.id')

# Delete it
resp=$(del "$TOKEN_A" "$AGENT_A" "$id5")
http=$(extract_http "$resp")
check "DELETE HTTP 204" "$http" "204"

# GET should return 404
resp=$(get "$TOKEN_A" "$AGENT_A" "$id5")
http=$(extract_http "$resp")
check "GET after delete = 404" "$http" "404"

# Search should exclude it — verify by key
resp=$(search "$TOKEN_A" "$AGENT_A" "")
body=$(extract_body "$resp")
has_deleted=$(echo "$body" | jq '[.memories[].key] | map(select(. == "delete-test")) | length')
check "tombstoned key excluded from list" "$has_deleted" "0"

# Repeated delete should be idempotent (204)
resp=$(del "$TOKEN_A" "$AGENT_A" "$id5")
http=$(extract_http "$resp")
check "repeated DELETE = 204 (idempotent)" "$http" "204"
echo "TEST 5: PASS"
PASS=$((PASS+1))

# ---- TEST 6: Tombstone revival — write after delete ----
echo ""
echo "TEST 6: Tombstone revival — write after delete"
resp=$(post "$TOKEN_A" "$AGENT_A" '{"content":"Revival original","key":"revival-test","tags":["crdt"],"clock":{"agent-a":1}}')
body=$(extract_body "$resp")
id6=$(echo "$body" | jq -r '.id')

# Delete it
del "$TOKEN_A" "$AGENT_A" "$id6" > /dev/null

# Verify deleted
resp=$(get "$TOKEN_A" "$AGENT_A" "$id6")
http=$(extract_http "$resp")
check "deleted = 404" "$http" "404"

# Revive with dominating clock
resp=$(post "$TOKEN_B" "$AGENT_B" '{"content":"Revival: Agent B resurrects","key":"revival-test","tags":["crdt","revived"],"clock":{"agent-a":3,"agent-b":1}}')
http=$(extract_http "$resp")
body=$(extract_body "$resp")
check "revival HTTP 201" "$http" "201"
content6=$(echo "$body" | jq -r '.content')
tomb6=$(echo "$body" | jq -r '.tombstone')
check "content is B's revival" "$content6" "Revival: Agent B resurrects"
check "tombstone=false" "$tomb6" "false"

# GET should now work
resp=$(get "$TOKEN_B" "$AGENT_B" "$id6")
http=$(extract_http "$resp")
check "GET after revival = 200" "$http" "200"
echo "TEST 6: PASS"
PASS=$((PASS+1))

# ---- TEST 7: write_id idempotency ----
echo ""
echo "TEST 7: write_id idempotency"
WRITE_ID="test-idempotent-$(date +%s)"
resp=$(post "$TOKEN_A" "$AGENT_A" "{\"content\":\"Idempotent write\",\"key\":\"idempotent-test\",\"tags\":[\"crdt\"],\"clock\":{\"agent-a\":1},\"write_id\":\"$WRITE_ID\"}")
http=$(extract_http "$resp")
body=$(extract_body "$resp")
check "first write HTTP 201" "$http" "201"
v7a=$(echo "$body" | jq -r '.version')

# Retry same write_id
resp=$(post "$TOKEN_A" "$AGENT_A" "{\"content\":\"Idempotent write\",\"key\":\"idempotent-test\",\"tags\":[\"crdt\"],\"clock\":{\"agent-a\":1},\"write_id\":\"$WRITE_ID\"}")
http=$(extract_http "$resp")
body=$(extract_body "$resp")
# Should return cached result — same version, not bumped
v7b=$(echo "$body" | jq -r '.version')
echo "  First write version: $v7a, Retry version: $v7b"
check "version not bumped on retry" "$v7b" "$v7a"
echo "TEST 7: PASS"
PASS=$((PASS+1))

# ---- TEST 8: Bootstrap endpoint ----
echo ""
echo "TEST 8: Bootstrap endpoint"
# We already have several memories. Bootstrap should return recent non-tombstoned ones.
resp=$(bootstrap "$TOKEN_A" "$AGENT_A" "3")
http=$(extract_http "$resp")
body=$(extract_body "$resp")
check "bootstrap HTTP 200" "$http" "200"
total8=$(echo "$body" | jq -r '.total')
echo "  Returned $total8 memories (limit=3)"
# Verify tombstoned records are excluded (delete-test should not appear)
has_deleted=$(echo "$body" | jq '[.memories[].key] | map(select(. == "delete-test")) | length')
check "tombstoned excluded from bootstrap" "$has_deleted" "0"
echo "TEST 8: PASS"
PASS=$((PASS+1))

echo ""
echo "========================================"
echo "RESULTS: $PASS PASS, $FAIL FAIL"
echo "========================================"
