#!/usr/bin/env bash
#
# Network-free integration test for the kimi-plugin hooks.
# Stubs curl via MEM9_CURL_BIN and exercises every hook end to end
# against a fixture Kimi session (session_index.jsonl + wire.jsonl).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

KIMI_HOME="${TMP_DIR}/kimi-home"
MEM9_HOME_DIR="${TMP_DIR}/mem9-home"
REQ_LOG="${TMP_DIR}/requests.log"
SESSION_DIR="${KIMI_HOME}/sessions/wd_proj_abc/session_test123"
mkdir -p "${SESSION_DIR}/agents/main" "${MEM9_HOME_DIR}"
: > "${REQ_LOG}"

unset MEM9_API_KEY MEM9_API_URL MEM9_AGENT_ID MEM9_WRITER_ID 2>/dev/null || true
export KIMI_CODE_HOME="${KIMI_HOME}"
export MEM9_HOME="${MEM9_HOME_DIR}"
export KIMI_PLUGIN_ROOT="${PLUGIN_ROOT}"
export MEM9_CURL_BIN="${TMP_DIR}/curl-stub"
export MEM9_DEBUG=1
export MEM9_SMOKE_REQ_LOG="${REQ_LOG}"

# --- stub curl ---
# Emulates `curl -w '\n%{http_code}'` by appending a newline + status code only
# when the invocation asks for %{http_code}; the provision call uses -sf
# without -w and must get a bare body.
cat > "${MEM9_CURL_BIN}" <<'SH'
#!/usr/bin/env bash
args="$*"
printf '%s\n' "$args" >> "${MEM9_SMOKE_REQ_LOG}"
case "$args" in
  *v1alpha1/mem9s*) printf '{"id":"provisioned-key-123"}' ;;
  *runtime-state*) printf '{}' ;;
  *"/memories?q="*) printf '{"memories":[{"id":"m1","content":"remember the deploy window is Friday","tags":["deploy"],"relative_age":"2d"}]}' ;;
  *"-X POST"*) printf '{}' ;;
  *) printf '{}' ;;
esac
case "$args" in
  *'%{http_code}'*) printf '\n200' ;;
esac
SH
chmod +x "${MEM9_CURL_BIN}"

# --- fixture wire.jsonl + session index ---
cat > "${SESSION_DIR}/agents/main/wire.jsonl" <<'EOF'
{"type":"metadata","protocol_version":"1.5","created_at":1789052000000}
{"type":"context.append_message","agentId":"main","message":{"role":"user","content":[{"type":"text","text":"How do I deploy the server?"}],"origin":{"kind":"user"},"id":"m1"},"time":1789052001000}
{"type":"context.append_loop_event","agentId":"main","event":{"type":"content.part","turnId":"0","stepUuid":"s1","part":{"type":"think","think":"hmm"}},"time":1789052002000}
{"type":"context.append_loop_event","agentId":"main","event":{"type":"content.part","turnId":"0","stepUuid":"s1","part":{"type":"text","text":"Run make build, then deploy via the pipeline."}},"time":1789052003000}
{"type":"context.append_message","agentId":"main","message":{"role":"user","content":[{"type":"text","text":"injected reminder"}],"origin":{"kind":"injection","variant":"date_change"},"id":"m2"},"time":1789052004000}
EOF
printf '{"sessionId":"session_test123","sessionDir":"%s","workDir":"/tmp/proj"}\n' \
  "${SESSION_DIR}" > "${KIMI_HOME}/session_index.jsonl"

pass=0
fail=0
check() {
  if eval "$2"; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL: %s\n' "$1" >&2
  fi
}

# 1. SessionStart: provisions, upserts shared credentials, empty stdout
out=$(printf '{"hook_event_name":"SessionStart","session_id":"session_test123","source":"startup","cwd":"/tmp/proj"}' | bash "${PLUGIN_ROOT}/hooks/session-start.sh")
check "session-start stdout empty" '[ -z "${out}" ]'
check "credentials upserted" 'grep -q "\"provisioned-key-123\"" "${MEM9_HOME}/.credentials.json"'
check "schemaVersion preserved" 'grep -q "\"schemaVersion\": 1" "${MEM9_HOME}/.credentials.json"'

# 1b. pre-existing second profile must survive the upsert
node -e '
const fs = require("fs");
const p = process.argv[1];
const d = JSON.parse(fs.readFileSync(p, "utf8"));
d.profiles.work = { label: "Work", baseUrl: "https://x", apiKey: "wk" };
fs.writeFileSync(p, JSON.stringify(d, null, 2));
' "${MEM9_HOME}/.credentials.json"
out=$(printf '{"hook_event_name":"SessionStart","session_id":"session_test123","source":"startup","cwd":"/tmp/proj"}' | bash "${PLUGIN_ROOT}/hooks/session-start.sh")
check "existing profiles not clobbered" 'grep -q "provisioned-key-123" "${MEM9_HOME}/.credentials.json" && grep -q "\"wk\"" "${MEM9_HOME}/.credentials.json"'

# 2. UserPromptSubmit recall (string prompt)
out=$(printf '{"hook_event_name":"UserPromptSubmit","session_id":"session_test123","prompt":"when is the deploy?","cwd":"/tmp/proj"}' | bash "${PLUGIN_ROOT}/hooks/user-prompt-submit.sh")
check "recall injects memory content" '[[ "${out}" == *"deploy window is Friday"* ]]'
check "recall output is plain text (no hookSpecificOutput)" '[[ "${out}" != *hookSpecificOutput* ]]'
check "recall used shared key header" 'grep -q "X-API-Key: provisioned-key-123" "${REQ_LOG}"'
check "recall writer id header" 'grep -q "X-Mnemo-Agent-Id: kimi-code" "${REQ_LOG}"'

# 2b. UserPromptSubmit with content-part array prompt
out=$(printf '{"hook_event_name":"UserPromptSubmit","session_id":"session_test123","prompt":[{"type":"text","text":"deploy?"},{"type":"image","url":"blobref:x"}],"cwd":"/tmp/proj"}' | bash "${PLUGIN_ROOT}/hooks/user-prompt-submit.sh")
check "array prompt handled" '[[ "${out}" == *"deploy window is Friday"* ]]'

# 3. Stop: ingests from wire.jsonl, empty stdout
: > "${REQ_LOG}"
out=$(printf '{"hook_event_name":"Stop","session_id":"session_test123","stop_hook_active":false,"cwd":"/tmp/proj"}' | bash "${PLUGIN_ROOT}/hooks/stop.sh")
check "stop stdout empty" '[ -z "${out}" ]'
check "stop ingested user message" 'grep -q "How do I deploy the server?" "${REQ_LOG}"'
check "stop ingested assistant text" 'grep -q "make build, then deploy" "${REQ_LOG}"'
check "stop excluded injection" '! grep -q "injected reminder" "${REQ_LOG}"'
check "stop excluded think parts" '! grep -q "hmm" "${REQ_LOG}"'
check "ingest agent id" 'grep -q "kimi-code-main" "${REQ_LOG}"'
check "ingest mode smart" 'grep -qF "\"mode\":\"smart\"" "${REQ_LOG}"'

# 4. PreCompact + SessionEnd run clean
out=$(printf '{"hook_event_name":"PreCompact","session_id":"session_test123","trigger":"auto","cwd":"/tmp/proj"}' | bash "${PLUGIN_ROOT}/hooks/pre-compact.sh")
check "precompact stdout empty" '[ -z "${out}" ]'
out=$(printf '{"hook_event_name":"SessionEnd","session_id":"session_test123","reason":"exit","cwd":"/tmp/proj"}' | bash "${PLUGIN_ROOT}/hooks/session-end.sh")
check "sessionend stdout empty" '[ -z "${out}" ]'

# 5. debug log location
check "debug log under KIMI_CODE_HOME" '[ -f "${KIMI_CODE_HOME}/mem9/logs/hooks.jsonl" ]'

printf 'PASS=%d FAIL=%d\n' "${pass}" "${fail}"
if [ "${fail}" -ne 0 ]; then
  exit 1
fi
