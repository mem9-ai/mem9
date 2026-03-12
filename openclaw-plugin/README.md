# OpenClaw Plugin for mnemos

Memory plugin for [OpenClaw](https://github.com/openclaw) — replaces the built-in memory slot with cloud-persistent shared memory. Runs in server mode only, connecting to `mnemo-server` via `apiUrl` + `tenantID`.

## 🚀 Quick Start (Server Mode)

**You need a running `mnemo-server` instance.**

```bash
# 1. Start the server
cd mnemos/server
MNEMO_DSN="user:pass@tcp(host:4000)/mnemos?parseTime=true" go run ./cmd/mnemo-server

# 2. Provision a tenant
curl -s -X POST http://localhost:8080/v1alpha1/mem9s \
  -H "Content-Type: application/json" \
  -d '{"name":"openclaw-tenant"}'

# Response:
# {"id": "uuid", "claim_url": "..."}
```

Add mnemo to your project's `openclaw.json`:

```json
{
  "plugins": {
    "slots": { "memory": "openclaw" },
    "entries": {
      "openclaw": {
        "enabled": true,
        "config": {
          "apiUrl": "http://localhost:8080",
          "tenantID": "uuid"
        }
      }
    }
  }
}
```

**That's it!** Restart OpenClaw and your agent now has persistent cloud memory.

All memory calls use `/v1alpha1/mem9s/{tenantID}/memories/...` — the tenant ID is carried in the URL path, and no special headers are required.

---

## How It Works

```
OpenClaw loads plugin as kind: "memory"
     ↓
Plugin replaces built-in memory slot → framework manages lifecycle
     ↓
5 tools registered: store / search / get / update / delete
     ↓
4 lifecycle hooks: auto-recall, auto-capture, compact/reset awareness
```

This is a `kind: "memory"` plugin — OpenClaw's framework manages when to load/save memories. The plugin provides 5 tools **plus** 4 lifecycle hooks for automatic memory management:

### Lifecycle Hooks (Automatic)

| Hook | Trigger | What it does |
|---|---|---|
| `before_prompt_build` | Every LLM call | Searches memories by current prompt, injects relevant ones as context (3-min TTL cache) |
| `after_compaction` | After `/compact` | Invalidates cache so the next prompt gets fresh memories from the database |
| `before_reset` | Before `/reset` | Saves a session summary (last 3 user messages) as memory before context is wiped |
| `agent_end` | Agent finishes | Auto-captures the last assistant response as memory (if substantial) |

### Tools (Agent-Invoked)

| Tool | Description |
|---|---|
| `memory_store` | Store a new memory (upsert by key) |
| `memory_search` | Hybrid vector + keyword search (or keyword-only) |
| `memory_get` | Retrieve a single memory by ID |
| `memory_update` | Update an existing memory |
| `memory_delete` | Delete a memory by ID |

**Key improvement**: After `/compact` or `/reset`, the agent no longer "forgets" — lifecycle hooks ensure memories are automatically re-injected into the LLM context on the very next prompt.

## Prerequisites

- [OpenClaw](https://github.com/openclaw) installed (`>=2026.1.26`)
- A running [mnemo-server](../server/) instance

## Installation

### Method A: npm install (Recommended)

```bash
openclaw plugins install @mem9/openclaw
```

### Method B: From source

```bash
git clone https://github.com/mem9-ai/mem9.git
cd mem9/openclaw-plugin
npm install
```

### Configure OpenClaw

Add mnemo to your project's `openclaw.json`:

OpenClaw is often deployed across teams with multiple agents. Server mode gives you:

- **Space isolation** — each team/project gets its own memory pool, no cross-contamination
- **Per-agent identity** — every OpenClaw instance can pass its own `X-Mnemo-Agent-Id` header
- **Centralized management** — one mnemo-server manages all memory, with rate limiting and access controls
- **LLM conflict merge (Phase 2)** — when two agents write to the same key, the server can merge intelligently

**Step 1: Deploy mnemo-server**

```bash
cd mnemos/server
MNEMO_DSN="user:pass@tcp(tidb-host:4000)/mnemos?parseTime=true" go run ./cmd/mnemo-server
```

**Step 2: Provision a tenant**

```bash
curl -s -X POST http://localhost:8080/v1alpha1/mem9s \
  -H "Content-Type: application/json" \
  -d '{"name":"openclaw-tenant"}'

# Response:
# {"id": "uuid", "claim_url": "..."}
```

**Step 3: Configure each OpenClaw instance**

Each agent uses the same `tenantID` for the shared memory pool. The tenant ID is part of the URL path for all memory calls.

```json
{
  "plugins": {
    "slots": {
      "memory": "openclaw"
    },
    "entries": {
      "openclaw": {
        "enabled": true,
        "config": {
          "apiUrl": "http://your-server:8080",
          "tenantID": "uuid"
        }
      }
    }
  }
}
```

That's it. The server handles scoping and conflict resolution. Conceptually, the only required values are `apiUrl` + `tenantID`.

### Verify

Start OpenClaw. You should see:

```
[mnemo] Server mode
```

If you see `[mnemo] No mode configured...`, check your `openclaw.json` config.

## Config Schema

Defined in `openclaw.plugin.json`:

| Field | Type | Description |
|---|---|---|
| `apiUrl` | string | mnemo-server URL |
| `tenantID` | string | Tenant ID used in `/v1alpha1/mem9s/{tenantID}/memories` (preferred) |
| `apiToken` | string | Legacy alias for `tenantID` — kept for backward compatibility |
| `userToken` | string | Legacy alias for `tenantID` — kept for backward compatibility |

> **Note**: `tenantID` is the preferred config field. For legacy setups, the plugin checks `tenantID` first, then falls back to `apiToken`, then `userToken`.

## File Structure

```
openclaw-plugin/
├── README.md              # This file
├── openclaw.plugin.json   # Plugin metadata + config schema
├── package.json           # npm package (@mem9/openclaw)
├── index.ts               # Plugin entry point + tool registration
├── backend.ts             # MemoryBackend interface
├── server-backend.ts      # Server mode: fetch → mnemo API
├── hooks.ts               # Lifecycle hooks (auto-recall, auto-capture, compact/reset)
└── types.ts               # Shared types (PluginConfig, Memory, etc.)
```

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `No mode configured` | Missing config | Add `apiUrl` and `tenantID` (or legacy `apiToken`/`userToken`) to plugin config |
| `Server mode requires...` | Missing tenant ID | Add `tenantID` (or legacy `apiToken`/`userToken`) to config |
| Plugin not loading | Not in memory slot | Set `"slots": {"memory": "openclaw"}` in openclaw.json |
