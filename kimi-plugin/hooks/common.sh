#!/usr/bin/env bash
# common.sh — Shared helpers for mem9 Kimi Code hooks.

set -euo pipefail

MEM9_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MEM9_API_URL="${MEM9_API_URL:-https://api.mem9.ai}"
MEM9_AGENT_ID="${MEM9_AGENT_ID:-kimi-code-main}"
MEM9_WRITER_ID="${MEM9_WRITER_ID:-kimi-code}"
MEM9_CURL_BIN="${MEM9_CURL_BIN:-curl}"
MEM9_AUTH_SOURCE="${MEM9_AUTH_SOURCE:-}"
MEM9_HTTP_STATUS_MARKER="__MEM9_HTTP_STATUS__="
MEM9_PLUGIN_USER_AGENT=""

mem9_require_node() {
  command -v node >/dev/null 2>&1 || return 1
  node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)'
}

mem9_plugin_data_dir() {
  printf '%s/mem9\n' "${KIMI_CODE_HOME:-$HOME/.kimi-code}"
}

mem9_debug_enabled() {
  case "${MEM9_DEBUG:-}" in
    1|true|TRUE|yes|YES|on|ON)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

mem9_debug_log_file() {
  if [[ -n "${MEM9_DEBUG_LOG_FILE:-}" ]]; then
    printf '%s\n' "${MEM9_DEBUG_LOG_FILE}"
    return 0
  fi

  local data_dir
  data_dir="$(mem9_plugin_data_dir)" || return 1
  printf '%s/logs/hooks.jsonl\n' "${data_dir}"
}

mem9_json_escape() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "${value}"
}

mem9_json_value() {
  local value="${1-}"

  case "${value}" in
    true|false|null)
      printf '%s' "${value}"
      return 0
      ;;
  esac

  if [[ "${value}" =~ ^-?[0-9]+$ ]] || [[ "${value}" =~ ^-?[0-9]+\.[0-9]+$ ]]; then
    printf '%s' "${value}"
    return 0
  fi

  printf '"%s"' "$(mem9_json_escape "${value}")"
}

mem9_debug() {
  mem9_debug_enabled || return 0

  local hook_name="$1"
  local stage="$2"
  shift 2

  local log_file
  log_file="$(mem9_debug_log_file)" || return 0
  mkdir -p "$(dirname "${log_file}")" 2>/dev/null || return 0

  local timestamp
  timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || printf 'unknown')"

  local fields
  fields='"ts":"'"$(mem9_json_escape "${timestamp}")"'","hook":"'"$(mem9_json_escape "${hook_name}")"'","stage":"'"$(mem9_json_escape "${stage}")"'"'

  while [[ "$#" -ge 2 ]]; do
    local key="$1"
    local value="$2"
    shift 2
    fields="${fields},\"$(mem9_json_escape "${key}")\":$(mem9_json_value "${value}")"
  done

  printf '{%s}\n' "${fields}" >> "${log_file}" 2>/dev/null || true
}

mem9_credentials_file() {
  printf '%s/.credentials.json\n' "${MEM9_HOME:-$HOME/.mem9}"
}

mem9_notice_state_file() {
  local data_dir
  data_dir="$(mem9_plugin_data_dir)" || return 1
  printf '%s/runtime-notices.json\n' "${data_dir}"
}

mem9_memory_base() {
  printf '%s\n' "${MEM9_API_URL%/}/v1alpha2/mem9s"
}

mem9_plugin_user_agent() {
  if [[ -n "${MEM9_PLUGIN_USER_AGENT}" ]]; then
    printf '%s\n' "${MEM9_PLUGIN_USER_AGENT}"
    return 0
  fi

  local version="unknown"
  local plugin_root="${KIMI_PLUGIN_ROOT:-${MEM9_SCRIPT_DIR}/..}"
  local manifest="${plugin_root}/kimi.plugin.json"
  if [[ -f "${manifest}" ]] && command -v node >/dev/null 2>&1; then
    version="$(node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(data.version || "unknown");' "${manifest}" 2>/dev/null || printf 'unknown')"
  fi

  MEM9_PLUGIN_USER_AGENT="mem9-plugin/kimi-code/${version}"
  printf '%s\n' "${MEM9_PLUGIN_USER_AGENT}"
}

mem9_hook_get_string() {
  local hook_input="$1"
  local key="$2"
  printf '%s' "${hook_input}" | node "${MEM9_SCRIPT_DIR}/lib/hook-json.mjs" get-string "${key}"
}

mem9_hook_get_prompt() {
  local hook_input="$1"
  printf '%s' "${hook_input}" | node "${MEM9_SCRIPT_DIR}/lib/hook-json.mjs" get-prompt
}

mem9_emit_context() {
  local event_name="$1"
  local text="$2"
  if mem9_require_node >/dev/null 2>&1; then
    node "${MEM9_SCRIPT_DIR}/lib/hook-json.mjs" emit-context "${event_name}" "${text}"
    return 0
  fi

  printf '%s' "${text}"
}

mem9_load_auth() {
  if [[ -n "${MEM9_API_KEY:-}" ]]; then
    MEM9_AUTH_SOURCE="env"
    export MEM9_API_URL MEM9_AGENT_ID MEM9_WRITER_ID MEM9_API_KEY
    return 0
  fi

  local credentials_file
  credentials_file="$(mem9_credentials_file)"
  [[ -f "${credentials_file}" ]] || return 1

  local parsed auth_api_url auth_api_key
  if ! parsed="$(node -e '
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const envBaseUrl = (process.argv[2] || "").trim();
const isRecord = (value) => value != null && typeof value === "object" && !Array.isArray(value);
const profiles = isRecord(data) && isRecord(data.profiles) ? data.profiles : {};
let profile = isRecord(profiles.default) ? profiles.default : null;
if (!profile) {
  const ids = Object.keys(profiles);
  if (ids.length === 1 && isRecord(profiles[ids[0]])) {
    profile = profiles[ids[0]];
  }
}
const profileBaseUrl = profile && typeof profile.baseUrl === "string" && profile.baseUrl.trim()
  ? profile.baseUrl.trim()
  : "";
const baseUrl = envBaseUrl || profileBaseUrl || "https://api.mem9.ai";
const apiKey = profile && typeof profile.apiKey === "string" ? profile.apiKey.trim() : "";
process.stdout.write([baseUrl, apiKey].join("\t"));
' "${credentials_file}" "${MEM9_API_URL}")"; then
    MEM9_AUTH_SOURCE="invalid_file"
    return 2
  fi

  IFS=$'\t' read -r auth_api_url auth_api_key <<< "${parsed}"
  if [[ -z "${auth_api_key}" ]]; then
    return 1
  fi

  MEM9_API_URL="${auth_api_url}"
  MEM9_API_KEY="${auth_api_key}"
  MEM9_AUTH_SOURCE="credentials_file"

  [[ -n "${MEM9_API_KEY}" ]] || return 1
  export MEM9_API_URL MEM9_AGENT_ID MEM9_WRITER_ID MEM9_API_KEY
}

mem9_upsert_default_profile() {
  local api_key="$1"
  local credentials_file
  credentials_file="$(mem9_credentials_file)"

  node -e '
const fs = require("node:fs");
const path = require("node:path");
const credentialsPath = process.argv[1];
const baseUrl = process.argv[2];
const apiKey = process.argv[3];
const isRecord = (value) => value != null && typeof value === "object" && !Array.isArray(value);
let data = {};
try {
  data = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
} catch {}
if (!isRecord(data)) {
  data = {};
}
const profiles = isRecord(data.profiles) ? data.profiles : {};
const current = isRecord(profiles.default) ? profiles.default : {};
profiles.default = {
  label: typeof current.label === "string" && current.label.trim() ? current.label : "default",
  baseUrl: baseUrl || (typeof current.baseUrl === "string" && current.baseUrl.trim()) || "https://api.mem9.ai",
  apiKey,
};
data.schemaVersion = 1;
data.profiles = profiles;
fs.mkdirSync(path.dirname(credentialsPath), { recursive: true });
const tempPath = `${credentialsPath}.${process.pid}.${Date.now()}.tmp`;
fs.writeFileSync(tempPath, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
fs.chmodSync(tempPath, 0o600);
fs.renameSync(tempPath, credentialsPath);
' "${credentials_file}" "${MEM9_API_URL}" "${api_key}"
}

mem9_provision_auth() {
  "${MEM9_CURL_BIN}" -sf --max-time 8 -X POST \
    -H "User-Agent: $(mem9_plugin_user_agent)" \
    "${MEM9_API_URL%/}/v1alpha1/mem9s"
}

mem9_api_request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local response
  local http_code
  local response_body
  local curl_args=(
    -sS
    --max-time 8
    -X "${method}"
    -H "Content-Type: application/json"
    -H "X-API-Key: ${MEM9_API_KEY}"
    -H "X-Mnemo-Agent-Id: ${MEM9_WRITER_ID}"
    -H "User-Agent: $(mem9_plugin_user_agent)"
  )

  if [[ -n "${body}" ]]; then
    curl_args+=(-d "${body}")
  fi

  if ! response="$("${MEM9_CURL_BIN}" "${curl_args[@]}" -w $'\n%{http_code}' "$(mem9_memory_base)${path}")"; then
    return 1
  fi

  http_code="${response##*$'\n'}"
  response_body="${response%$'\n'"${http_code}"}"
  case "${http_code}" in
    2*)
      printf '%s' "${response_body}"
      return 0
      ;;
    *)
      printf '%s\n%s%s' "${response_body}" "${MEM9_HTTP_STATUS_MARKER}" "${http_code}"
      return 22
      ;;
  esac
}

mem9_api_get() {
  local path="$1"
  mem9_api_request "GET" "${path}"
}

mem9_api_post() {
  local path="$1"
  local body="$2"
  mem9_api_request "POST" "${path}" "${body}"
}

mem9_quota_notice_from_body() {
  local operation="$1"
  local input
  local body
  local status=""
  local marker=$'\n'"${MEM9_HTTP_STATUS_MARKER}"

  input="$(cat)"
  body="${input}"
  if [[ "${input}" == *"${marker}"* ]]; then
    status="${input##*${marker}}"
    body="${input%"${marker}${status}"}"
  fi

  printf '%s' "${body}" | node "${MEM9_SCRIPT_DIR}/lib/quota-error.mjs" notice "${operation}" "${status}" 2>/dev/null || true
}

mem9_runtime_state_notice() {
  local hook_name="${1:-SessionStart}"
  local response
  local notice

  if ! response="$(mem9_api_get "/runtime-state" 2>/dev/null)"; then
    mem9_debug "${hook_name}" "runtime_state_failed" \
      "auth_source" "${MEM9_AUTH_SOURCE:-unknown}"
    return 0
  fi

  notice="$(printf '%s' "${response}" | node "${MEM9_SCRIPT_DIR}/lib/runtime-state.mjs" 2>/dev/null || true)"
  if [[ -n "${notice}" ]]; then
    mem9_debug "${hook_name}" "runtime_state_notice" \
      "auth_source" "${MEM9_AUTH_SOURCE:-unknown}"
    printf '%s' "${notice}"
  fi
}

mem9_ingest_transcript() {
  local hook_name="$1"
  local hook_input="$2"
  local mode="$3"
  local max_messages="$4"
  local max_bytes="$5"

  local session_id
  local cwd
  local payload
  local body
  local response
  local quota_notice
  local stats
  local messages_count
  local user_count
  local assistant_count
  local total_bytes

  session_id="$(mem9_hook_get_string "${hook_input}" "session_id")"
  cwd="$(mem9_hook_get_string "${hook_input}" "cwd")"

  if [[ -z "${session_id}" || -z "${cwd}" ]]; then
    mem9_debug "${hook_name}" "ingest_input_missing" \
      "mode" "${mode}" \
      "session_id_present" "$([[ -n "${session_id}" ]] && printf true || printf false)" \
      "cwd_present" "$([[ -n "${cwd}" ]] && printf true || printf false)"
    return 1
  fi

  if ! payload="$(node "${MEM9_SCRIPT_DIR}/lib/wire-parser.mjs" \
    --session-id "${session_id}" \
    --cwd "${cwd}" \
    --mode "${mode}" \
    --max-messages "${max_messages}" \
    --max-bytes "${max_bytes}")"; then
    mem9_debug "${hook_name}" "ingest_parse_failed" \
      "mode" "${mode}" \
      "session_id" "${session_id}"
    return 1
  fi

  stats="$(PAYLOAD="${payload}" node -e 'const payload=JSON.parse(process.env.PAYLOAD); const messages=Array.isArray(payload.messages) ? payload.messages : []; let user=0; let assistant=0; let bytes=0; for (const message of messages) { if (message.role === "user") user += 1; if (message.role === "assistant") assistant += 1; bytes += new TextEncoder().encode(String(message.content || "")).byteLength; } process.stdout.write([messages.length, user, assistant, bytes].join("\t"));')"
  IFS=$'\t' read -r messages_count user_count assistant_count total_bytes <<< "${stats}"

  body="$(SESSION_ID="${session_id}" PAYLOAD="${payload}" MEM9_AGENT_ID="${MEM9_AGENT_ID}" node -e 'const payload=JSON.parse(process.env.PAYLOAD); process.stdout.write(JSON.stringify({session_id:process.env.SESSION_ID,agent_id:process.env.MEM9_AGENT_ID,mode:"smart",messages:payload.messages}));')"

  if [[ "${body}" == *'"messages":[]'* ]]; then
    mem9_debug "${hook_name}" "ingest_empty" \
      "mode" "${mode}" \
      "session_id" "${session_id}"
    return 1
  fi

  mem9_debug "${hook_name}" "ingest_request" \
    "mode" "${mode}" \
    "session_id" "${session_id}" \
    "messages_count" "${messages_count}" \
    "user_count" "${user_count}" \
    "assistant_count" "${assistant_count}" \
    "content_bytes" "${total_bytes}"

  if response="$(mem9_api_post "/memories" "${body}" 2>/dev/null)"; then
    mem9_debug "${hook_name}" "ingest_sent" \
      "mode" "${mode}" \
      "session_id" "${session_id}" \
      "messages_count" "${messages_count}" \
      "user_count" "${user_count}" \
      "assistant_count" "${assistant_count}" \
      "content_bytes" "${total_bytes}"
    return 0
  fi

  quota_notice="$(printf '%s' "${response:-}" | mem9_quota_notice_from_body "ingest paused")"
  if [[ -n "${quota_notice}" ]]; then
    mem9_debug "${hook_name}" "ingest_quota_denied" \
      "mode" "${mode}" \
      "session_id" "${session_id}" \
      "messages_count" "${messages_count}"
    return 1
  fi

  mem9_debug "${hook_name}" "ingest_request_failed" \
    "mode" "${mode}" \
    "session_id" "${session_id}" \
    "messages_count" "${messages_count}"
  return 1
}
