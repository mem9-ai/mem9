#!/usr/bin/env bash
# user-prompt-submit.sh — recall relevant memories on each user turn.
# Kimi injects this hook's stdout into the model context as plain text.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/common.sh"

input="$(cat)"

mem9_require_node || exit 0
mem9_load_auth || exit 0
prompt="$(mem9_json_prompt "${input}")"
[[ -n "${prompt}" ]] || exit 0

query="$(printf '%s' "${prompt}" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(encodeURIComponent(s.trim())))')"
response="$(mem9_curl GET "/memories?q=${query}&limit=10")" || exit 0
[[ -n "${response}" ]] || exit 0
printf '%s' "${response}" | node "${MEM9_SCRIPT_DIR}/lib/format.mjs"
exit 0
