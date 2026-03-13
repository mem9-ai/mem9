#!/usr/bin/env bash
# stop.sh — Summarize the last assistant turn and save to mnemo.
# Hook: Stop (async, timeout: 120s)
# Async means this runs in the background — it won't block Claude from responding.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

read_stdin

# If not configured, exit silently.
if ! mnemo_check_env 2>/dev/null; then
  exit 0
fi

# Prevent recursion: if we're already in a stop hook, don't re-trigger.
# Also extract last assistant message from the hook input.
eval "$(echo "$HOOK_INPUT" | python3 -c "
import json, sys, shlex
data = json.load(sys.stdin)

# Check recursion guard
active = str(data.get('stopHookActive', data.get('stop_hook_active', False))).lower()
print(f'stop_hook_active={shlex.quote(active)}')

# Extract last assistant message from transcript (array of turns)
transcript = data.get('transcript', [])
msg = ''
for turn in reversed(transcript):
    if turn.get('role') == 'assistant':
        msg = turn.get('content', '')
        break
# Fallback: try legacy field name
if not msg:
    msg = data.get('last_assistant_message', '')
if len(msg) > 8000:
    msg = msg[:8000] + '...'
print(f'last_message={shlex.quote(msg)}')
" 2>/dev/null)" || { stop_hook_active="false"; last_message=""; }

if [[ "$stop_hook_active" == "true" ]]; then
  exit 0
fi

if [[ -z "$last_message" || ${#last_message} -lt 50 ]]; then
  # Too short to be worth saving.
  exit 0
fi

# Truncate the last message as the memory content.
# NOTE: LLM summarization (claude -p --model haiku) was removed because it
# causes hangs on Bedrock setups and risks recursive hook invocation.
summary=$(echo "$last_message" | python3 -c "
import sys
msg = sys.stdin.read().strip()
if len(msg) > 1000:
    msg = msg[:1000] + '...'
print(msg)
" 2>/dev/null || echo "")

if [[ -z "$summary" || ${#summary} -lt 10 ]]; then
  exit 0
fi

# Determine tags from the working directory.
project_name=$(basename "${CLAUDE_PROJECT_DIR:-$(pwd)}" 2>/dev/null || echo "unknown")

# Save to mnemo.
body=$(MEM9_SUMMARY="$summary" MEM9_PROJECT="$project_name" python3 -c "
import json, os
payload = {
    'content': os.environ['MEM9_SUMMARY'],
    'tags': ['auto-captured', os.environ['MEM9_PROJECT']]
}
print(json.dumps(payload))
" 2>/dev/null || echo "")

if [[ -n "$body" ]]; then
  mnemo_post_memory "$body" >/dev/null 2>&1 || true
fi
