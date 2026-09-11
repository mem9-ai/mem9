---
name: mem9-store
description: Use when the user explicitly asks to remember one fact, preference, or instruction in mem9.
---

# Mem9 Store

Use this skill only when the user explicitly asks to remember or save something to mem9.

## Steps

1. Extract the one fact, preference, or instruction that should be remembered.
2. Resolve credentials: if `MEM9_API_KEY` is set, use it (with `MEM9_API_URL` when set). Otherwise use `${MEM9_HOME:-$HOME/.mem9}/.credentials.json`; if it is missing or has no usable profile, tell the user to run the `mem9-setup` skill first. An explicit `MEM9_API_URL` always overrides the profile's `baseUrl`. Do not print the credentials file contents or the API key.
3. Write the exact memory text to a fresh temporary file with the Write tool (for example `${TMPDIR:-/tmp}/mem9-store-<random>.txt`) and put its path in place of `REPLACE_WITH_FILE_PATH` below. Never embed the text in the command itself — shell quoting and heredoc delimiters are both unsafe for arbitrary user text.
4. Store the memory with the single-message `content` API. Do not invent tags client-side.

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

memory_file="REPLACE_WITH_FILE_PATH"
curl_config="$(mktemp "${TMPDIR:-/tmp}/mem9-curl.XXXXXX")"
trap 'rm -f "$curl_config" "$memory_file"' EXIT
payload="$(node -e 'const fs=require("node:fs"); const content=fs.readFileSync(process.argv[1],"utf8").replace(/\n+$/,""); process.stdout.write(JSON.stringify({ content }));' "$memory_file")"
{
  printf 'url = "%s"\n' "${base_url%/}/v1alpha2/mem9s/memories"
  printf 'header = "Content-Type: application/json"\n'
  printf 'header = "X-API-Key: %s"\n' "${api_key}"
  printf 'header = "X-Mnemo-Agent-Id: kimi-code"\n'
  printf 'header = "User-Agent: mem9-plugin/kimi-code/%s"\n' "${plugin_version}"
} > "$curl_config"
printf '%s' "$payload" | curl -sf --max-time 8 -K "$curl_config" --data-binary @-
```

Confirm back to the user what was saved. Never reveal secret values.
