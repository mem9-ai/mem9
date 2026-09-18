#!/usr/bin/env bash
# Shared helpers for the mem9 Kimi Code hooks. Every hook sources this file.
# All hooks fail open: any error must never break the user's session.

set -euo pipefail

MEM9_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MEM9_API_URL="${MEM9_API_URL:-}"
MEM9_AGENT_ID="${MEM9_AGENT_ID:-kimi-code-main}"
MEM9_WRITER_ID="${MEM9_WRITER_ID:-kimi-code}"
MEM9_CURL_BIN="${MEM9_CURL_BIN:-curl}"
MEM9_API_KEY="${MEM9_API_KEY:-}"

mem9_require_node() {
  command -v node >/dev/null 2>&1 || return 1
  node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)'
}

# mem9_log <message> — with MEM9_DEBUG=1, appends to the debug log.
mem9_log() {
  [[ "${MEM9_DEBUG:-}" == "1" ]] || return 0
  local dir="${KIMI_CODE_HOME:-$HOME/.kimi-code}/mem9"
  mkdir -p "${dir}" 2>/dev/null || return 0
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "${dir}/hooks.log" 2>/dev/null || true
}

# mem9_json_field <json> <field> — prints a top-level string field, "" if absent.
mem9_json_field() {
  printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const v=JSON.parse(s)[process.argv[1]];process.stdout.write(typeof v==="string"?v:"")}catch{}})' "$2"
}

# mem9_json_prompt <json> — prints the prompt (string or content-part array).
mem9_json_prompt() {
  printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const v=JSON.parse(s).prompt;if(typeof v==="string")process.stdout.write(v);else if(Array.isArray(v))process.stdout.write(v.filter(p=>p&&p.type==="text").map(p=>p.text||"").join("\n"))}catch{}})'
}

# Loads MEM9_API_KEY/MEM9_API_URL: env wins, then the shared credentials file
# (~/.mem9/.credentials.json, default profile or the only profile).
mem9_load_auth() {
  if [[ -n "${MEM9_API_KEY}" ]]; then
    MEM9_API_URL="${MEM9_API_URL:-https://api.mem9.ai}"
    export MEM9_API_KEY MEM9_API_URL
    return 0
  fi
  local file="${MEM9_HOME:-$HOME/.mem9}/.credentials.json"
  [[ -f "${file}" ]] || return 1
  local parsed url key
  parsed="$(node -e '
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const profiles = data && data.profiles && typeof data.profiles === "object" ? data.profiles : {};
const ids = Object.keys(profiles);
const profile = profiles.default || (ids.length === 1 ? profiles[ids[0]] : null);
const key = profile && typeof profile.apiKey === "string" ? profile.apiKey.trim() : "";
const url = profile && typeof profile.baseUrl === "string" ? profile.baseUrl.trim() : "";
process.stdout.write(url + "\t" + key);
' "${file}" 2>/dev/null)" || return 1
  url="${parsed%%$'\t'*}"
  key="${parsed##*$'\t'}"
  [[ -n "${key}" ]] || return 1
  MEM9_API_KEY="${key}"
  MEM9_API_URL="${MEM9_API_URL:-${url:-https://api.mem9.ai}}"
  export MEM9_API_KEY MEM9_API_URL
}

# mem9_curl <METHOD> <PATH> [BODY] — prints the response body, fails on error.
mem9_curl() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-sf --max-time 8 -X "${method}"
    -H "Content-Type: application/json"
    -H "X-API-Key: ${MEM9_API_KEY}"
    -H "X-Mnemo-Agent-Id: ${MEM9_WRITER_ID}")
  [[ -z "${body}" ]] || args+=(--data-binary @-)
  if [[ -n "${body}" ]]; then
    printf '%s' "${body}" | "${MEM9_CURL_BIN}" "${args[@]}" "${MEM9_API_URL%/}/v1alpha2/mem9s${path}"
  else
    "${MEM9_CURL_BIN}" "${args[@]}" "${MEM9_API_URL%/}/v1alpha2/mem9s${path}"
  fi
}

# Provisions a new API key and saves it as the default profile, preserving
# any other profiles in the shared credentials file. Prints the key.
mem9_provision() {
  local base="${MEM9_API_URL:-https://api.mem9.ai}"
  local response key
  response="$("${MEM9_CURL_BIN}" -sf --max-time 8 -X POST "${base%/}/v1alpha1/mem9s" 2>/dev/null)" || return 1
  key="$(printf '%s' "${response}" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{process.stdout.write(JSON.parse(s).id||"")}catch{}})')"
  [[ -n "${key}" ]] || return 1

  local file="${MEM9_HOME:-$HOME/.mem9}/.credentials.json"
  MEM9_NEW_KEY="${key}" node -e '
const fs = require("node:fs");
const path = require("node:path");
const file = process.argv[1];
let data = {};
try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
const profiles = data && data.profiles && typeof data.profiles === "object" && !Array.isArray(data.profiles) ? data.profiles : {};
const existing = profiles.default && typeof profiles.default === "object" && !Array.isArray(profiles.default) ? profiles.default : {};
profiles.default = {
  label: existing.label || "default",
  baseUrl: existing.baseUrl || process.argv[2],
  apiKey: process.env.MEM9_NEW_KEY,
};
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, profiles }, null, 2) + "\n", { mode: 0o600 });
fs.chmodSync(file, 0o600);
' "${file}" "${base}"
  printf '%s' "${key}"
}

# mem9_ingest <stop|precompact|sessionend> <max_messages> <max_bytes>
# Reads the hook payload on stdin and uploads the conversation window.
mem9_ingest() {
  local mode="$1" max_messages="$2" max_bytes="$3"
  local input session_id payload body
  input="$(cat)"
  session_id="$(mem9_json_field "${input}" session_id)"
  [[ -n "${session_id}" ]] || return 0
  payload="$(node "${MEM9_SCRIPT_DIR}/lib/wire.mjs" "${session_id}" "${mode}" "${max_messages}" "${max_bytes}" 2>/dev/null)" || return 0
  [[ "${payload}" != '{"messages":[]}' ]] || return 0
  body="$(printf '%s' "${payload}" | MEM9_SESSION_ID="${session_id}" node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const p=JSON.parse(s);process.stdout.write(JSON.stringify({session_id:process.env.MEM9_SESSION_ID,agent_id:process.env.MEM9_AGENT_ID,mode:"smart",messages:p.messages}))})')"
  mem9_curl POST /memories "${body}" >/dev/null 2>&1 || true
  mem9_log "ingest ${mode} ok (${session_id})"
}
