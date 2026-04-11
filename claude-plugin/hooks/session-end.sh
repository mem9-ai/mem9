#!/usr/bin/env bash
# session-end.sh — Best-effort light flush on session end.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/common.sh"

HOOK_INPUT="$(cat)"

if ! mem9_require_node; then
  mem9_debug "SessionEnd" "node_missing"
  exit 0
fi

load_auth_status=0
if ! mem9_load_auth 2>/dev/null; then
  load_auth_status=$?
  if [[ "${load_auth_status}" -eq 2 ]]; then
    mem9_debug "SessionEnd" "auth_invalid"
  else
    mem9_debug "SessionEnd" "auth_missing"
  fi
  exit 0
fi

mem9_debug "SessionEnd" "hook_started" "auth_source" "${MEM9_AUTH_SOURCE:-unknown}"
mem9_ingest_transcript "SessionEnd" "${HOOK_INPUT}" "sessionend" 4 20000 || true
