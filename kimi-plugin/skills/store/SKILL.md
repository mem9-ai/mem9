---
name: mem9-store
description: Use when the user explicitly asks to remember one fact, preference, or instruction in mem9.
---

# Mem9 Store

Use this skill only when the user explicitly asks to remember or save something to mem9.

## Steps

1. Extract the one fact, preference, or instruction that should be remembered.
2. Use `${MEM9_HOME:-$HOME/.mem9}/.credentials.json` only as request credentials. If it is missing or has no usable profile, tell the user to run the `mem9-setup` skill first. Do not print the file contents or the API key.
3. Store the memory with the single-message `content` API. Do not invent tags client-side.

```bash
set -euo pipefail

credentials_file="${MEM9_HOME:-$HOME/.mem9}/.credentials.json"
test -f "$credentials_file"
read_api_key_and_base_url="$(node -e '
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const profiles = data.profiles && typeof data.profiles === "object" ? data.profiles : {};
const ids = Object.keys(profiles);
const profile = profiles.default && typeof profiles.default === "object"
  ? profiles.default
  : (ids.length === 1 && typeof profiles[ids[0]] === "object" ? profiles[ids[0]] : {});
const values = [profile.apiKey || "", profile.baseUrl || "https://api.mem9.ai"];
process.stdout.write(values.join("\t"));
' "$credentials_file")"
api_key="${read_api_key_and_base_url%%	*}"
base_url="${read_api_key_and_base_url#*	}"
test -n "$api_key"
test -n "$base_url"
plugin_version="unknown"
if [ -n "${KIMI_PLUGIN_ROOT:-}" ] && [ -f "${KIMI_PLUGIN_ROOT}/kimi.plugin.json" ]; then
  plugin_version="$(node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.version || "unknown");' "${KIMI_PLUGIN_ROOT}/kimi.plugin.json")"
fi

memory_text='REPLACE_WITH_MEMORY'
payload="$(printf '%s' "$memory_text" | node -e 'const fs=require("node:fs"); const content=fs.readFileSync(0,"utf8"); process.stdout.write(JSON.stringify({ content }));')"

curl -sf --max-time 8 \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${api_key}" \
  -H "X-Mnemo-Agent-Id: kimi-code" \
  -H "User-Agent: mem9-plugin/kimi-code/${plugin_version}" \
  -d "$payload" \
  "${base_url%/}/v1alpha2/mem9s/memories"
```

Confirm back to the user what was saved. Never reveal secret values.
