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

## Step 0 — Choose plugin install scope

Ask the user before doing anything else:

> Where do you want to install the mem9 plugin?
> 1. **Global** — available in every OpenCode project on this machine
> 2. **Project** — only active in the current project directory

**Branching:**
- If **global** → target file is `~/.config/opencode/opencode.json` (create if absent).
- If **project** → target file is `opencode.json` in the current project root (create if absent).

Save the chosen target file path — it is used in Step 3.

---

## Step 1 — Choose or provide mem9 space

Ask the user:

> Which setup do you want?
> 1. Create a new mem9 space
> 2. Reconnect an existing mem9 space
>
> If you choose reconnect, paste your existing space ID.

**Branching:**
- If reconnect with existing ID → verify it first (Step 1b), then skip to Step 3.
- If create new → continue to Step 2.

### Step 1b — Verify existing space

First check that the API is reachable, then confirm the space ID is valid:

```bash
curl -sf --max-time 8 "https://api.mem9.ai/healthz" \
  && echo "API_OK" || echo "API_UNREACHABLE"
```

If `API_UNREACHABLE` → network problem; ask user to check connectivity to `api.mem9.ai`.

If `API_OK`, verify the space ID resolves:

```bash
curl -sf --max-time 8 \
  "https://api.mem9.ai/v1alpha1/mem9s/$SPACE_ID/memories?limit=1" \
  && echo "SPACE_OK" || echo "SPACE_INVALID"
```

If `SPACE_OK` → continue to Step 3.
If `SPACE_INVALID` → space ID not found; ask user to re-check or create a new space.

---

## Step 2 — Create a new mem9 space

> Skip if the user provided an existing space ID in Step 1.

```bash
curl -sX POST https://api.mem9.ai/v1alpha1/mem9s
```

Response:
```json
{ "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", "claim_url": "https://..." }
```

Save the `id` as `SPACE_ID`. The `claim_url` is only relevant for self-hosted TiDB Zero setups — ignore it for the managed `api.mem9.ai` service. Tell the user:

> Your new mem9 space is ready. This space ID is how you reconnect to the same memory from any machine.
>
> **Important:** This space ID is also your secret. Never share it with anyone.

---

## Step 3 — Install the plugin and configure

Write the plugin entry into the target `opencode.json` chosen in Step 0. Configure `MEM9_TENANT_ID` in the environment before starting OpenCode.

### Method A: npm plugin (Recommended)

Add `"@mem9/opencode"` to the target `opencode.json`:

```json
{
  "plugin": ["@mem9/opencode"]
}
```

OpenCode will auto-install the plugin from npm on next startup.

Set `MEM9_TENANT_ID` in the shell environment before launching OpenCode:

```bash
export MEM9_TENANT_ID="<space-id>"
```

Do not modify shell RC files directly. Tell the user that `MEM9_TENANT_ID` must be present in the environment used to launch OpenCode.

If the user asks how to persist it, give guidance only. For example:

```bash
# zsh
echo 'export MEM9_TENANT_ID="<space-id>"' >> ~/.zshrc

# bash
echo 'export MEM9_TENANT_ID="<space-id>"' >> ~/.bashrc
```

For project-scoped setup, suggest a tool like `direnv` or a project launch script instead of putting env vars into `opencode.json`.

### Method B: From source

```bash
git clone https://github.com/mem9-ai/mem9.git
cd mem9/opencode-plugin
npm install
```

Then add the local plugin path to the target `opencode.json`:

```json
{
  "plugin": ["file:///absolute/path/to/mem9/opencode-plugin/dist/index.js"]
}
```

Set `MEM9_TENANT_ID` in the shell environment before launching OpenCode:

```bash
export MEM9_TENANT_ID="<space-id>"
```

Do not modify shell RC files directly. Tell the user that `MEM9_TENANT_ID` must be present in the environment used to launch OpenCode. If the user asks how to persist it, provide shell-specific examples as guidance only.

If the plugin has not been built yet, build it first:

```bash
cd mem9/opencode-plugin
npm install
npm run build
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
Your mem9 space is ready.

WHAT YOU CAN DO NEXT

Your agent now has persistent cloud memory. At the start of every chat turn,
recent memories are automatically injected into the system prompt as context.

Memories are NOT saved automatically — you control what gets stored using
the memory tools below.

Available tools:
- memory_store: Save facts, decisions, context
- memory_search: Find memories by keywords and meaning
- memory_get: Retrieve by ID
- memory_update: Modify existing memory
- memory_delete: Remove

YOUR MEM9 SPACE ID

SPACE_ID: <your-space-id>

This ID is your access key to mem9.
Keep it private and store it somewhere safe.

RECOVERY

Set the same MEM9_TENANT_ID in the environment on any machine to reconnect.
Your memory will reconnect instantly.

BACKUP PLAN

Save the space ID in a password manager or secure vault.
```

---

## API Reference

Base: `https://api.mem9.ai`
Header: `X-Mnemo-Agent-Id: <name>` (optional)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/healthz` | Health check |
| POST | `/v1alpha1/mem9s` | Provision tenant |
| POST | `/v1alpha1/mem9s/{tenantID}/memories` | Create memory |
| GET | `/v1alpha1/mem9s/{tenantID}/memories` | Search (`?q=`, `?tags=`, `?source=`, `?limit=`) |
| GET | `/v1alpha1/mem9s/{tenantID}/memories/{id}` | Get by ID |
| PUT | `/v1alpha1/mem9s/{tenantID}/memories/{id}` | Update |
| DELETE | `/v1alpha1/mem9s/{tenantID}/memories/{id}` | Delete |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `No MEM9_TENANT_ID configured` | Set `MEM9_TENANT_ID` in the shell environment before starting OpenCode |
| Plugin not loading | Check `opencode.json` has a valid `"plugin"` entry and restart OpenCode |
| `404` on API call | Verify space ID; run `curl https://api.mem9.ai/healthz` |
| Existing space ID unreachable | Re-check for typos; confirm network access to `api.mem9.ai` |
