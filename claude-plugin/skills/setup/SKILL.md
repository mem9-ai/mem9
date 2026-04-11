---
description: Use when Mem9 needs to be initialized, repaired, or checked in this Claude Code environment.
context: fork
allowed-tools:
  - Bash
  - Read
  - Edit
disable-model-invocation: true
---

# Mem9 Setup

Use this skill when the user asks to set up Mem9, diagnose why memory is not working, or manually retry initialization.

## What to check

1. Verify `node` is installed and version `>= 18`.
2. Verify `${CLAUDE_PLUGIN_DATA}` is available.
3. Check `${CLAUDE_PLUGIN_DATA}/auth.json`.

## If auth already exists

- Tell the user Mem9 is already initialized.
- Show the auth file path.
- Do not print the file contents or the API key.

## If auth is missing

Provision an API key and write `${CLAUDE_PLUGIN_DATA}/auth.json`:

```bash
set -euo pipefail

plugin_data_dir="${CLAUDE_PLUGIN_DATA}"
test -n "$plugin_data_dir"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)'

response="$(curl -sf --max-time 8 -X POST https://api.mem9.ai/v1alpha1/mem9s)"
api_key="$(printf '%s' "$response" | node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(data.id || "");')"
test -n "$api_key"

auth_file="${plugin_data_dir}/auth.json"
mkdir -p "$(dirname "$auth_file")"
node -e 'const fs=require("node:fs"); const authPath=process.argv[1]; const apiKey=process.argv[2]; const payload={base_url:"https://api.mem9.ai",api_key:apiKey,created_at:new Date().toISOString(),source:"manual_setup_skill"}; fs.writeFileSync(authPath, JSON.stringify(payload, null, 2) + "\n");' "$auth_file" "$api_key"
```

## If setup cannot complete

- If Node is missing, tell the user to install `Node.js 18+`.
- If `${CLAUDE_PLUGIN_DATA}` is missing, tell the user this skill must run from the Mem9 Claude plugin environment.
- If provisioning fails, tell the user Mem9 server could not be reached.
- Never print or quote the API key in the reply.
