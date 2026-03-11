---
name: mem9-setup
description: "Setup mem9 persistent memory for OpenCode. Triggers: set up mem9, install mem9, configure memory, enable memory, setup memory, mem9 onboarding, memory not working."
---

# mem9 Setup for OpenCode

**You are an automated installer. Execute ALL steps yourself — do NOT ask the user to run anything except the final restart.**

## Terminology

Use this distinction consistently when talking to users:

| Internal term | User-facing explanation |
|---|---|
| `tenantID` | Internal config field; do not surface unless editing config |
| `SPACE_ID` / `MEM9_TENANT_ID` | The user's mem9 space ID — reconnects to the same memory |
| "space ID" | Preferred user-facing term |

Security note: Treat the space ID like a secret. Anyone who has it can access that mem9 space.

---

## Step 0 — Check for existing configuration

Ask the user before doing anything else:

> Which setup do you want?
> 1. Create a new mem9 space
> 2. Reconnect an existing mem9 space
>
> If you choose reconnect, paste your existing space ID.

**Branching:**
- If reconnect with existing ID → verify it first (Step 0b), then skip to Step 2.
- If create new → continue to Step 1.

### Step 0b — Verify existing space

```bash
curl -sf --max-time 8 \
  "https://api.mem9.ai/v1alpha1/mem9s/$SPACE_ID/memories?limit=1" \
  && echo "OK" || echo "UNREACHABLE"
```

If `OK` → continue to Step 2.
If `UNREACHABLE` → ask user to re-check or create a new space.

---

## Step 1 — Create a new mem9 space

> Skip if the user provided an existing space ID in Step 0.

```bash
curl -sX POST https://api.mem9.ai/v1alpha1/mem9s
```

Response:
```json
{ "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" }
```

Save the `id` as `SPACE_ID`. Tell the user:

> Your new mem9 space is ready. This space ID is how you reconnect to the same memory from any machine.
>
> **Important:** This space ID is also your secret. Never share it with anyone.

---

## Step 2 — Configure environment variables

Set the mem9 connection in the user's shell profile or environment:

```bash
export MEM9_TENANT_ID="<space-id>"
```

For persistent config, add to `~/.bashrc`, `~/.zshrc`, or the relevant shell profile.

**No `MEM9_API_URL` is needed** — the plugin defaults to `https://api.mem9.ai`.

For self-hosted servers, also set:
```bash
export MEM9_API_URL="http://your-server:8080"
```



---

## Step 3 — Install the plugin

### Method A: npm plugin (Recommended)

Add to your project's `opencode.json`:

```json
{
  "plugin": ["@mem9/opencode"]
}
```

OpenCode will auto-install the plugin from npm on next startup.

### Method B: From source

```bash
git clone https://github.com/mem9-ai/mem9.git
cd mem9/opencode-plugin
npm install
```

Then register in `opencode.json`:

```json
{
  "plugins": {
    "mem9": {
      "path": "/absolute/path/to/mem9/opencode-plugin"
    }
  }
}
```

---

## Step 4 — Verify setup

Start OpenCode. You should see:

```
[mem9] Server mode (mem9 REST API)
```

If you see `[mem9] No MEM9_TENANT_ID configured`, check your env vars.

**Quick verification:**
- Ask the agent to "remember that this project uses React 18"
- Start a new session and ask "what UI framework does this project use?"
- The agent should recall the stored memory.

---

## Step 5 — What's Next

After successful setup, send the user:

```
✅ Your mem9 space is ready.

🧭 WHAT YOU CAN DO NEXT

Your agent now has persistent cloud memory. Memories are automatically
injected into context at the start of every chat turn.

Available tools:
- memory_store: Save facts, decisions, context
- memory_search: Find memories by keywords and meaning
- memory_get: Retrieve by ID
- memory_update: Modify existing memory
- memory_delete: Remove

💾 YOUR MEM9 SPACE ID

SPACE_ID: <your-space-id>

This ID is your access key to mem9.
Keep it private and store it somewhere safe.

♻️ RECOVERY

Set the same MEM9_TENANT_ID on any machine to reconnect to your memory.
Your memory will reconnect instantly.

📦 BACKUP PLAN

Save the space ID in a password manager or secure vault.
```

---

## API Reference

Base: `https://api.mem9.ai`
Routes: `/v1alpha1/mem9s/{tenantID}/...`
Header: `X-Mnemo-Agent-Id: <name>` (optional)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1alpha1/mem9s` | Provision tenant |
| GET | `/healthz` | Health check |
| POST | `/{tenantID}/memories` | Create memory |
| GET | `/{tenantID}/memories` | Search (`?q=`, `?tags=`, `?source=`, `?limit=`) |
| GET | `/{tenantID}/memories/{id}` | Get by ID |
| PUT | `/{tenantID}/memories/{id}` | Update |
| DELETE | `/{tenantID}/memories/{id}` | Delete |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `No MEM9_TENANT_ID configured` | Set `MEM9_TENANT_ID` env var |
| Plugin not loading | Check `opencode.json` has `"plugin": ["@mem9/opencode"]` |
| `404` on API call | Verify space ID; run `curl https://api.mem9.ai/healthz` |
| Existing space ID unreachable | Re-check for typos; confirm network access to `api.mem9.ai` |
