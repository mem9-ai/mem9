#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

STUB_CURL="${TMP_DIR}/curl"
cat > "${STUB_CURL}" <<'SH'
#!/usr/bin/env bash
cat <<'EOF'
{"error":"Post-quota rate limit exceeded.","details":{"errorCategory":"runtime_quota_denied","runtimeQuota":{"meter":"memory_recall_requests"}}}
429
EOF
SH
chmod +x "${STUB_CURL}"

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
