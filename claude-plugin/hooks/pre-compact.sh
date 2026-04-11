#!/usr/bin/env bash
# pre-compact.sh — Upload a larger recent window before compaction.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/common.sh"

HOOK_INPUT="$(cat)"

if ! mem9_require_node; then
  mem9_debug "PreCompact" "node_missing"
  exit 0
fi

load_auth_status=0
if ! mem9_load_auth 2>/dev/null; then
  load_auth_status=$?
  if [[ "${load_auth_status}" -eq 2 ]]; then
    mem9_debug "PreCompact" "auth_invalid"
  else
    mem9_debug "PreCompact" "auth_missing"
  fi
  exit 0
fi

mem9_debug "PreCompact" "hook_started" "auth_source" "${MEM9_AUTH_SOURCE:-unknown}"
mem9_ingest_transcript "PreCompact" "${HOOK_INPUT}" "precompact" 12 120000 || true
