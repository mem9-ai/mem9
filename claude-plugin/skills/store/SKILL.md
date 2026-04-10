---
name: store
description: "Store an explicit user-provided fact or preference in Mem9."
context: fork
allowed-tools:
  - Bash
  - Read
disable-model-invocation: true
---

# Mem9 Store

Use this skill only when the user explicitly asks to remember or save something.

## Steps

1. Extract the fact that should be remembered.
2. Pick 1-3 short tags.
3. Load `api_key` from `${CLAUDE_PLUGIN_DATA}/auth.json`. If auth is missing, tell the user to run `/mem9:setup`.
4. Store the memory with the single-message `content` API.

```bash
set -euo pipefail

auth_file="${CLAUDE_PLUGIN_DATA}/auth.json"
test -f "$auth_file"
read_api_key_and_base_url="$(node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const values=[data.api_key || data.tenant_id || "", data.base_url || "https://api.mem9.ai"]; process.stdout.write(values.join("\t"));' "$auth_file")"
api_key="${read_api_key_and_base_url%%	*}"
base_url="${read_api_key_and_base_url#*	}"
test -n "$api_key"
test -n "$base_url"

curl -sf --max-time 8 \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${api_key}" \
  -H "X-Mnemo-Agent-Id: claude-code" \
  -d '{"content":"REPLACE_WITH_MEMORY","tags":["tag1","tag2"]}' \
  "${base_url%/}/v1alpha2/mem9s/memories"
```

Confirm back to the user what was saved.
