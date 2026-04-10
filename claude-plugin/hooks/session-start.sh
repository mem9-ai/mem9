#!/usr/bin/env bash
# session-start.sh — Check Node, auto-provision an API key if missing, and emit a short status.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/common.sh"

HOOK_INPUT="$(cat)"

if ! mem9_require_node; then
  if printf '%s' "${HOOK_INPUT}" | grep -Eq '"source"[[:space:]]*:[[:space:]]*"startup"'; then
    mem9_debug "SessionStart" "node_missing" "source" "startup"
    mem9_emit_context "SessionStart" "[mem9] Node.js 18+ is required. mem9 is disabled for this session. Install Node and restart Claude Code."
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
  mem9_emit_context "SessionStart" "[mem9] auth.json is invalid or unreadable. Automatic setup is paused. Run /mem9:setup to repair it."
  exit 0
fi

mem9_debug "SessionStart" "provision_start" "source" "${SESSION_SOURCE}"
response="$(mem9_provision_auth 2>/dev/null || true)"
if [[ -z "${response}" ]]; then
  mem9_debug "SessionStart" "provision_failed" "source" "${SESSION_SOURCE}"
  mem9_emit_context "SessionStart" "[mem9] Automatic setup failed. Try again later or run /mem9:setup to inspect the current state."
  exit 0
fi

api_key="$(printf '%s' "${response}" | node "${SCRIPT_DIR}/lib/hook-json.mjs" get-string id)"
if [[ -z "${api_key}" ]]; then
  mem9_debug "SessionStart" "provision_missing_api_key" "source" "${SESSION_SOURCE}"
  mem9_emit_context "SessionStart" "[mem9] Automatic setup failed. The server did not return an API key."
  exit 0
fi

if ! mem9_write_auth "${api_key}"; then
  mem9_debug "SessionStart" "auth_write_failed" "source" "${SESSION_SOURCE}"
  mem9_emit_context "SessionStart" "[mem9] Automatic setup failed. The plugin could not write auth.json."
  exit 0
fi

mem9_write_session_env "${api_key}" || true
mem9_debug "SessionStart" "initialized" \
  "source" "${SESSION_SOURCE}" \
  "auth_source" "auto_provisioned"
mem9_emit_context "SessionStart" "[mem9] Initialized automatically."
