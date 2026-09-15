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

A nonempty saved key may still be revoked or pointed at the wrong server — verify it with an authenticated probe before declaring setup complete:

```bash
set -euo pipefail

credentials_file="${MEM9_HOME:-$HOME/.mem9}/.credentials.json"
plugin_version="unknown"
if [ -n "${KIMI_PLUGIN_ROOT:-}" ] && [ -f "${KIMI_PLUGIN_ROOT}/kimi.plugin.json" ]; then
  plugin_version="$(node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.version || "unknown");' "${KIMI_PLUGIN_ROOT}/kimi.plugin.json")"
fi
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
test -n "$api_key"
probe_config="$(mktemp "${TMPDIR:-/tmp}/mem9-curl.XXXXXX")"
trap 'rm -f "$probe_config"' EXIT
{
  printf 'url = "%s"\n' "${base_url%/}/v1alpha2/mem9s/runtime-state"
  printf 'header = "X-API-Key: %s"\n' "${api_key}"
  printf 'header = "User-Agent: mem9-plugin/kimi-code/%s"\n' "${plugin_version}"
} > "$probe_config"
probe_response="$(curl -s --max-time 8 -K "$probe_config" -w $'\n%{http_code}' || printf '\n000')"
probe_status="${probe_response##*$'\n'}"
credential_status="$(printf '%s' "${probe_response%$'\n'"$probe_status"}" | node -e '
const fs = require("node:fs");
let status = "";
try {
  const body = JSON.parse(fs.readFileSync(0, "utf8"));
  const key = body && typeof body === "object" && body.mem9ApiKey && typeof body.mem9ApiKey === "object" ? body.mem9ApiKey : {};
  status = typeof key.status === "string" ? key.status : "";
} catch {}
process.stdout.write(status);
' || true)"
printf 'probe_status=%s credential_status=%s\n' "$probe_status" "${credential_status:-unknown}"
```

The runtime-state endpoint returns HTTP 200 with `mem9ApiKey.status: "inactive"` for a known but disabled key, so the HTTP status alone is not enough — always check both outputs:

- `probe_status` 2xx and `credential_status` `active` (or absent from the body) — the saved credentials work. Tell the user mem9 is initialized and verified, show the credentials file path and active profile id, and stop.
- `probe_status` 2xx with `credential_status` `inactive` — the key is known but disabled. Continue to the provisioning section below to re-provision; the upsert preserves the profile's existing `baseUrl`, so the new key comes from the same server.
- `probe_status` `401`, `403`, or `404` — the server definitively rejected the key (invalid or deleted). Continue to the provisioning section below to re-provision.
- `credential_status` `unknown`, `000`, or any other status — connectivity or server problem. Tell the user the probe failed and suggest retrying; do not re-provision on transient failures.
- Never print the file contents or the API key.
- If the credentials file holds several profiles and none is named `default`, the probe finds no usable key and the hooks deliberately refuse to guess. Ask the user which profile to use (for example by renaming it to `default` in the credentials file); do not provision a new account in that case.

## If credentials are missing or invalid

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
MEM9_SETUP_API_KEY="$api_key" node -e '
const fs = require("node:fs");
const credPath = process.argv[1];
const apiKey = process.env.MEM9_SETUP_API_KEY || "";
const baseUrl = process.argv[2];
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
// Atomic write: a mode-0600 temp file in the same directory, renamed over
// the target, with the temp file removed if anything fails midway.
const tempPath = `${credPath}.${process.pid}.${Date.now()}.tmp`;
try {
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  fs.chmodSync(tempPath, 0o600);
  fs.renameSync(tempPath, credPath);
} catch (error) {
  try { fs.unlinkSync(tempPath); } catch {}
  throw error;
}
' "$credentials_file" "$base_url"
```

The credentials file is shared with other mem9 integrations (for example the Codex plugin); the upsert must merge into it and never drop other profiles.

If the credentials file exists but contains malformed JSON, continue anyway: the base-url probe treats it as absent, and the upsert rewrites a fresh, valid file. Setup is the repair path — a broken file must never abort it.

## If setup cannot complete

- If Node is missing, tell the user to install `Node.js 18+`.
- If provisioning fails, tell the user the mem9 server could not be reached.
- Never print or quote the API key in the reply.
