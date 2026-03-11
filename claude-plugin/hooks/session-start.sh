#!/usr/bin/env bash
# session-start.sh — Load recent memories and inject them as additionalContext.
# Hook: SessionStart (sync, timeout: 10s)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

read_stdin

# If env vars not set, exit silently (plugin not configured yet).
if ! mnemo_check_env 2>/dev/null; then
  exit 0
fi

# Fetch the 20 most recent memories.
response=$(mnemo_get_memories 20 2>/dev/null || echo "")

if [[ -z "$response" ]]; then
  exit 0
fi

# Extract memories into a readable context block.
context=$(echo "$response" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    memories = data.get('memories', [])
    if not memories:
        sys.exit(0)
    lines = ['[mnemo] Shared memories from your team:']
    lines.append('')
    for m in memories:
        tags = ', '.join(m.get('tags') or [])
        source = m.get('source', '')
        header_parts = []
        if source:
            header_parts.append(f'by {source}')
        if tags:
            header_parts.append(f'[{tags}]')
        header = ' | '.join(header_parts)
        if header:
            lines.append(f'- **{header}**')
        content = m.get('content', '')
        # Truncate very long content for context injection.
        if len(content) > 500:
            content = content[:500] + '...'
        lines.append(f'  {content}')
        lines.append('')
    print('\n'.join(lines))
except Exception:
    pass
" 2>/dev/null || echo "")

if [[ -z "$context" ]]; then
  exit 0
fi

# Return additionalContext to inject into Claude's context.
MEM9_CONTEXT="$context" python3 -c "
import json, os
output = {
    'hookSpecificOutput': {
        'hookEventName': 'SessionStart',
        'additionalContext': os.environ['MEM9_CONTEXT']
    }
}
print(json.dumps(output))
"
