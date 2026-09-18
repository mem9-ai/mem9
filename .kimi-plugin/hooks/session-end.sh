#!/usr/bin/env bash
# session-end.sh — best-effort light flush on session end.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/common.sh"

mem9_require_node || exit 0
mem9_load_auth || exit 0
mem9_ingest sessionend 4 20000
exit 0
