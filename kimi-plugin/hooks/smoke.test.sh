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
# without -w and must get a bare body. Requests carry their URL and headers in
# a -K config file and bodies on stdin (--data-binary @-); the stub logs argv,
# the config file contents, and any stdin body so assertions can match them.
cat > "${MEM9_CURL_BIN}" <<'SH'
#!/usr/bin/env bash
args="$*"
combined="${args}"
prev=""
for a in "$@"; do
  if [ "${prev}" = "-K" ]; then
    combined="${combined}
$(cat "$a")"
  fi
  prev="$a"
done
case "${args}" in
  *"--data-binary @-"*)
    combined="${combined}
$(cat)"
    ;;
esac
printf '%s\n' "${combined}" >> "${MEM9_SMOKE_REQ_LOG}"
case "${combined}" in
  *v1alpha1/mem9s*) printf '{"id":"provisioned-key-123"}' ;;
  *runtime-state*) printf '{}' ;;
  *"/memories?q="*) printf '{"memories":[{"id":"m1","content":"remember the deploy window is Friday","tags":["deploy"],"relative_age":"2d"}]}' ;;
  *"-X POST"*) printf '{}' ;;
  *) printf '{}' ;;
esac
case "${args}" in
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

# --- fixture with oversized messages for byte-cap tests ---
SESSION_BIG_DIR="${KIMI_HOME}/sessions/wd_proj_abc/session_big"
mkdir -p "${SESSION_BIG_DIR}/agents/main"
node -e '
const fs = require("fs");
const dir = process.argv[1];
const lines = [
  JSON.stringify({ type: "metadata", protocol_version: "1.5", created_at: 1 }),
  JSON.stringify({ type: "context.append_message", agentId: "main", message: { role: "user", content: [{ type: "text", text: "u".repeat(4000) }], origin: { kind: "user" }, id: "b1" }, time: 2 }),
  JSON.stringify({ type: "context.append_loop_event", agentId: "main", event: { type: "content.part", turnId: "0", stepUuid: "s1", part: { type: "text", text: "a".repeat(4000) } }, time: 3 }),
];
fs.writeFileSync(dir + "/agents/main/wire.jsonl", lines.join("\n") + "\n");
' "${SESSION_BIG_DIR}"
printf '{"sessionId":"session_big","sessionDir":"%s","workDir":"/tmp/proj"}\n' \
  "${SESSION_BIG_DIR}" >> "${KIMI_HOME}/session_index.jsonl"

# --- fixture with multibyte characters for UTF-8 boundary truncation ---
SESSION_UTF8_DIR="${KIMI_HOME}/sessions/wd_proj_abc/session_utf8"
mkdir -p "${SESSION_UTF8_DIR}/agents/main"
node -e '
const fs = require("fs");
const dir = process.argv[1];
const lines = [
  JSON.stringify({ type: "metadata", protocol_version: "1.5", created_at: 1 }),
  JSON.stringify({ type: "context.append_message", agentId: "main", message: { role: "user", content: [{ type: "text", text: "é".repeat(2000) }], origin: { kind: "user" }, id: "u1" }, time: 2 }),
];
fs.writeFileSync(dir + "/agents/main/wire.jsonl", lines.join("\n") + "\n");
' "${SESSION_UTF8_DIR}"
printf '{"sessionId":"session_utf8","sessionDir":"%s","workDir":"/tmp/proj"}\n' \
  "${SESSION_UTF8_DIR}" >> "${KIMI_HOME}/session_index.jsonl"

# --- fixture with more assistant messages than the message cap ---
SESSION_MANY_DIR="${KIMI_HOME}/sessions/wd_proj_abc/session_many"
mkdir -p "${SESSION_MANY_DIR}/agents/main"
node -e '
const fs = require("fs");
const dir = process.argv[1];
const lines = [
  JSON.stringify({ type: "metadata", protocol_version: "1.5", created_at: 1 }),
  JSON.stringify({ type: "context.append_message", agentId: "main", message: { role: "user", content: [{ type: "text", text: "the deploy window fact" }], origin: { kind: "user" }, id: "t1" }, time: 2 }),
];
for (let i = 0; i < 5; i += 1) {
  lines.push(JSON.stringify({ type: "context.append_loop_event", agentId: "main", event: { type: "content.part", turnId: String(i), stepUuid: "s" + i, part: { type: "text", text: "assistant turn " + i } }, time: 3 + i }));
}
fs.writeFileSync(dir + "/agents/main/wire.jsonl", lines.join("\n") + "\n");
' "${SESSION_MANY_DIR}"
printf '{"sessionId":"session_many","sessionDir":"%s","workDir":"/tmp/proj"}\n' \
  "${SESSION_MANY_DIR}" >> "${KIMI_HOME}/session_index.jsonl"

# --- fixture: oversized middle assistant message between user and reply ---
SESSION_GAP_DIR="${KIMI_HOME}/sessions/wd_proj_abc/session_gap"
mkdir -p "${SESSION_GAP_DIR}/agents/main"
node -e '
const fs = require("fs");
const dir = process.argv[1];
const lines = [
  JSON.stringify({ type: "metadata", protocol_version: "1.5", created_at: 1 }),
  JSON.stringify({ type: "context.append_message", agentId: "main", message: { role: "user", content: [{ type: "text", text: "gap user prompt" }], origin: { kind: "user" }, id: "g1" }, time: 2 }),
  JSON.stringify({ type: "context.append_loop_event", agentId: "main", event: { type: "content.part", turnId: "0", stepUuid: "s0", part: { type: "text", text: "a".repeat(4000) } }, time: 3 }),
  JSON.stringify({ type: "context.append_loop_event", agentId: "main", event: { type: "content.part", turnId: "1", stepUuid: "s1", part: { type: "text", text: "short final reply" } }, time: 4 }),
];
fs.writeFileSync(dir + "/agents/main/wire.jsonl", lines.join("\n") + "\n");
' "${SESSION_GAP_DIR}"
printf '{"sessionId":"session_gap","sessionDir":"%s","workDir":"/tmp/proj"}\n' \
  "${SESSION_GAP_DIR}" >> "${KIMI_HOME}/session_index.jsonl"

# --- fixture: emoji-led user prompt crowded out by assistant bulk ---
SESSION_EMOJI_DIR="${KIMI_HOME}/sessions/wd_proj_abc/session_emoji"
mkdir -p "${SESSION_EMOJI_DIR}/agents/main"
node -e '
const fs = require("fs");
const dir = process.argv[1];
const lines = [
  JSON.stringify({ type: "metadata", protocol_version: "1.5", created_at: 1 }),
  JSON.stringify({ type: "context.append_message", agentId: "main", message: { role: "user", content: [{ type: "text", text: "🚀 launch checklist review" }], origin: { kind: "user" }, id: "e1" }, time: 2 }),
  JSON.stringify({ type: "context.append_loop_event", agentId: "main", event: { type: "content.part", turnId: "0", stepUuid: "s0", part: { type: "text", text: "a".repeat(19999) } }, time: 3 }),
];
fs.writeFileSync(dir + "/agents/main/wire.jsonl", lines.join("\n") + "\n");
' "${SESSION_EMOJI_DIR}"
printf '{"sessionId":"session_emoji","sessionDir":"%s","workDir":"/tmp/proj"}\n' \
  "${SESSION_EMOJI_DIR}" >> "${KIMI_HOME}/session_index.jsonl"

# --- fixture: quote-heavy oversized turn (payload JSON exceeds Linux's
# --- 128 KiB per-env-string limit, so env-passing would fail with E2BIG) ---
SESSION_LARGE_DIR="${KIMI_HOME}/sessions/wd_proj_abc/session_large"
mkdir -p "${SESSION_LARGE_DIR}/agents/main"
node -e '
const fs = require("fs");
const dir = process.argv[1];
const lines = [
  JSON.stringify({ type: "metadata", protocol_version: "1.5", created_at: 1 }),
  JSON.stringify({ type: "context.append_message", agentId: "main", message: { role: "user", content: [{ type: "text", text: "\"".repeat(119000) }], origin: { kind: "user" }, id: "L1" }, time: 2 }),
  JSON.stringify({ type: "context.append_loop_event", agentId: "main", event: { type: "content.part", turnId: "0", stepUuid: "s0", part: { type: "text", text: "large reply" } }, time: 3 }),
];
fs.writeFileSync(dir + "/agents/main/wire.jsonl", lines.join("\n") + "\n");
' "${SESSION_LARGE_DIR}"
printf '{"sessionId":"session_large","sessionDir":"%s","workDir":"/tmp/proj"}\n' \
  "${SESSION_LARGE_DIR}" >> "${KIMI_HOME}/session_index.jsonl"

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
check "credentials file mode 600" 'node -e "process.exit((require(\"fs\").statSync(process.argv[1]).mode & 0o777) === 0o600 ? 0 : 1)" "${MEM9_HOME}/.credentials.json"'

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

# 2c. MEM9_API_URL env override wins over the saved profile baseUrl
: > "${REQ_LOG}"
out=$(printf '%s' '{"hook_event_name":"UserPromptSubmit","session_id":"session_test123","prompt":"deploy?","cwd":"/tmp/proj"}' | MEM9_API_URL="https://override.example" bash "${PLUGIN_ROOT}/hooks/user-prompt-submit.sh")
check "env API URL overrides profile baseUrl" 'grep -q "https://override.example/v1alpha2/mem9s/memories" "${REQ_LOG}"'

# 2d. Without an env override, the saved profile baseUrl wins over the cloud default
node -e '
const fs = require("fs");
const p = process.argv[1];
const d = JSON.parse(fs.readFileSync(p, "utf8"));
d.profiles.default.baseUrl = "https://selfhost.example";
fs.writeFileSync(p, JSON.stringify(d, null, 2));
' "${MEM9_HOME}/.credentials.json"
: > "${REQ_LOG}"
out=$(printf '%s' '{"hook_event_name":"UserPromptSubmit","session_id":"session_test123","prompt":"deploy?","cwd":"/tmp/proj"}' | bash "${PLUGIN_ROOT}/hooks/user-prompt-submit.sh")
check "profile baseUrl wins when no env override" 'grep -q "https://selfhost.example/v1alpha2/mem9s/memories" "${REQ_LOG}"'
node -e '
const fs = require("fs");
const p = process.argv[1];
const d = JSON.parse(fs.readFileSync(p, "utf8"));
d.profiles.default.baseUrl = "https://api.mem9.ai";
fs.writeFileSync(p, JSON.stringify(d, null, 2));
' "${MEM9_HOME}/.credentials.json"

# 2e. Missing-key repair: profile URL is carried into re-provisioning
node -e '
const fs = require("fs");
const p = process.argv[1];
const d = JSON.parse(fs.readFileSync(p, "utf8"));
d.profiles.default = { label: "default", baseUrl: "https://selfhost.example", apiKey: "" };
fs.writeFileSync(p, JSON.stringify(d, null, 2));
' "${MEM9_HOME}/.credentials.json"
: > "${REQ_LOG}"
out=$(printf '%s' '{"hook_event_name":"SessionStart","session_id":"session_test123","source":"startup","cwd":"/tmp/proj"}' | bash "${PLUGIN_ROOT}/hooks/session-start.sh")
check "re-provision targets profile baseUrl" 'grep -q "https://selfhost.example/v1alpha1/mem9s" "${REQ_LOG}"'
check "re-provision keeps profile baseUrl" 'node -e "
const d = JSON.parse(require(\"fs\").readFileSync(process.argv[1], \"utf8\"));
process.exit(d.profiles.default.baseUrl === \"https://selfhost.example\" && d.profiles.default.apiKey === \"provisioned-key-123\" ? 0 : 1);
" "${MEM9_HOME}/.credentials.json"'
node -e '
const fs = require("fs");
const p = process.argv[1];
const d = JSON.parse(fs.readFileSync(p, "utf8"));
d.profiles.default.baseUrl = "https://api.mem9.ai";
fs.writeFileSync(p, JSON.stringify(d, null, 2));
' "${MEM9_HOME}/.credentials.json"

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

# 6. runtime notice state: hashes only, dedup works, file mode 600
NOTICE_FILE="${KIMI_HOME}/mem9/runtime-notices.json"
claim_result=$(NOTICE_FILE="${NOTICE_FILE}" PLUGIN_ROOT="${PLUGIN_ROOT}" node --input-type=module -e '
const { claimRuntimeNotice } = await import("file://" + process.env.PLUGIN_ROOT + "/hooks/lib/runtime-notice-state.mjs");
const f = process.env.NOTICE_FILE;
const first = claimRuntimeNotice({ stateFile: f, sessionID: "s1", message: "claim at https://x/claim?key=secret-key-abc" });
const second = claimRuntimeNotice({ stateFile: f, sessionID: "s1", message: "claim at https://x/claim?key=secret-key-abc" });
process.stdout.write([first, second].join(","));
')
check "notice claimed once per session" '[ "${claim_result}" = "true,false" ]'
check "notice raw text not persisted" '! grep -q "secret-key-abc" "${NOTICE_FILE}"'
check "notice hash persisted" 'grep -q "sha256:" "${NOTICE_FILE}"'
check "notice state file mode 600" 'node -e "process.exit((require(\"fs\").statSync(process.argv[1]).mode & 0o777) === 0o600 ? 0 : 1)" "${NOTICE_FILE}"'

# 7. wire-parser byte cap: oversized messages truncated, user message kept
big_out=$(node "${PLUGIN_ROOT}/hooks/lib/wire-parser.mjs" --session-id session_big --cwd /tmp/proj --mode stop --max-bytes 1000)
check "byte cap enforced on oversized messages" 'printf "%s" "${big_out}" | node -e "
const fs = require(\"fs\");
const msgs = JSON.parse(fs.readFileSync(0, \"utf8\")).messages;
const total = msgs.reduce((n, m) => n + Buffer.byteLength(m.content), 0);
process.exit(msgs.length > 0 && total <= 1000 ? 0 : 1);
"'
check "window keeps the user message" 'printf "%s" "${big_out}" | node -e "
const fs = require(\"fs\");
const msgs = JSON.parse(fs.readFileSync(0, \"utf8\")).messages;
process.exit(msgs.some((m) => m.role === \"user\") ? 0 : 1);
"'

# 8. truncation never splits a UTF-8 code point (no U+FFFD, cap still hard)
utf8_out=$(node "${PLUGIN_ROOT}/hooks/lib/wire-parser.mjs" --session-id session_utf8 --cwd /tmp/proj --mode stop --max-bytes 3)
check "truncation respects byte cap mid-character" 'printf "%s" "${utf8_out}" | node -e "
const fs = require(\"fs\");
const msgs = JSON.parse(fs.readFileSync(0, \"utf8\")).messages;
const total = msgs.reduce((n, m) => n + Buffer.byteLength(m.content), 0);
process.exit(msgs.length === 1 && total <= 3 ? 0 : 1);
"'
check "truncation emits no replacement character" 'printf "%s" "${utf8_out}" | node -e "
const fs = require(\"fs\");
const msgs = JSON.parse(fs.readFileSync(0, \"utf8\")).messages;
process.exit(msgs.every((m) => !m.content.includes(\"\\uFFFD\")) ? 0 : 1);
"'

# 9. message cap keeps the latest user message (tool-heavy turns)
many_out=$(node "${PLUGIN_ROOT}/hooks/lib/wire-parser.mjs" --session-id session_many --cwd /tmp/proj --mode stop --max-messages 4)
check "message cap keeps user message" 'printf "%s" "${many_out}" | node -e "
const fs = require(\"fs\");
const msgs = JSON.parse(fs.readFileSync(0, \"utf8\")).messages;
process.exit(msgs.length <= 4 && msgs[0].role === \"user\" && msgs[0].content.includes(\"deploy window fact\") ? 0 : 1);
"'

# 10. byte budget: oversized middle message is skipped, user prompt retained
gap_out=$(node "${PLUGIN_ROOT}/hooks/lib/wire-parser.mjs" --session-id session_gap --cwd /tmp/proj --mode stop --max-bytes 1000)
check "oversized middle message skipped" 'printf "%s" "${gap_out}" | node -e "
const fs = require(\"fs\");
const msgs = JSON.parse(fs.readFileSync(0, \"utf8\")).messages;
const total = msgs.reduce((n, m) => n + Buffer.byteLength(m.content), 0);
process.exit(msgs.length === 2 && total <= 1000 && msgs[0].content.includes(\"gap user prompt\") && msgs[1].content.includes(\"short final reply\") ? 0 : 1);
"'

# 11. recall formatter truncates at code-point boundaries (no split surrogates)
long_content=$(node -e 'process.stdout.write("a".repeat(499) + "🎉" + "b".repeat(50))')
fmt_out=$(printf '{"memories":[{"id":"m1","content":"%s","tags":[],"relative_age":"1d"}]}' "${long_content}" | node "${PLUGIN_ROOT}/hooks/lib/memories-formatter.mjs")
check "recall truncation is surrogate-safe" 'printf "%s" "${fmt_out}" | node -e "
const fs = require(\"fs\");
const out = fs.readFileSync(0, \"utf8\");
process.exit(!out.includes(\"\\uFFFD\") && out.includes(\"🎉\") ? 0 : 1);
"'

# 12. byte budget reserves a complete code point for the user prompt
emoji_out=$(node "${PLUGIN_ROOT}/hooks/lib/wire-parser.mjs" --session-id session_emoji --cwd /tmp/proj --mode stop --max-bytes 20000)
check "user prompt reserved over assistant bulk" 'printf "%s" "${emoji_out}" | node -e "
const fs = require(\"fs\");
const msgs = JSON.parse(fs.readFileSync(0, \"utf8\")).messages;
process.exit(msgs.length === 1 && msgs[0].role === \"user\" && msgs[0].content.includes(\"launch checklist\") ? 0 : 1);
"'

# 13. lib entrypoints work through symlinked plugin paths (macOS /tmp)
ln -s "${PLUGIN_ROOT}" "${TMP_DIR}/plugin-link"
link_out=$(printf '{"source":"startup"}' | node "${TMP_DIR}/plugin-link/hooks/lib/hook-json.mjs" get-string source)
check "lib works through symlinked path" '[ "${link_out}" = "startup" ]'

# 14. PreCompact with a quote-heavy 119 KB turn: payload JSON (~238 KB escaped)
# exceeds Linux's per-env-string limit, so it must travel over stdin
: > "${REQ_LOG}"
out=$(printf '{"hook_event_name":"PreCompact","session_id":"session_large","trigger":"auto","cwd":"/tmp/proj"}' | bash "${PLUGIN_ROOT}/hooks/pre-compact.sh")
check "large precompact stdout empty" '[ -z "${out}" ]'
check "large payload ingested" 'grep -qF "\"session_id\":\"session_large\"" "${REQ_LOG}"'
check "large payload content present" 'grep -qE "(\\\\\"){200}" "${REQ_LOG}"'

# 15. auth failures are logged distinctly (status captured before negation)
DEBUG_LOG="${KIMI_HOME}/mem9/logs/hooks.jsonl"
rm -f "${MEM9_HOME}/.credentials.json"
printf '%s' '{"hook_event_name":"UserPromptSubmit","session_id":"session_test123","prompt":"deploy?","cwd":"/tmp/proj"}' | bash "${PLUGIN_ROOT}/hooks/user-prompt-submit.sh"
check "missing credentials logged as auth_missing" 'grep -q "\"stage\":\"auth_missing\"" "${DEBUG_LOG}"'
printf 'not json' > "${MEM9_HOME}/.credentials.json"
printf '%s' '{"hook_event_name":"UserPromptSubmit","session_id":"session_test123","prompt":"deploy?","cwd":"/tmp/proj"}' | bash "${PLUGIN_ROOT}/hooks/user-prompt-submit.sh"
check "invalid credentials logged as auth_invalid" 'grep -q "\"stage\":\"auth_invalid\"" "${DEBUG_LOG}"'

# 16. failed credentials upsert (rename over a directory) leaves no temp key file
rm -f "${MEM9_HOME}/.credentials.json"
mkdir "${MEM9_HOME}/.credentials.json"
printf '%s' '{"hook_event_name":"SessionStart","session_id":"session_test123","source":"startup","cwd":"/tmp/proj"}' | bash "${PLUGIN_ROOT}/hooks/session-start.sh" || true
check "failed upsert leaves no temp key file" 'if ls "${MEM9_HOME}"/.credentials.json.*.tmp >/dev/null 2>&1; then false; else true; fi'

printf 'PASS=%d FAIL=%d\n' "${pass}" "${fail}"
if [ "${fail}" -ne 0 ]; then
  exit 1
fi
