---
name: mem9-recall
description: Use when the current request needs relevant memories from mem9.
---

# Mem9 Recall

Use this skill when the current request could benefit from historical context stored in mem9.

## Steps

1. Resolve credentials: if `MEM9_API_KEY` is set, use it (with `MEM9_API_URL` when set). Otherwise check `${MEM9_HOME:-$HOME/.mem9}/.credentials.json`; if it is missing or has no usable profile, tell the user to run the `mem9-setup` skill first. An explicit `MEM9_API_URL` always overrides the profile's `baseUrl`.
2. Use the resolved credentials only for the request. Do not print the credentials file contents or the API key.
3. Create a private input directory first: `input_dir="$(mktemp -d "${TMPDIR:-/tmp}/mem9-input.XXXXXX")"` (mode 0700), then write the exact query text to `${input_dir}/input.txt` using the Write tool — the 0700 directory keeps the content unreadable by other users even before cleanup, regardless of the Write tool's file mode. Put the directory path in place of `REPLACE_WITH_INPUT_DIR` below. Never embed the query in the command itself — shell quoting and heredoc delimiters are both unsafe for arbitrary user text. Then search mem9 across all agents in the account (no `agent_id` filter).

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

input_dir="REPLACE_WITH_INPUT_DIR"
query_file="${input_dir}/input.txt"
curl_config="$(mktemp "${TMPDIR:-/tmp}/mem9-curl.XXXXXX")"
trap 'rm -f "$curl_config"; rm -rf "$input_dir"' EXIT
encoded_query="$(node -e 'const fs=require("node:fs"); const raw=fs.readFileSync(process.argv[1],"utf8").trim(); process.stdout.write(encodeURIComponent(raw));' "$query_file")"
{
  printf 'url = "%s"\n' "${base_url%/}/v1alpha2/mem9s/memories?q=${encoded_query}&limit=10"
  printf 'header = "Content-Type: application/json"\n'
  printf 'header = "X-API-Key: %s"\n' "${api_key}"
  printf 'header = "X-Mnemo-Agent-Id: kimi-code"\n'
  printf 'header = "User-Agent: mem9-plugin/kimi-code/%s"\n' "${plugin_version}"
} > "$curl_config"
curl -sf --max-time 8 -K "$curl_config"
```

If several profiles exist and none is named `default`, tell the user to pick one (for example by renaming it to `default` in the credentials file) instead of guessing.

Return only the memories that help with the current question. Never reveal secret values.
