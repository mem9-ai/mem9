#!/bin/bash
# api-smoke-test-utm.sh
# Smoke test for UTM attribution capture at tenant provision time.
#
# Tests covered:
#   1. Provision without UTM params — 201, tenant ID returned
#   2. Provision with all 4 UTM params — 201, tenant ID returned
#   3. Provision with partial UTM params — 201, tenant ID returned
#   4. Non-UTM query params are silently dropped — 201, tenant ID returned
#   5. Empty-value UTM param is dropped — 201, tenant ID returned
#   6. DB: no row for tenant provisioned without UTM (requires MNEMO_METADB_DSN)
#   7. DB: all 4 UTM fields persisted for full-params tenant (requires MNEMO_METADB_DSN)
#   8. DB: only non-empty params persisted for partial-params tenant (requires MNEMO_METADB_DSN)
#   9. DB: non-UTM params absent from row (requires MNEMO_METADB_DSN)
#  10. DB: empty-value param absent from row (requires MNEMO_METADB_DSN)
#
# Usage:
#   bash e2e/api-smoke-test-utm.sh
#   MNEMO_BASE=http://<dev-alb> bash e2e/api-smoke-test-utm.sh
#
# DB verification (tests 6-10) requires a MySQL-compatible CLI and MNEMO_METADB_DSN:
#   MNEMO_METADB_DSN="user:pass@tcp(host:4000)/test" \
#     bash e2e/api-smoke-test-utm.sh
#
# If MNEMO_METADB_DSN is not set, tests 6-10 are skipped with a warning.
# MNEMO_UTM_ENABLED=true must be set on the server for DB tests to pass.
set -euo pipefail

BASE="${MNEMO_BASE:-https://api.mem9.ai}"
METADB_DSN="${MNEMO_METADB_DSN:-}"
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
warn()  { echo -e "${YELLOW}  SKIP${RESET} $*"; }
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

check_not_contains() {
  local desc="$1" haystack="$2" needle="$3"
  TOTAL=$((TOTAL+1))
  if printf '%s' "$haystack" | grep -q "$needle"; then
    fail "$desc — '$needle' unexpectedly found in: $haystack"
    FAIL=$((FAIL+1))
    return 1
  else
    ok "$desc (absent: '$needle')"
    PASS=$((PASS+1))
    return 0
  fi
}

# db_query <sql> — runs a SQL query against MNEMO_METADB_DSN via mycli.
# Accepts both Go DSN format (user:pass@tcp(host:port)/db) and standard URI
# (user:pass@host:port/db). Converts Go format to standard URI before calling mycli.
# Prints the result rows. Exits non-zero on error.
db_query() {
  local sql="$1"
  local uri
  uri=$(python3 -c "
import re, sys
dsn = sys.argv[1]
m = re.match(r'^([^@]+)@tcp\(([^)]+)\)/(.+)$', dsn)
if m:
    print('mysql://' + m.group(1) + '@' + m.group(2) + '/' + m.group(3))
else:
    print('mysql://' + dsn)
" "$METADB_DSN")
  mycli "$uri" --ssl-ca=/etc/ssl/cert.pem --execute "$sql" 2>/dev/null
}

# provision <url_suffix> — POST /v1alpha1/mem9s with optional query params.
# Returns full curl response including status line.
provision() {
  local suffix="${1:-}"
  curl_json -X POST "${BASE}/v1alpha1/mem9s${suffix}"
}

# extract_id <body> — extracts the tenant id field from a JSON provision response.
extract_id() {
  printf '%s' "$1" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true
}

echo "========================================================"
echo "  mnemos UTM attribution smoke test"
echo "  Base URL    : $BASE"
echo "  DB checks   : $([ -n "$METADB_DSN" ] && echo enabled || echo 'SKIPPED (set MNEMO_METADB_DSN)')"
echo "  Started     : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================================"

# ============================================================================
# TEST 1 — Provision without UTM params
# ============================================================================
step "1" "Provision without UTM params"
resp=$(provision)
code=$(http_code "$resp")
bdy=$(body "$resp")
check "POST /v1alpha1/mem9s (no UTM) returns 201" "$code" "201"
TENANT_NO_UTM=$(extract_id "$bdy")
if [ -z "$TENANT_NO_UTM" ]; then
  fail "Could not extract tenant ID from response: $bdy"
  exit 1
fi
info "Tenant (no UTM): $TENANT_NO_UTM"

# ============================================================================
# TEST 2 — Provision with all 4 UTM params
# ============================================================================
step "2" "Provision with all 4 UTM params"
resp=$(provision "?utm_source=smoke-test&utm_medium=e2e&utm_campaign=ci-run&utm_content=banner-a")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "POST /v1alpha1/mem9s?utm_source=...&utm_medium=...&utm_campaign=...&utm_content=... returns 201" "$code" "201"
TENANT_FULL=$(extract_id "$bdy")
if [ -z "$TENANT_FULL" ]; then
  fail "Could not extract tenant ID from response: $bdy"
  exit 1
fi
info "Tenant (full UTM): $TENANT_FULL"

# ============================================================================
# TEST 3 — Provision with partial UTM params (source + campaign only)
# ============================================================================
step "3" "Provision with partial UTM params (source + campaign only)"
resp=$(provision "?utm_source=partial-test&utm_campaign=spring-launch")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "POST /v1alpha1/mem9s?utm_source=...&utm_campaign=... returns 201" "$code" "201"
TENANT_PARTIAL=$(extract_id "$bdy")
if [ -z "$TENANT_PARTIAL" ]; then
  fail "Could not extract tenant ID from response: $bdy"
  exit 1
fi
info "Tenant (partial UTM): $TENANT_PARTIAL"

# ============================================================================
# TEST 4 — Non-UTM query params are silently dropped
# ============================================================================
step "4" "Non-UTM params silently dropped"
resp=$(provision "?utm_source=legit&foo=bar&baz=qux")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "POST /v1alpha1/mem9s?utm_source=legit&foo=bar returns 201" "$code" "201"
TENANT_FILTERED=$(extract_id "$bdy")
if [ -z "$TENANT_FILTERED" ]; then
  fail "Could not extract tenant ID from response: $bdy"
  exit 1
fi
info "Tenant (filtered params): $TENANT_FILTERED"

# ============================================================================
# TEST 5 — Empty-value UTM param is dropped (utm_medium= is ignored)
# ============================================================================
step "5" "Empty-value UTM param dropped"
resp=$(provision "?utm_source=nonempty&utm_medium=&utm_campaign=also-set")
code=$(http_code "$resp")
bdy=$(body "$resp")
check "POST /v1alpha1/mem9s?utm_source=nonempty&utm_medium=&utm_campaign=also-set returns 201" "$code" "201"
TENANT_EMPTY_VAL=$(extract_id "$bdy")
if [ -z "$TENANT_EMPTY_VAL" ]; then
  fail "Could not extract tenant ID from response: $bdy"
  exit 1
fi
info "Tenant (empty-val UTM): $TENANT_EMPTY_VAL"

# ============================================================================
# DB VERIFICATION (tests 6-10) — requires MNEMO_METADB_DSN
# ============================================================================
if [ -z "$METADB_DSN" ]; then
  warn "Tests 6-10 skipped — set MNEMO_METADB_DSN to enable DB verification."
  warn "Example: MNEMO_METADB_DSN='user:pass@tcp(host:4000)/dbname' bash e2e/api-smoke-test-utm.sh"
else
  # ============================================================================
  # TEST 6 — No row for tenant provisioned without UTM
  # ============================================================================
  step "6" "DB: no tenant_utm row for no-UTM provision"
  UTM_ROW=$(db_query "SELECT COUNT(*) FROM tenant_utm WHERE tenant_id='${TENANT_NO_UTM}'" | tail -1 | tr -d '[:space:]')
  check "tenant_utm row count for no-UTM tenant is 0" "$UTM_ROW" "0"

  # ============================================================================
  # TEST 7 — All 4 UTM fields persisted for full-params tenant
  # ============================================================================
  step "7" "DB: all 4 UTM fields stored for full-params tenant"
  ROW=$(db_query "SELECT source, medium, campaign, content FROM tenant_utm WHERE tenant_id='${TENANT_FULL}'" | tail -1)
  check_contains "source=smoke-test in row" "$ROW" "smoke-test"
  check_contains "medium=e2e in row" "$ROW" "e2e"
  check_contains "campaign=ci-run in row" "$ROW" "ci-run"
  check_contains "content=banner-a in row" "$ROW" "banner-a"

  # ============================================================================
  # TEST 8 — Only non-empty params stored for partial-params tenant
  # ============================================================================
  step "8" "DB: only provided params stored for partial-params tenant"
  ROW=$(db_query "SELECT source, medium, campaign, content FROM tenant_utm WHERE tenant_id='${TENANT_PARTIAL}'" | tail -1)
  check_contains "source=partial-test in row" "$ROW" "partial-test"
  check_contains "campaign=spring-launch in row" "$ROW" "spring-launch"

  # ============================================================================
  # TEST 9 — Non-UTM params absent from row
  # ============================================================================
  step "9" "DB: non-UTM params not stored"
  ROW=$(db_query "SELECT source, medium, campaign, content FROM tenant_utm WHERE tenant_id='${TENANT_FILTERED}'" | tail -1)
  check_contains "source=legit in row" "$ROW" "legit"
  check_not_contains "foo=bar not in row" "$ROW" "bar"
  check_not_contains "baz=qux not in row" "$ROW" "qux"

  # ============================================================================
  # TEST 10 — Empty-value param absent from row
  # ============================================================================
  step "10" "DB: empty-value UTM param not stored"
  # medium was sent as empty string — the column should be NULL
  MEDIUM_VAL=$(db_query "SELECT IFNULL(medium,'NULL') FROM tenant_utm WHERE tenant_id='${TENANT_EMPTY_VAL}'" | tail -1 | tr -d '[:space:]')
  check "medium column is NULL for empty-value param" "$MEDIUM_VAL" "NULL"
  SOURCE_VAL=$(db_query "SELECT source FROM tenant_utm WHERE tenant_id='${TENANT_EMPTY_VAL}'" | tail -1 | tr -d '[:space:]')
  check "source column is nonempty" "$SOURCE_VAL" "nonempty"
fi

echo ""
echo "========================================================"
echo "  RESULTS: $PASS / $TOTAL passed, $FAIL failed"
echo "  Base URL : $BASE"
if [ "$FAIL" -eq 0 ]; then
  echo -e "  ${GREEN}All tests passed.${RESET}"
else
  echo -e "  ${RED}$FAIL test(s) failed.${RESET}"
fi
echo "  Finished : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================================"

exit "$FAIL"
