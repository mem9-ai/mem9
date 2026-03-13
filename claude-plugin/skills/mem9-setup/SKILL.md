---
name: mem9-setup
description: "Setup Mem9 persistent memory. Triggers: set up mem9, install mem9, configure memory, enable memory."
context: fork
allowed-tools: Bash, Read, Write, Edit
---

# Mem9 Setup for Claude Code

**You are an automated installer. Execute ALL steps yourself — do NOT ask the user to run anything except the final restart.**

## Step 1: Check if already configured

```bash
python3 -c "
import json, os, sys
path = os.path.expanduser('~/.claude/settings.json')
if not os.path.exists(path):
    print('NO_SETTINGS')
    sys.exit(0)
with open(path) as f:
    cfg = json.load(f)
tid = cfg.get('env', {}).get('MEM9_TENANT_ID', '')
if tid:
    print(f'ALREADY_CONFIGURED:{tid}')
else:
    print('NEEDS_TENANT')
"
```

- If `ALREADY_CONFIGURED:<id>` → Skip to Step 3.
- If `NEEDS_TENANT` or `NO_SETTINGS` → Continue to Step 2.

## Step 2: Provision tenant and write config

### 2a: Provision a new tenant

```bash
curl -s -X POST https://api.mem9.ai/v1alpha1/mem9s
```

Extract the `id` field from the JSON response. This is the `MEM9_TENANT_ID`.

**If the curl fails**, tell the user the API might be down and ask them to try later.

### 2b: Write tenant ID to settings.json

Read `~/.claude/settings.json` (create if missing), merge `MEM9_TENANT_ID` into the `env` object, and write it back. **Preserve all existing settings.**

```bash
python3 -c "
import json, os, sys

tenant_id = sys.argv[1]
path = os.path.expanduser('~/.claude/settings.json')

# Read existing or start fresh
cfg = {}
if os.path.exists(path):
    with open(path) as f:
        cfg = json.load(f)

# Merge env
env = cfg.get('env', {})
env['MEM9_TENANT_ID'] = tenant_id
cfg['env'] = env

# Write back
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, 'w') as f:
    json.dump(cfg, f, indent=2)
    f.write('\n')

print(f'OK: MEM9_TENANT_ID={tenant_id} written to {path}')
" "REPLACE_WITH_ACTUAL_TENANT_ID"
```

Replace `REPLACE_WITH_ACTUAL_TENANT_ID` with the actual tenant ID from Step 2a.

## Step 3: Install plugin via CLI

These are CLI commands — run them directly in Bash:

```bash
claude plugin marketplace add mem9-ai/mem9
```

```bash
claude plugin install mem9@mem9
```

**If `claude plugin marketplace add` fails with "already exists"**, that's fine — skip it and continue to install.

**If `claude plugin install` fails with "already installed"**, that's fine — the plugin is already set up.
## Step 4: Confirm and tell user to restart

Summarize what was done:

- ✅ Tenant provisioned: `<tenant_id>`
- ✅ `~/.claude/settings.json` updated with `MEM9_TENANT_ID`
- ✅ Plugin marketplace added and plugin installed

Then tell the user:

> **All done! Just restart Claude Code to activate Mem9 memory.**
>
> After restart, verify by saying "remember that this project uses React 18", then start a new session and ask "what UI framework does this project use?" — the agent should recall it.

---

## Diagnosing Errors

When any mem9 operation fails, follow these steps before asking the user for help.

### Step 1 — Extract key information from the error

From the error message, collect:
- `request_id` — the value inside `[request_id: ...]` if present
- HTTP status code (e.g. `404`, `500`)
- Error message text

### Step 2 — Check service health

Run:

    curl -sS --max-time 8 "https://api.mem9.ai/healthz"

- `{"status":"ok"}` — service is up; proceed to Step 3
- Non-zero exit / empty output / connection error — service is down or unreachable

Note: do NOT use `-f` here or in Step 3. `-f` (--fail) causes curl to suppress the
response body and exit non-zero on 4xx/5xx, which is exactly the signal needed in Step 4.

### Step 3 — Probe a business endpoint

Run (replace `$SPACE_ID` with the value of `MEM9_TENANT_ID`):

    curl -i -sS --max-time 8 \
      "https://api.mem9.ai/v1alpha1/mem9s/$SPACE_ID/memories?limit=1"

`-i` prints response headers (required to see `X-Request-Id`). `-sS` suppresses
the progress meter but still shows errors. No `-f` so the body is always captured
regardless of HTTP status.

This step is required. `/healthz` returning `200` does not guarantee business
routes are working — the motivating incident was exactly "healthz OK, memories 404."

### Step 4 — Classify

| /healthz | Business endpoint | Body shape | Likely cause |
|---|---|---|---|
| unreachable | — | — | network or service outage |
| OK | `404` or `405` | JSON `{"error":"...","request_id":"..."}` | bad space/tenant ID or wrong HTTP method — verify URL and `MEM9_TENANT_ID` in settings |
| OK | `404` or `405` | non-JSON or empty | ingress or path-rewrite failure, or chi route/method mismatch — check gateway routing |
| OK | `403` | JSON server error | tenant not active — check tenant status |
| OK | `429` | JSON server error | rate limit exceeded — back off and retry |
| OK | `500` | — | server-side bug |
| OK | `503` | — | transient overload or DB unavailable — retry after 30s |

### Step 5 — Report to the user

Always tell the user:

> mem9 encountered an error. If this persists, please send the following to the mem9 team:
> - request_id: `<value or "not present">`
> - Error: `<message>`
> - /healthz: `<ok or unreachable>`
> - Business endpoint status: `<status code or error>`

Never ask the user to inspect server logs — they cannot access them.
