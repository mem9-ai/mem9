# OpenCode Plugin for mem9

Persistent memory for [OpenCode](https://opencode.ai) — injects memories into system prompt automatically, with 5 memory tools.

## 🚀 Quick Start

```bash
# 1. Provision a mem9 space
curl -sX POST https://api.mem9.ai/v1alpha1/mem9s | jq .
# → { "id": "uuid" }

# 2. Set your mem9 space ID
export MEM9_TENANT_ID="uuid"

# 3. Add plugin to opencode.json
echo '{"plugin": ["@mem9/opencode"]}' > opencode.json

# 4. Start OpenCode - plugin auto-installs from npm
opencode
```

**That's it!** Your agent now has persistent cloud memory. The plugin defaults to `https://api.mem9.ai` — no API URL config needed.

---

## How It Works

```
System Prompt Transform → Inject recent memories into system prompt
          ↓
    Agent works normally, can use memory_* tools anytime
```

| Hook / Tool | Trigger | What it does |
|---|---|---|
| `system.transform` | Every chat turn | Injects recent memories into system prompt |
| `memory_store` tool | Agent decides | Store a new memory (with optional key for upsert) |
| `memory_search` tool | Agent decides | Hybrid vector + keyword search (or keyword-only) |
| `memory_get` tool | Agent decides | Retrieve a single memory by ID |
| `memory_update` tool | Agent decides | Update an existing memory |
| `memory_delete` tool | Agent decides | Delete a memory by ID |

## Prerequisites

- [OpenCode](https://opencode.ai) installed
- A mem9 space ID (provision one at `https://api.mem9.ai`)

## Installation

### Method A: npm plugin (Recommended)

The simplest way — OpenCode auto-installs npm plugins at startup.

Add to your `opencode.json`:

```json
{
  "plugin": ["@mem9/opencode"]
}
```

That's it. OpenCode will install `@mem9/opencode` from npm automatically on next startup.

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

### Set environment variables

The plugin defaults to `https://api.mem9.ai`. You only need to set your space ID:

```bash
export MEM9_TENANT_ID="uuid"
```

For self-hosted servers, also set:
```bash
export MEM9_API_URL="http://your-server:8080"
```

### Migrating from MNEMO_ env vars

> **Breaking change (v0.1.0):** `MNEMO_API_URL`, `MNEMO_TENANT_ID`, and `MNEMO_API_TOKEN` are no longer supported. Rename to `MEM9_API_URL`, `MEM9_TENANT_ID`, and `MEM9_API_TOKEN`.

### Verify

Start OpenCode in your project. You should see this log line:

```
[mem9] Server mode (mem9 REST API)
```

If you see `[mem9] No MEM9_TENANT_ID configured...`, check your env vars.

## Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `MEM9_TENANT_ID` | Yes | — | Mem9 space ID for URL routing (`/v1alpha1/mem9s/{tenantID}/memories/...`) |
| `MEM9_API_URL` | No | `https://api.mem9.ai` | mem9 API base URL |

## File Structure

```
opencode-plugin/
├── README.md              # This file
├── package.json           # npm package config
├── tsconfig.json          # TypeScript config
├── skills/
│   └── mem9-setup/        # Setup skill (onboarding guide)
│       └── SKILL.md
└── src/
    ├── index.ts           # Plugin entry point (wiring)
    ├── types.ts           # Config loading, Memory types
    ├── backend.ts         # MemoryBackend interface
    ├── server-backend.ts  # Server mode: mem9 REST API client
    ├── tools.ts           # 5 memory tools (store/search/get/update/delete)
    └── hooks.ts           # system.transform hook (memory injection)
```

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `No MEM9_TENANT_ID configured` | Missing env var | Set `MEM9_TENANT_ID` |
| Plugin not loading | Not registered in OpenCode config | Add to `opencode.json` plugins section |
| `404` on API call | Bad space ID | Verify your space ID; run `curl https://api.mem9.ai/healthz` |
