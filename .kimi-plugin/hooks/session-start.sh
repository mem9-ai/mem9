#!/usr/bin/env bash
# session-start.sh — provision an API key on first startup. Kimi discards
# SessionStart stdout, so this hook is side effects only: never print.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/common.sh"

input="$(cat)"

mem9_require_node || exit 0
[[ "$(mem9_json_field "${input}" source)" == "startup" ]] || exit 0
if mem9_load_auth; then
  exit 0
fi
if key="$(mem9_provision)"; then
  mem9_log "provisioned new api key"
else
  mem9_log "provisioning failed"
fi
exit 0
