#!/usr/bin/env bash
# common.sh — Shared helpers for mnemo hooks.
# Sourced by all hook scripts. Requires MNEMO_API_URL and MNEMO_API_TOKEN env vars.

set -euo pipefail

# Validate required env vars.
mnemo_check_env() {
  if [[ -z "${MNEMO_API_URL:-}" ]]; then
    echo '{"error":"MNEMO_API_URL not set"}' >&2
    return 1
  fi
  if [[ -z "${MNEMO_API_TOKEN:-}" ]]; then
    echo '{"error":"MNEMO_API_TOKEN not set"}' >&2
    return 1
  fi
}

# mnemo_get <path> — GET request to mnemo API.
mnemo_get() {
  local path="$1"
  curl -sf --max-time 8 \
    -H "Authorization: Bearer ${MNEMO_API_TOKEN}" \
    -H "Content-Type: application/json" \
    "${MNEMO_API_URL}${path}"
}

# mnemo_post <path> <json_body> — POST request to mnemo API.
mnemo_post() {
  local path="$1"
  local body="$2"
  curl -sf --max-time 8 \
    -H "Authorization: Bearer ${MNEMO_API_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "${body}" \
    "${MNEMO_API_URL}${path}"
}

# read_stdin — Read stdin (hook input JSON) into $HOOK_INPUT.
read_stdin() {
  HOOK_INPUT="$(cat)"
}
