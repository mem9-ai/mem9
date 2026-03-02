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
{"systemMessage":"[mnemo] Shared memory is available. If the user's question could benefit from past decisions, project history, or team knowledge, use the /memory-recall skill."}
EOF
