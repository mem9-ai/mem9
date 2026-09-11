---
name: mem9-recall
description: Use when the current request needs relevant memories from mem9.
---

# Mem9 Recall

Use this skill when the current request could benefit from historical context stored in mem9.

## Steps

1. Resolve credentials: if `MEM9_API_KEY` is set, use it (with `MEM9_API_URL` when set). Otherwise check `${MEM9_HOME:-$HOME/.mem9}/.credentials.json`; if it is missing or has no usable profile, tell the user to run the `mem9-setup` skill first. An explicit `MEM9_API_URL` always overrides the profile's `baseUrl`.
2. Use the resolved credentials only for the request. Do not print the credentials file contents or the API key.
3. Search mem9 with the current question across all agents in the account (no `agent_id` filter).

```bash
set -euo pipefail

if [ -n "${MEM9_API_KEY:-}" ]; then
  api_key="$MEM9_API_KEY"
  base_url="${MEM9_API_URL:-https://api.mem9.ai}"
else
  credentials_file="${MEM9_HOME:-$HOME/.mem9}/.credentials.json"
  test -f "$credentials_file"
  read_api_key_and_base_url="$(node -e '
const fs = require("node:fs");
const isRecord = (v) => v != null && typeof v === "object" && !Array.isArray(v);
let data = {};
try { data = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch {}
if (!isRecord(data)) data = {};
const profiles = isRecord(data.profiles) ? data.profiles : {};
const ids = Object.keys(profiles);
const profile = isRecord(profiles.default)
  ? profiles.default
  : (ids.length === 1 && isRecord(profiles[ids[0]]) ? profiles[ids[0]] : {});
const apiKey = typeof profile.apiKey === "string" ? profile.apiKey.trim() : "";
const baseUrl = typeof profile.baseUrl === "string" && profile.baseUrl.trim()
  ? profile.baseUrl.trim()
  : "https://api.mem9.ai";
process.stdout.write([apiKey, baseUrl].join("\t"));
' "$credentials_file")"
  api_key="${read_api_key_and_base_url%%	*}"
  base_url="${MEM9_API_URL:-${read_api_key_and_base_url#*	}}"
fi
test -n "$api_key"
test -n "$base_url"
plugin_version="unknown"
if [ -n "${KIMI_PLUGIN_ROOT:-}" ] && [ -f "${KIMI_PLUGIN_ROOT}/kimi.plugin.json" ]; then
  plugin_version="$(node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.version || "unknown");' "${KIMI_PLUGIN_ROOT}/kimi.plugin.json")"
fi

IFS= read -r -d '' query <<'MEM9_QUERY' || true
REPLACE_WITH_SEARCH_QUERY
MEM9_QUERY
encoded_query="$(printf '%s' "$query" | node -e 'const fs=require("node:fs"); const raw=fs.readFileSync(0,"utf8").trim(); process.stdout.write(encodeURIComponent(raw));')"

curl -sf --max-time 8 \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${api_key}" \
  -H "X-Mnemo-Agent-Id: kimi-code" \
  -H "User-Agent: mem9-plugin/kimi-code/${plugin_version}" \
  "${base_url%/}/v1alpha2/mem9s/memories?q=${encoded_query}&limit=10"
```

If several profiles exist and none is named `default`, tell the user to pick one (for example by renaming it to `default` in the credentials file) instead of guessing.

Return only the memories that help with the current question. Never reveal secret values.
