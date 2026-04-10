#!/usr/bin/env bash
# common.sh — Shared helpers for mem9 hooks.

set -euo pipefail

MEM9_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MEM9_API_URL="${MEM9_API_URL:-https://api.mem9.ai}"
MEM9_AGENT_ID="${MEM9_AGENT_ID:-claude-code-main}"
MEM9_WRITER_ID="${MEM9_WRITER_ID:-claude-code}"
MEM9_CURL_BIN="${MEM9_CURL_BIN:-curl}"
MEM9_AUTH_SOURCE="${MEM9_AUTH_SOURCE:-}"

mem9_require_node() {
  command -v node >/dev/null 2>&1 || return 1
  node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)'
}

mem9_plugin_data_dir() {
  [[ -n "${CLAUDE_PLUGIN_DATA:-}" ]] || return 1
  printf '%s\n' "${CLAUDE_PLUGIN_DATA}"
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

mem9_auth_file() {
  local data_dir
  data_dir="$(mem9_plugin_data_dir)" || return 1
  printf '%s/auth.json\n' "${data_dir}"
}

mem9_memory_base() {
  printf '%s\n' "${MEM9_API_URL%/}/v1alpha2/mem9s"
}

mem9_hook_get_string() {
  local hook_input="$1"
  local key="$2"
  printf '%s' "${hook_input}" | node "${MEM9_SCRIPT_DIR}/lib/hook-json.mjs" get-string "${key}"
}

mem9_emit_context() {
  local event_name="$1"
  local text="$2"
  if mem9_require_node >/dev/null 2>&1; then
    node "${MEM9_SCRIPT_DIR}/lib/hook-json.mjs" emit-context "${event_name}" "${text}"
    return 0
  fi

  local escaped_event escaped_text
  escaped_event="${event_name//\\/\\\\}"
  escaped_event="${escaped_event//\"/\\\"}"
  escaped_event="${escaped_event//$'\n'/\\n}"
  escaped_event="${escaped_event//$'\r'/\\r}"
  escaped_event="${escaped_event//$'\t'/\\t}"

  escaped_text="${text//\\/\\\\}"
  escaped_text="${escaped_text//\"/\\\"}"
  escaped_text="${escaped_text//$'\n'/\\n}"
  escaped_text="${escaped_text//$'\r'/\\r}"
  escaped_text="${escaped_text//$'\t'/\\t}"

  printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":"%s"}}' \
    "${escaped_event}" \
    "${escaped_text}"
}

mem9_load_auth() {
  if [[ -n "${MEM9_API_KEY:-}" ]]; then
    MEM9_AUTH_SOURCE="env"
    export MEM9_API_URL MEM9_AGENT_ID MEM9_WRITER_ID MEM9_API_KEY
    return 0
  fi

  local auth_file
  auth_file="$(mem9_auth_file)" || return 1
  [[ -f "${auth_file}" ]] || return 1

  local parsed auth_api_url auth_api_key
  if ! parsed="$(node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); const values=[data.base_url || "https://api.mem9.ai", data.api_key || ""]; process.stdout.write(values.join("\t"));' "${auth_file}")"; then
    MEM9_AUTH_SOURCE="invalid_file"
    return 2
  fi

  IFS=$'\t' read -r auth_api_url auth_api_key <<< "${parsed}"
  if [[ -z "${auth_api_key}" ]]; then
    MEM9_AUTH_SOURCE="invalid_file"
    return 2
  fi

  MEM9_API_URL="${auth_api_url}"
  MEM9_API_KEY="${auth_api_key}"
  MEM9_AUTH_SOURCE="auth_file"

  [[ -n "${MEM9_API_KEY}" ]] || return 1
  export MEM9_API_URL MEM9_AGENT_ID MEM9_WRITER_ID MEM9_API_KEY
}

mem9_write_auth() {
  local api_key="$1"
  local auth_file
  auth_file="$(mem9_auth_file)" || return 1

  mkdir -p "$(dirname "${auth_file}")"
  node -e 'const fs=require("node:fs"); const path=require("node:path"); const authPath=process.argv[1]; const baseUrl=process.argv[2]; const apiKey=process.argv[3]; const payload={base_url:baseUrl,api_key:apiKey,created_at:new Date().toISOString(),source:"auto_provisioned"}; fs.mkdirSync(path.dirname(authPath), {recursive:true}); fs.writeFileSync(authPath, JSON.stringify(payload, null, 2) + "\n");' \
    "${auth_file}" "${MEM9_API_URL}" "${api_key}"
}

mem9_write_session_env() {
  local api_key="$1"
  [[ -n "${CLAUDE_ENV_FILE:-}" ]] || return 0

  {
    printf 'export MEM9_API_URL=%q\n' "${MEM9_API_URL}"
    printf 'export MEM9_API_KEY=%q\n' "${api_key}"
    printf 'export MEM9_AGENT_ID=%q\n' "${MEM9_AGENT_ID}"
    printf 'export MEM9_WRITER_ID=%q\n' "${MEM9_WRITER_ID}"
  } >> "${CLAUDE_ENV_FILE}"
}

mem9_provision_auth() {
  "${MEM9_CURL_BIN}" -sf --max-time 8 -X POST "${MEM9_API_URL%/}/v1alpha1/mem9s"
}

mem9_api_get() {
  local path="$1"
  "${MEM9_CURL_BIN}" -sf --max-time 8 \
    -H "Content-Type: application/json" \
    -H "X-API-Key: ${MEM9_API_KEY}" \
    -H "X-Mnemo-Agent-Id: ${MEM9_WRITER_ID}" \
    "$(mem9_memory_base)${path}"
}

mem9_api_post() {
  local path="$1"
  local body="$2"
  "${MEM9_CURL_BIN}" -sf --max-time 8 \
    -H "Content-Type: application/json" \
    -H "X-API-Key: ${MEM9_API_KEY}" \
    -H "X-Mnemo-Agent-Id: ${MEM9_WRITER_ID}" \
    -d "${body}" \
    "$(mem9_memory_base)${path}"
}

mem9_ingest_transcript() {
  local hook_name="$1"
  local hook_input="$2"
  local mode="$3"
  local max_messages="$4"
  local max_bytes="$5"

  local session_id
  local transcript_path
  local payload
  local body
  local stats
  local messages_count
  local user_count
  local assistant_count
  local total_bytes

  session_id="$(mem9_hook_get_string "${hook_input}" "session_id")"
  transcript_path="$(mem9_hook_get_string "${hook_input}" "transcript_path")"

  if [[ -z "${session_id}" || -z "${transcript_path}" ]]; then
    mem9_debug "${hook_name}" "ingest_input_missing" \
      "mode" "${mode}" \
      "session_id_present" "$([[ -n "${session_id}" ]] && printf true || printf false)" \
      "transcript_path_present" "$([[ -n "${transcript_path}" ]] && printf true || printf false)"
    return 1
  fi

  if ! payload="$(node "${MEM9_SCRIPT_DIR}/lib/transcript-parser.mjs" \
    --transcript-path "${transcript_path}" \
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

  if mem9_api_post "/memories" "${body}" >/dev/null 2>&1; then
    mem9_debug "${hook_name}" "ingest_sent" \
      "mode" "${mode}" \
      "session_id" "${session_id}" \
      "messages_count" "${messages_count}" \
      "user_count" "${user_count}" \
      "assistant_count" "${assistant_count}" \
      "content_bytes" "${total_bytes}"
    return 0
  fi

  mem9_debug "${hook_name}" "ingest_request_failed" \
    "mode" "${mode}" \
    "session_id" "${session_id}" \
    "messages_count" "${messages_count}"
  return 1
}
