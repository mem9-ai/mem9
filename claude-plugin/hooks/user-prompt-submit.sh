#!/usr/bin/env bash
# user-prompt-submit.sh — Recall relevant memories on each user turn.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/common.sh"

HOOK_INPUT="$(cat)"

if ! mem9_require_node; then
  mem9_debug "UserPromptSubmit" "node_missing"
  exit 0
fi

load_auth_status=0
if ! mem9_load_auth 2>/dev/null; then
  load_auth_status=$?
  if [[ "${load_auth_status}" -eq 2 ]]; then
    mem9_debug "UserPromptSubmit" "auth_invalid"
  else
    mem9_debug "UserPromptSubmit" "auth_missing"
  fi
  exit 0
fi

prompt="$(mem9_hook_get_string "${HOOK_INPUT}" "prompt")"
if [[ -z "${prompt}" ]]; then
  mem9_debug "UserPromptSubmit" "prompt_empty"
  exit 0
fi

mem9_debug "UserPromptSubmit" "recall_request" \
  "prompt_length" "${#prompt}" \
  "auth_source" "${MEM9_AUTH_SOURCE:-unknown}"

encoded_prompt="$(printf '%s' "${prompt}" | node -e 'const fs=require("node:fs"); const raw=fs.readFileSync(0, "utf8").trim(); process.stdout.write(encodeURIComponent(raw));')"
if ! response="$(mem9_api_get "/memories?q=${encoded_prompt}&agent_id=${MEM9_AGENT_ID}&limit=10" 2>/dev/null)"; then
  mem9_debug "UserPromptSubmit" "recall_request_failed" \
    "prompt_length" "${#prompt}"
  exit 0
fi

if [[ -z "${response}" ]]; then
  mem9_debug "UserPromptSubmit" "recall_empty_response" \
    "prompt_length" "${#prompt}"
  exit 0
fi

memories_count="$(printf '%s' "${response}" | node -e 'const fs=require("node:fs"); const raw=fs.readFileSync(0, "utf8"); const parsed=JSON.parse(raw); const memories=Array.isArray(parsed) ? parsed : Array.isArray(parsed.memories) ? parsed.memories : []; process.stdout.write(String(memories.length));' 2>/dev/null || printf '0')"
mem9_debug "UserPromptSubmit" "recall_response" \
  "prompt_length" "${#prompt}" \
  "memories_count" "${memories_count}"

context="$(printf '%s' "${response}" | node "${SCRIPT_DIR}/lib/memories-formatter.mjs" 2>/dev/null || true)"
if [[ -z "${context}" ]]; then
  mem9_debug "UserPromptSubmit" "recall_no_context" \
    "prompt_length" "${#prompt}" \
    "memories_count" "${memories_count}"
  exit 0
fi

mem9_debug "UserPromptSubmit" "context_injected" \
  "prompt_length" "${#prompt}" \
  "memories_count" "${memories_count}" \
  "context_length" "${#context}"
mem9_emit_context "UserPromptSubmit" "${context}"
