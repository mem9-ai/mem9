#!/usr/bin/env bash
# pre-compact.sh — upload a larger recent window (12 messages / 120 KB)
# before context compaction.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/common.sh"

mem9_require_node || exit 0
mem9_load_auth || exit 0
mem9_ingest precompact 12 120000
exit 0
