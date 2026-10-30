---
name: mem9-store
description: Use when the user explicitly asks to remember one fact, preference, or instruction in mem9.
---

# Mem9 Store

Use this skill only when the user explicitly asks to remember or save something to mem9.

## Steps

1. Extract the one fact, preference, or instruction that should be remembered.
2. Resolve credentials: `MEM9_API_KEY` (with optional `MEM9_API_URL`) when set, otherwise `${MEM9_HOME:-$HOME/.mem9}/.credentials.json`. If neither yields a key, tell the user to run the `mem9-setup` skill first.
3. Write the exact memory text to a temp file with the Write tool (e.g. `${TMPDIR:-/tmp}/mem9-store.txt`) and put its path in place of `REPLACE_WITH_MEMORY_FILE` below — never embed the text in the command itself. Then store it with the single-message `content` API. Do not invent tags client-side.

```bash
set -euo pipefail

api_key="${MEM9_API_KEY:-}"
base_url="${MEM9_API_URL:-}"
if [ -z "$api_key" ]; then
  read_credentials="$(node -e '
const fs = require("node:fs");
let data = {};
try { data = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch {}
const profiles = data && data.profiles && typeof data.profiles === "object" ? data.profiles : {};
const ids = Object.keys(profiles);
const profile = profiles.default || (ids.length === 1 ? profiles[ids[0]] : {});
const key = profile && typeof profile.apiKey === "string" ? profile.apiKey.trim() : "";
const url = profile && typeof profile.baseUrl === "string" ? profile.baseUrl.trim() : "";
process.stdout.write(key + "\t" + url);
' "${MEM9_HOME:-$HOME/.mem9}/.credentials.json")"
  api_key="${read_credentials%%	*}"
  base_url="${base_url:-${read_credentials##*	}}"
fi
test -n "$api_key"
base_url="${base_url:-https://api.mem9.ai}"

memory_file="REPLACE_WITH_MEMORY_FILE"
payload="$(node -e 'const fs=require("node:fs"); process.stdout.write(JSON.stringify({content: fs.readFileSync(process.argv[1], "utf8").replace(/\n+$/,"")}))' "$memory_file")"
rm -f "$memory_file"

printf '%s' "$payload" | curl -sf --max-time 8 \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${api_key}" \
  -H "X-Mnemo-Agent-Id: kimi-code" \
  --data-binary @- \
  "${base_url%/}/v1alpha2/mem9s/memories"
```

Confirm back to the user what was saved. Never reveal secret values.
