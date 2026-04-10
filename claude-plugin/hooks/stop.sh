#!/usr/bin/env bash
# stop.sh — Upload the last completed turn as structured messages.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/common.sh"

HOOK_INPUT="$(cat)"

if ! mem9_require_node; then
  mem9_debug "Stop" "node_missing"
  exit 0
fi

load_auth_status=0
if ! mem9_load_auth 2>/dev/null; then
  load_auth_status=$?
  if [[ "${load_auth_status}" -eq 2 ]]; then
    mem9_debug "Stop" "auth_invalid"
  else
    mem9_debug "Stop" "auth_missing"
  fi
  exit 0
fi

mem9_debug "Stop" "hook_started" "auth_source" "${MEM9_AUTH_SOURCE:-unknown}"
mem9_ingest_transcript "Stop" "${HOOK_INPUT}" "stop" 4 20000 || true
