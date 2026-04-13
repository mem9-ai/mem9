#!/usr/bin/env bash
# stop.sh — Auto-capture session via smart ingest pipeline.
# Hook: Stop (async, timeout: 120s)
#
# Collects recent conversation turns (size-aware) and sends them to the server's
# LLM extraction + reconciliation pipeline, which decides what's worth keeping.
# This replaces the old approach of blindly saving the last assistant message.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

read_stdin

# If not configured, exit silently.
if ! mnemo_check_env 2>/dev/null; then
  exit 0
fi

# Prevent recursion: if we're already in a stop hook, don't re-trigger.
# Also extract conversation messages for smart ingest.
payload=$(echo "$HOOK_INPUT" | python3 -c "
import json, sys, re, os

data = json.load(sys.stdin)

# Check recursion guard
active = str(data.get('stopHookActive', data.get('stop_hook_active', False))).lower()
if active == 'true':
    sys.exit(1)

transcript = data.get('transcript', [])
if not transcript:
    sys.exit(1)

# Strip previously injected memory context to prevent re-ingestion
def strip_injected(content):
    while True:
        start = content.find('<relevant-memories>')
        if start == -1:
            break
        end = content.find('</relevant-memories>')
        if end == -1:
            content = content[:start]
            break
        content = content[:start] + content[end + len('</relevant-memories>'):]
    # Also strip [mem9] blocks from session-start hook
    content = re.sub(r'\[mem9\].*?(?=\n\n|\Z)', '', content, flags=re.DOTALL)
    return content.strip()

# Size-aware message selection: walk backwards, collect up to 200KB / 20 messages
MAX_BYTES = 200_000
MAX_MESSAGES = 20
MIN_TOTAL_LEN = 100  # skip trivially short sessions

selected = []
total_bytes = 0

for turn in reversed(transcript):
    if len(selected) >= MAX_MESSAGES:
        break
    role = turn.get('role', '')
    if role not in ('user', 'assistant'):
        continue

    content = turn.get('content', '')
    if isinstance(content, list):
        # Handle content blocks array
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get('type') == 'text':
                parts.append(block.get('text', ''))
        content = ' '.join(parts)

    if not isinstance(content, str) or not content.strip():
        continue

    cleaned = strip_injected(content)
    if not cleaned:
        continue

    msg_bytes = len(cleaned.encode('utf-8'))
    if total_bytes + msg_bytes > MAX_BYTES and len(selected) > 0:
        break

    selected.insert(0, {'role': role, 'content': cleaned})
    total_bytes += msg_bytes

# Check minimum content threshold
total_content = sum(len(m['content']) for m in selected)
if total_content < MIN_TOTAL_LEN:
    sys.exit(1)

# Build payload for smart ingest
project = os.path.basename(os.environ.get('CLAUDE_PROJECT_DIR', os.getcwd()))
payload = {
    'messages': selected,
    'session_id': 'cc_' + str(hash(json.dumps([m['content'][:50] for m in selected[:3]])) % (10**12)),
    'agent_id': 'claude-code',
    'source': 'claude-code',
    'mode': 'smart',
    'tags': ['auto-captured', project],
}

print(json.dumps(payload))
" 2>/dev/null) || exit 0

if [[ -z "$payload" ]]; then
  exit 0
fi

# POST to memories endpoint — server handles LLM extraction + reconciliation
mnemo_server_post "/memories" "$payload" >/dev/null 2>&1 || true
