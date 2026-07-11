#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

STUB_CURL="${TMP_DIR}/curl"
cat > "${STUB_CURL}" <<'SH'
#!/usr/bin/env bash
case "$*" in
  *"User-Agent: ${EXPECTED_MEM9_UA}"* ) ;;
  *)
    printf 'missing mem9 plugin user agent: %s\n' "$*" >&2
    exit 2
    ;;
esac

case "$*" in
  *"/v1alpha1/mem9s"*)
    cat <<'EOF'
{"id":"mem9_new"}
EOF
    ;;
  *"/runtime-state"*)
    cat <<'EOF'
{"mem9ApiKey":{"status":"active"},"meters":[{"meter":"memory_recall_requests","budgets":[{"type":"includedQuota","state":"warning","usage":{"percent":82,"remaining":18},"capacity":{"type":"limited","value":100}}]}]}
200
EOF
    ;;
  *)
    cat <<'EOF'
{"error":"Post-quota rate limit exceeded.","details":{"errorCategory":"runtime_quota_denied","runtimeQuota":{"meter":"memory_recall_requests"}}}
429
EOF
    ;;
esac
SH
chmod +x "${STUB_CURL}"

EXPECTED_MEM9_UA="mem9-plugin/claude-code/$(node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(data.version);' "${SCRIPT_DIR}/../.claude-plugin/plugin.json")"
export EXPECTED_MEM9_UA
export CLAUDE_PLUGIN_DATA="${TMP_DIR}/data"
export MEM9_API_KEY="mem9_test"
export MEM9_API_URL="https://api.mem9.ai"
export MEM9_CURL_BIN="${STUB_CURL}"
export MEM9_WRITER_ID="claude-code-test"

# shellcheck source=/dev/null
source "${SCRIPT_DIR}/common.sh"

response=""
if response="$(mem9_api_get "/memories?q=test&limit=10" 2>/dev/null)"; then
  printf 'expected mem9_api_get to fail for HTTP 429\n' >&2
  exit 1
fi

notice="$(printf '%s' "${response}" | mem9_quota_notice_from_body "recall paused")"

case "${notice}" in
  *"temporary request limit"* ) ;;
  *)
    printf 'expected rate-limit guidance, got: %s\n' "${notice}" >&2
    exit 1
    ;;
esac

case "${notice}" in
  *"quota/rate-limit check blocked this request"* ) ;;
  *)
    printf 'expected generic quota/rate-limit action, got: %s\n' "${notice}" >&2
    exit 1
    ;;
esac

runtime_notice="$(mem9_runtime_state_notice "SessionStart")"
case "${runtime_notice}" in
  *"mem9 recall is at 82% of its included quota"* ) ;;
  *)
    printf 'expected runtime-state guidance, got: %s\n' "${runtime_notice}" >&2
    exit 1
    ;;
esac

inactive_notice="$(
  printf '{"mem9ApiKey":{"status":"inactive"},"meters":[{"meter":"memory_recall_requests","budgets":[{"type":"includedQuota","state":"unlimited"}]}]}' \
    | node "${SCRIPT_DIR}/lib/runtime-state.mjs"
)"
case "${inactive_notice}" in
  *"Mem9 API key is inactive"*"rerun mem9 setup or create a new mem9 API key"* ) ;;
  *)
    printf 'expected inactive API key guidance, got: %s\n' "${inactive_notice}" >&2
    exit 1
    ;;
esac

notice_state_file="${TMP_DIR}/runtime-notices.json"
formatter_notice="$(
  printf '%s' '{"memories":[],"message":"mem9 recall has used 80% of included quota."}' \
    | MEM9_NOTICE_SESSION_ID="claude-session" MEM9_NOTICE_STATE_FILE="${notice_state_file}" \
      node "${SCRIPT_DIR}/lib/memories-formatter.mjs"
)"
case "${formatter_notice}" in
  *"<mem9-status-warning>"*"mem9 recall has used 80% of included quota."*"Mention this mem9 notice to the user once."* ) ;;
  *)
    printf 'expected response message status warning, got: %s\n' "${formatter_notice}" >&2
    exit 1
    ;;
esac

formatter_duplicate="$(
  printf '%s' '{"memories":[],"message":"mem9 recall has used 80% of included quota."}' \
    | MEM9_NOTICE_SESSION_ID="claude-session" MEM9_NOTICE_STATE_FILE="${notice_state_file}" \
      node "${SCRIPT_DIR}/lib/memories-formatter.mjs"
)"
if [[ -n "${formatter_duplicate}" ]]; then
  printf 'expected duplicate response message to be suppressed, got: %s\n' "${formatter_duplicate}" >&2
  exit 1
fi

stripped_context="$(
  node --input-type=module -e 'import { pathToFileURL } from "node:url"; const { stripInjectedMemories } = await import(pathToFileURL(process.argv[2])); process.stdout.write(stripInjectedMemories("keep\n<mem9-status-warning>\nhidden\n</mem9-status-warning>\n<relevant-memories>\nmemory\n</relevant-memories>\n<memory-context>\nlegacy\n</memory-context>\nend"));' \
    _ \
    "${SCRIPT_DIR}/lib/transcript-parser.mjs"
)"
case "${stripped_context}" in
  *hidden*|*memory*|*legacy* )
    printf 'expected injected context to be stripped, got: %s\n' "${stripped_context}" >&2
    exit 1
    ;;
  *keep*end* ) ;;
  *)
    printf 'expected original user content to remain, got: %s\n' "${stripped_context}" >&2
    exit 1
    ;;
esac

SESSION_ENV_FILE="${TMP_DIR}/session.env"
session_output="$(
  printf '{"source":"startup"}' | env -u MEM9_API_KEY \
    CLAUDE_PLUGIN_DATA="${TMP_DIR}/session-data" \
    CLAUDE_ENV_FILE="${SESSION_ENV_FILE}" \
    MEM9_API_URL="https://api.mem9.ai" \
    MEM9_CURL_BIN="${STUB_CURL}" \
    MEM9_WRITER_ID="claude-code-test" \
    bash "${SCRIPT_DIR}/session-start.sh"
)"

case "${session_output}" in
  *"Initialized automatically."*"mem9 recall is at 82% of its included quota"* ) ;;
  *)
    printf 'expected auto-provision runtime-state guidance, got: %s\n' "${session_output}" >&2
    exit 1
    ;;
esac

if ! grep -q 'MEM9_API_KEY=mem9_new' "${SESSION_ENV_FILE}"; then
  printf 'expected session env file to include provisioned api key\n' >&2
  exit 1
fi
