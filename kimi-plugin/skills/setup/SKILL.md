---
name: mem9-setup
description: Use when mem9 memory needs to be initialized, repaired, or diagnosed in this Kimi Code environment.
---

# Mem9 Setup

Use this skill when the user asks to set up mem9, diagnose why memory is not working, or manually retry initialization.

## What to check

1. Verify `node` is installed and version `>= 18`.
2. Check whether `MEM9_API_KEY` is set in the environment. It overrides the credentials file in every hook and skill, so:
   - If it is set and memory works, tell the user mem9 is initialized via the environment and stop — do not provision.
   - If it is set and memory is broken, the env override is the problem: provisioning a saved key would change nothing. Direct the user to fix or unset `MEM9_API_KEY` (and `MEM9_API_URL`) first, and stop.
3. Check the shared credentials file `${MEM9_HOME:-$HOME/.mem9}/.credentials.json` for a usable profile (`profiles.default`, or the only profile if there is exactly one).

## If credentials already exist

- Tell the user mem9 is already initialized.
- Show the credentials file path and the active profile id.
- Do not print the file contents or the API key.

## If credentials are missing

Provision an API key and upsert `profiles.default` into the shared credentials file, preserving any other profiles. Provision against `MEM9_API_URL` when set, otherwise the existing profile's `baseUrl` (a new key must come from the server it will be used against), otherwise the cloud default:

```bash
set -euo pipefail

credentials_file="${MEM9_HOME:-$HOME/.mem9}/.credentials.json"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)'
plugin_version="unknown"
if [ -n "${KIMI_PLUGIN_ROOT:-}" ] && [ -f "${KIMI_PLUGIN_ROOT}/kimi.plugin.json" ]; then
  plugin_version="$(node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.version || "unknown");' "${KIMI_PLUGIN_ROOT}/kimi.plugin.json")"
fi

base_url="${MEM9_API_URL:-}"
if [ -z "$base_url" ] && [ -f "$credentials_file" ]; then
  base_url="$(node -e '
const fs = require("node:fs");
let data = {};
try { data = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch {}
if (!data || typeof data !== "object" || Array.isArray(data)) data = {};
const isRecord = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const profiles = isRecord(data.profiles) ? data.profiles : {};
const ids = Object.keys(profiles);
const profile = isRecord(profiles.default)
  ? profiles.default
  : (ids.length === 1 && isRecord(profiles[ids[0]]) ? profiles[ids[0]] : {});
process.stdout.write(typeof profile.baseUrl === "string" ? profile.baseUrl.trim() : "");
' "$credentials_file")"
fi
base_url="${base_url:-https://api.mem9.ai}"

response="$(curl -sf --max-time 8 -X POST \
  -H "User-Agent: mem9-plugin/kimi-code/${plugin_version}" \
  "${base_url%/}/v1alpha1/mem9s")"
api_key="$(printf '%s' "$response" | node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(data.id || "");')"
test -n "$api_key"

mkdir -p "$(dirname "$credentials_file")"
node -e '
const fs = require("node:fs");
const credPath = process.argv[1];
const apiKey = process.argv[2];
const baseUrl = process.argv[3];
let data = {};
try { data = JSON.parse(fs.readFileSync(credPath, "utf8")); } catch {}
if (!data || typeof data !== "object" || Array.isArray(data)) data = {};
const profiles = data.profiles && typeof data.profiles === "object" && !Array.isArray(data.profiles) ? data.profiles : {};
const existing = profiles.default && typeof profiles.default === "object" && !Array.isArray(profiles.default) ? profiles.default : {};
profiles.default = {
  ...existing,
  label: typeof existing.label === "string" && existing.label ? existing.label : "default",
  baseUrl: baseUrl || (typeof existing.baseUrl === "string" && existing.baseUrl ? existing.baseUrl : "https://api.mem9.ai"),
  apiKey,
};
data.schemaVersion = 1;
data.profiles = profiles;
fs.writeFileSync(credPath, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
fs.chmodSync(credPath, 0o600);
' "$credentials_file" "$api_key" "$base_url"
```

The credentials file is shared with other mem9 integrations (for example the Codex plugin); the upsert must merge into it and never drop other profiles.

If the credentials file exists but contains malformed JSON, continue anyway: the base-url probe treats it as absent, and the upsert rewrites a fresh, valid file. Setup is the repair path — a broken file must never abort it.

## If setup cannot complete

- If Node is missing, tell the user to install `Node.js 18+`.
- If provisioning fails, tell the user the mem9 server could not be reached.
- Never print or quote the API key in the reply.
