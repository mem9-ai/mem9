#!/usr/bin/env bash
# user-prompt-submit.sh — Lightweight hint that shared memory is available.
# Hook: UserPromptSubmit (sync, timeout: 5s)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

read_stdin

# If not configured, do nothing.
if ! mnemo_check_env 2>/dev/null; then
  exit 0
fi

# Return a system message hint. Claude will see this and may invoke
# the memory-recall skill if it judges the query needs historical context.
cat <<'EOF'
{"systemMessage":"[mem9] Shared memory is available. Use /memory-store to save information the user wants to remember. Use /memory-recall to search past memories when context would help."}
EOF
