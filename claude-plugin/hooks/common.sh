#!/usr/bin/env bash
# common.sh — Shared helpers for mnemo hooks.
# Sourced by all hook scripts.
#
# Requires MNEMO_API_URL + MNEMO_API_TOKEN to connect to mnemo-server.

set -euo pipefail

# Validate that server mode is configured.
mnemo_check_env() {
  if [[ -z "${MNEMO_API_URL:-}" ]]; then
    echo '{"error":"MNEMO_API_URL is not set"}' >&2
    return 1
  fi
  if [[ -z "${MNEMO_API_TOKEN:-}" ]]; then
    echo '{"error":"Server mode requires MNEMO_API_URL and MNEMO_API_TOKEN"}' >&2
    return 1
  fi
}

# ─── Server mode helpers ────────────────────────────────────────────

# mnemo_server_get <path> — GET request to mnemo-server.
mnemo_server_get() {
  local path="$1"
  curl -sf --max-time 8 \
    -H "Authorization: Bearer ${MNEMO_API_TOKEN}" \
    -H "Content-Type: application/json" \
    "${MNEMO_API_URL}${path}"
}

# mnemo_server_post <path> <json_body> — POST request to mnemo-server.
mnemo_server_post() {
  local path="$1"
  local body="$2"
  curl -sf --max-time 8 \
    -H "Authorization: Bearer ${MNEMO_API_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "${body}" \
    "${MNEMO_API_URL}${path}"
}

# ─── Public helpers ─────────────────────────────────────────────────

# mnemo_get_memories [limit] — Fetch recent memories from mnemo-server.
mnemo_get_memories() {
  local limit="${1:-20}"
  mnemo_server_get "/api/memories?limit=${limit}"
}

# mnemo_post_memory <json_body> — Store a memory via mnemo-server.
mnemo_post_memory() {
  local body="$1"
  mnemo_server_post "/api/memories" "$body"
}

# mnemo_search <query> [limit] — Search memories via mnemo-server.
mnemo_search() {
  local query="$1"
  local limit="${2:-10}"
  local encoded_q
  encoded_q=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$query'))" 2>/dev/null || echo "$query")
  mnemo_server_get "/api/memories?q=${encoded_q}&limit=${limit}"
}

# read_stdin — Read stdin (hook input JSON) into $HOOK_INPUT.
# Uses read with timeout to avoid hanging if stdin is not provided.
read_stdin() {
  local input=""
  if read -t 2 -r input 2>/dev/null; then
    HOOK_INPUT="$input"
  else
    HOOK_INPUT="{}"
  fi
}
