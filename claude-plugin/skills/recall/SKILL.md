---
description: Use when the current request needs relevant memories from Mem9.
context: fork
allowed-tools:
  - Bash
  - Read
disable-model-invocation: true
---

# Mem9 Recall

Use this skill when the current request could benefit from historical context stored in Mem9.

## Steps

1. Check `${CLAUDE_PLUGIN_DATA}/auth.json`. If it is missing, tell the user to run `/mem9:setup` first.
2. Use `${CLAUDE_PLUGIN_DATA}/auth.json` only as request credentials. Do not print the file contents or the API key.
3. Search Mem9 with the current question and `agent_id=claude-code-main`.

```bash
set -euo pipefail

auth_file="${CLAUDE_PLUGIN_DATA}/auth.json"
test -f "$auth_file"
read_api_key_and_base_url="$(node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const values=[data.api_key || "", data.base_url || "https://api.mem9.ai"]; process.stdout.write(values.join("\t"));' "$auth_file")"
api_key="${read_api_key_and_base_url%%	*}"
base_url="${read_api_key_and_base_url#*	}"
test -n "$api_key"
test -n "$base_url"

query='REPLACE_WITH_SEARCH_QUERY'
encoded_query="$(printf '%s' "$query" | node -e 'const fs=require("node:fs"); const raw=fs.readFileSync(0,"utf8").trim(); process.stdout.write(encodeURIComponent(raw));')"

curl -sf --max-time 8 \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${api_key}" \
  -H "X-Mnemo-Agent-Id: claude-code" \
  "${base_url%/}/v1alpha2/mem9s/memories?q=${encoded_query}&agent_id=claude-code-main&limit=10"
```

Return only the memories that help with the current question. Never reveal secret values.
