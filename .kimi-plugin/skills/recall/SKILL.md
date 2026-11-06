---
name: mem9-recall
description: Use when the current request needs relevant memories from mem9.
---

# Mem9 Recall

Use this skill when the current request could benefit from historical context stored in mem9.

## Steps

1. Resolve credentials: `MEM9_API_KEY` (with optional `MEM9_API_URL`) when set, otherwise `${MEM9_HOME:-$HOME/.mem9}/.credentials.json`. If neither yields a key, tell the user to run the `mem9-setup` skill first.
2. Write the query to a temp file with the Write tool (e.g. `${TMPDIR:-/tmp}/mem9-query.txt`) and put its path in place of `REPLACE_WITH_QUERY_FILE` below — never embed the query in the command itself (shell quoting and heredocs are both unsafe for arbitrary text). Then search mem9 across all agents in the account (no `agent_id` filter).

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

query_file="REPLACE_WITH_QUERY_FILE"
query="$(node -e 'const fs=require("node:fs"); process.stdout.write(encodeURIComponent(fs.readFileSync(process.argv[1], "utf8").trim()))' "$query_file")"
rm -f "$query_file"

curl -sf --max-time 8 \
  -H "X-API-Key: ${api_key}" \
  -H "X-Mnemo-Agent-Id: kimi-code" \
  "${base_url%/}/v1alpha2/mem9s/memories?q=${query}&limit=10"
```

Return only the memories that help with the current question. Never reveal secret values.
