---
description: Use when the user explicitly asks Claude to remember one fact, preference, or instruction in Mem9.
context: fork
allowed-tools:
  - Bash
  - Read
disable-model-invocation: true
---

# Mem9 Store

Use this skill only when the user explicitly asks Claude to remember or save something to Mem9.

## Steps

1. Extract the one fact, preference, or instruction that should be remembered.
2. Use `${CLAUDE_PLUGIN_DATA}/auth.json` only as request credentials. If auth is missing, tell the user to run `/mem9:setup`. Do not print the file contents or the API key.
3. Store the memory with the single-message `content` API. Do not invent tags client-side.

```bash
set -euo pipefail

auth_file="${CLAUDE_PLUGIN_DATA}/auth.json"
test -f "$auth_file"
read_api_key_and_base_url="$(node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const values=[data.api_key || "", data.base_url || "https://api.mem9.ai"]; process.stdout.write(values.join("\t"));' "$auth_file")"
api_key="${read_api_key_and_base_url%%	*}"
base_url="${read_api_key_and_base_url#*	}"
test -n "$api_key"
test -n "$base_url"

curl -sf --max-time 8 \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${api_key}" \
  -H "X-Mnemo-Agent-Id: claude-code" \
  -d '{"content":"REPLACE_WITH_MEMORY"}' \
  "${base_url%/}/v1alpha2/mem9s/memories"
```

Confirm back to the user what was saved. Never reveal secret values.
