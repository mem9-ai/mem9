#!/usr/bin/env bash
# common.sh — Shared helpers for mem9 hooks.
# Sourced by all hook scripts.
#
# MEM9_API_URL defaults to https://api.mem9.ai. Only MEM9_TENANT_ID is required.

set -euo pipefail

MEM9_API_URL="${MEM9_API_URL:-https://api.mem9.ai}"

mnemo_check_env() {
  if [[ -z "${MEM9_TENANT_ID:-}" ]]; then
    echo '{"error":"MEM9_TENANT_ID is not set"}' >&2
    return 1
  fi
}

# Tenant-scoped base path.
mnemo_base() {
  echo "${MEM9_API_URL}/v1alpha1/mem9s/${MEM9_TENANT_ID}"
}

# GET request (tenant-scoped).
mnemo_server_get() {
  local path="$1"
  curl -sf --max-time 8 \
    -H "Content-Type: application/json" \
    "$(mnemo_base)${path}"
}

# POST request (tenant-scoped).
mnemo_server_post() {
  local path="$1"
  local body="$2"
  curl -sf --max-time 8 \
    -H "Content-Type: application/json" \
    -d "${body}" \
    "$(mnemo_base)${path}"
}

# ─── Public helpers ─────────────────────────────────────────────────

# mnemo_get_memories [limit] — Fetch recent memories.
mnemo_get_memories() {
  local limit="${1:-20}"
  mnemo_server_get "/memories?limit=${limit}"
}

# mnemo_post_memory <json_body> — Store a memory.
mnemo_post_memory() {
  local body="$1"
  mnemo_server_post "/memories" "$body"
}

# mnemo_search <query> [limit] — Search memories.
mnemo_search() {
  local query="$1"
  local limit="${2:-10}"
  local encoded_q
  encoded_q=$(printf '%s' "$query" | python3 -c "import sys,urllib.parse; print(urllib.parse.quote(sys.stdin.read().strip()))" 2>/dev/null || echo "$query")
  mnemo_server_get "/memories?q=${encoded_q}&limit=${limit}"
}

# read_stdin — Read stdin (hook input JSON) into $HOOK_INPUT.
read_stdin() {
  local input=""
  if read -t 2 -r input 2>/dev/null; then
    HOOK_INPUT="$input"
  else
    HOOK_INPUT="{}"
  fi
}
