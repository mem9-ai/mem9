#!/usr/bin/env bash
# session-start.sh — Check Node and auto-provision an API key if missing.
# Kimi discards SessionStart stdout, so this hook is side effects only: never print.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/common.sh"

HOOK_INPUT="$(cat)"

if ! mem9_require_node; then
  if printf '%s' "${HOOK_INPUT}" | grep -Eq '"source"[[:space:]]*:[[:space:]]*"startup"'; then
    mem9_debug "SessionStart" "node_missing" "source" "startup"
  fi
  exit 0
fi

SESSION_SOURCE="$(mem9_hook_get_string "${HOOK_INPUT}" "source")"
mem9_debug "SessionStart" "hook_started" "source" "${SESSION_SOURCE:-unknown}"
if [[ "${SESSION_SOURCE}" != "startup" ]]; then
  mem9_debug "SessionStart" "skipped_non_startup" "source" "${SESSION_SOURCE:-unknown}"
  exit 0
fi

load_auth_status=0
if mem9_load_auth 2>/dev/null; then
  mem9_debug "SessionStart" "auth_ready" \
    "source" "${SESSION_SOURCE}" \
    "auth_source" "${MEM9_AUTH_SOURCE:-unknown}"
  exit 0
else
  load_auth_status=$?
fi

if [[ "${load_auth_status}" -eq 2 ]]; then
  mem9_debug "SessionStart" "auth_invalid" \
    "source" "${SESSION_SOURCE}" \
    "auth_source" "${MEM9_AUTH_SOURCE:-invalid_file}"
  exit 0
fi

mem9_debug "SessionStart" "provision_start" "source" "${SESSION_SOURCE}"
response="$(mem9_provision_auth 2>/dev/null || true)"
if [[ -z "${response}" ]]; then
  mem9_debug "SessionStart" "provision_failed" "source" "${SESSION_SOURCE}"
  exit 0
fi

api_key="$(printf '%s' "${response}" | node "${SCRIPT_DIR}/lib/hook-json.mjs" get-string id)"
if [[ -z "${api_key}" ]]; then
  mem9_debug "SessionStart" "provision_missing_api_key" "source" "${SESSION_SOURCE}"
  exit 0
fi

if ! mem9_upsert_default_profile "${api_key}"; then
  mem9_debug "SessionStart" "auth_write_failed" "source" "${SESSION_SOURCE}"
  exit 0
fi

MEM9_API_KEY="${api_key}"
MEM9_AUTH_SOURCE="auto_provisioned"
export MEM9_API_KEY MEM9_AUTH_SOURCE
mem9_debug "SessionStart" "initialized" \
  "source" "${SESSION_SOURCE}" \
  "auth_source" "auto_provisioned"
