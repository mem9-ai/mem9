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
response=""
if ! response="$(mem9_api_get "/memories?q=${encoded_prompt}&limit=10" 2>/dev/null)"; then
  quota_notice="$(printf '%s' "${response:-}" | mem9_quota_notice_from_body "recall paused")"
  if [[ -n "${quota_notice}" ]]; then
    mem9_debug "UserPromptSubmit" "recall_quota_denied" \
      "prompt_length" "${#prompt}"
    mem9_emit_context "UserPromptSubmit" "${quota_notice}"
    exit 0
  fi

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
message_stats="$(printf '%s' "${response}" | node --input-type=module -e 'import { createHash } from "node:crypto"; import { readFileSync } from "node:fs"; import { pathToFileURL } from "node:url"; const { responseMessage } = await import(pathToFileURL(process.argv[2])); const message=responseMessage(JSON.parse(readFileSync(0, "utf8"))); const hash=message ? `sha256:${createHash("sha256").update(message).digest("hex")}` : ""; process.stdout.write([message ? "true" : "false", String(message.length), hash].join("\t"));' _ "${SCRIPT_DIR}/lib/memories-formatter.mjs" 2>/dev/null || printf 'false\t0\t')"
IFS=$'\t' read -r has_message message_length message_hash <<< "${message_stats}"
mem9_debug "UserPromptSubmit" "recall_response" \
  "prompt_length" "${#prompt}" \
  "memories_count" "${memories_count}" \
  "has_message" "${has_message}" \
  "message_length" "${message_length}" \
  "message_hash" "${message_hash}"

session_id="$(mem9_hook_get_string "${HOOK_INPUT}" "session_id")"
notice_state_file="$(mem9_notice_state_file || true)"
context="$(
  printf '%s' "${response}" \
    | MEM9_NOTICE_SESSION_ID="${session_id}" MEM9_NOTICE_STATE_FILE="${notice_state_file}" \
      node "${SCRIPT_DIR}/lib/memories-formatter.mjs" 2>/dev/null || true
)"
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
