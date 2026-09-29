#!/usr/bin/env bash
# stop.sh — upload the last completed turn (up to 4 messages / 20 KB).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/common.sh"

mem9_require_node || exit 0
mem9_load_auth || exit 0
mem9_ingest stop 4 20000
exit 0
