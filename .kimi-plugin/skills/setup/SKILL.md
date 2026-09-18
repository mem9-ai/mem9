---
name: mem9-setup
description: Use when mem9 memory needs to be initialized, repaired, or diagnosed in this Kimi Code environment.
---

# Mem9 Setup

Use this skill when the user asks to set up mem9, diagnose why memory is not working, or manually retry initialization.

## What to check

1. Verify `node` is installed and version `>= 18`.
2. If `MEM9_API_KEY` is set in the environment, it overrides everything — mem9 is initialized via the environment. Do not provision; if memory is broken, the user must fix or unset that variable first.
3. Check the shared credentials file `${MEM9_HOME:-$HOME/.mem9}/.credentials.json` for a usable profile (`profiles.default`, or the only profile if there is exactly one). If it holds a nonempty `apiKey`, mem9 is initialized — say so, show the file path, and stop. Never print the key.

## If credentials are missing

Provision a key and save it as the default profile, preserving any other profiles:

```bash
set -euo pipefail

credentials_file="${MEM9_HOME:-$HOME/.mem9}/.credentials.json"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)'
base_url="${MEM9_API_URL:-https://api.mem9.ai}"

api_key="$(curl -sf --max-time 8 -X POST "${base_url%/}/v1alpha1/mem9s" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{process.stdout.write(JSON.parse(s).id||"")}catch{}})')"
test -n "$api_key"

MEM9_NEW_KEY="$api_key" node -e '
const fs = require("node:fs");
const path = require("node:path");
const file = process.argv[1];
let data = {};
try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
const profiles = data && data.profiles && typeof data.profiles === "object" && !Array.isArray(data.profiles) ? data.profiles : {};
const existing = profiles.default && typeof profiles.default === "object" && !Array.isArray(profiles.default) ? profiles.default : {};
profiles.default = { label: existing.label || "default", baseUrl: existing.baseUrl || process.argv[2], apiKey: process.env.MEM9_NEW_KEY };
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, profiles }, null, 2) + "\n", { mode: 0o600 });
fs.chmodSync(file, 0o600);
' "$credentials_file" "$base_url"
```

The credentials file is shared with other mem9 integrations (for example the Codex plugin); merge into it and never drop other profiles. If the file is malformed, the write above replaces it with a fresh valid one — that is the intended repair path.

## If setup cannot complete

- If Node is missing, tell the user to install `Node.js 18+`.
- If provisioning fails, tell the user the mem9 server could not be reached.
- Never print or quote the API key in the reply.
