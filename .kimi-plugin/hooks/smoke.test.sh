#!/usr/bin/env bash
#
# Network-free smoke test for the mem9 Kimi Code hooks. Stubs curl via
# MEM9_CURL_BIN and exercises the hooks against a fixture Kimi session.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

KIMI_HOME="${TMP_DIR}/kimi-home"
MEM9_HOME_DIR="${TMP_DIR}/mem9-home"
REQ_LOG="${TMP_DIR}/requests.log"
SESSION_DIR="${KIMI_HOME}/sessions/wd_proj/session_1"
mkdir -p "${SESSION_DIR}/agents/main" "${MEM9_HOME_DIR}"
: > "${REQ_LOG}"

unset MEM9_API_KEY MEM9_API_URL 2>/dev/null || true
export KIMI_CODE_HOME="${KIMI_HOME}"
export MEM9_HOME="${MEM9_HOME_DIR}"
export MEM9_CURL_BIN="${TMP_DIR}/curl-stub"
export MEM9_SMOKE_REQ_LOG="${REQ_LOG}"

cat > "${MEM9_CURL_BIN}" <<'SH'
#!/usr/bin/env bash
args="$*"
body=""
case "$args" in *"--data-binary @-"*) body="$(cat)" ;; esac
printf '%s\n%s\n' "$args" "$body" >> "${MEM9_SMOKE_REQ_LOG}"
case "$args" in
  *v1alpha1/mem9s*) printf '{"id":"test-key-123"}' ;;
  *"/memories?q="*) printf '{"memories":[{"content":"deploy window is Friday","tags":["deploy"],"relative_age":"2d"}]}' ;;
  *) printf '{}' ;;
esac
SH
chmod +x "${MEM9_CURL_BIN}"

cat > "${SESSION_DIR}/agents/main/wire.jsonl" <<'EOF'
{"type":"metadata","protocol_version":"1.5","created_at":1}
{"type":"context.append_message","agentId":"main","message":{"role":"user","content":[{"type":"text","text":"How do I deploy?"}],"origin":{"kind":"user"},"id":"m1"},"time":2}
{"type":"context.append_loop_event","agentId":"main","event":{"type":"content.part","turnId":"0","stepUuid":"s1","part":{"type":"think","think":"hmm"}},"time":3}
{"type":"context.append_loop_event","agentId":"main","event":{"type":"content.part","turnId":"0","stepUuid":"s1","part":{"type":"text","text":"Run make build, then deploy."}},"time":4}
{"type":"context.append_message","agentId":"main","message":{"role":"user","content":[{"type":"text","text":"injected reminder"}],"origin":{"kind":"injection"},"id":"m2"},"time":5}
EOF
printf '{"sessionId":"session_1","sessionDir":"%s","workDir":"/tmp/proj"}\n' "${SESSION_DIR}" > "${KIMI_HOME}/session_index.jsonl"

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

# 1. SessionStart provisions and saves the key; stdout stays empty
out=$(printf '%s' '{"hook_event_name":"SessionStart","session_id":"session_1","source":"startup","cwd":"/tmp/proj"}' | bash "${PLUGIN_ROOT}/hooks/session-start.sh")
check "session-start stdout empty" '[ -z "${out}" ]'
check "key saved to shared credentials" 'grep -q "test-key-123" "${MEM9_HOME}/.credentials.json"'
check "credentials mode 600" 'node -e "process.exit((require(\"fs\").statSync(process.argv[1]).mode & 0o777) === 0o600 ? 0 : 1)" "${MEM9_HOME}/.credentials.json"'

# 2. Recall prints the memory as plain text (Kimi injects stdout directly)
out=$(printf '%s' '{"hook_event_name":"UserPromptSubmit","session_id":"session_1","prompt":"when is the deploy?","cwd":"/tmp/proj"}' | bash "${PLUGIN_ROOT}/hooks/user-prompt-submit.sh")
check "recall prints memory" '[[ "${out}" == *"deploy window is Friday"* ]]'
check "recall output is plain text" '[[ "${out}" != *hookSpecificOutput* && "${out}" != \{* ]]'

# 3. Stop ingests the last turn; injections and think parts are excluded
: > "${REQ_LOG}"
out=$(printf '%s' '{"hook_event_name":"Stop","session_id":"session_1","cwd":"/tmp/proj"}' | bash "${PLUGIN_ROOT}/hooks/stop.sh")
check "stop stdout empty" '[ -z "${out}" ]'
check "ingest sent user message" 'grep -q "How do I deploy?" "${REQ_LOG}"'
check "ingest sent assistant text" 'grep -q "make build, then deploy" "${REQ_LOG}"'
check "injection and think excluded" '! grep -q "injected reminder\|hmm" "${REQ_LOG}"'

# 4. No credentials: hooks go silently missing
rm -f "${MEM9_HOME}/.credentials.json"
out=$(printf '%s' '{"hook_event_name":"UserPromptSubmit","session_id":"session_1","prompt":"hi","cwd":"/tmp/proj"}' | bash "${PLUGIN_ROOT}/hooks/user-prompt-submit.sh")
check "recall silent without auth" '[ -z "${out}" ]'

printf 'PASS=%d FAIL=%d\n' "${pass}" "${fail}"
if [ "${fail}" -ne 0 ]; then
  exit 1
fi
