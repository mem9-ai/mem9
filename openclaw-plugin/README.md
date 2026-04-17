# OpenClaw Plugin for mem9

Memory plugin for [OpenClaw](https://github.com/openclaw) — replaces the built-in memory slot with cloud-persistent shared memory. Runs in server mode only, connecting to `mnemo-server` via `apiUrl` + `apiKey` (preferred) or legacy `tenantID`. Optional `provisionToken` and `provisionQueryParams` are used only during first-time create-new setup before an explicit `apiKey` is configured.

When `apiKey` is absent during create-new onboarding, the plugin does not auto-provision on startup. Instead, the first post-restart user message triggers exactly one create-new provision through the normal hook path. The plugin coordinates that call across concurrent OpenClaw plugin registrations on the same machine and reuses the generated key locally for future restarts tied to the same `provisionToken`.

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
# {"id": "uuid"}
```

Add mem9 to your project's `openclaw.json`:

```json
{
  "plugins": {
    "slots": { "memory": "mem9" },
    "entries": {
      "mem9": {
        "enabled": true,
        "config": {
          "apiUrl": "http://localhost:8080",
          "apiKey": "uuid",
          "searchTimeoutMs": 15000
        }
      }
    }
  }
}
```

**That's it!** Restart OpenClaw and your agent now has persistent cloud memory.

The plugin always uses `/v1alpha2/mem9s/memories/...` with `X-API-Key: <key>`. Legacy `tenantID` config is still supported as an alias for `apiKey`.

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
| `before_prompt_build` | Every LLM call | Searches memories by current prompt and injects relevant ones as context |
| `after_compaction` | After `/compact` | Logs compaction so the next prompt re-queries memories from the server |
| `before_reset` | Before `/reset` | Saves a session summary (last 3 user messages) as memory before context is wiped |
| `agent_end` | Agent finishes | Auto-captures the last assistant response as memory (if substantial) |

### Tools (Agent-Invoked)

| Tool | Description |
|---|---|
| `memory_store` | Store a new memory |
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
openclaw plugins install @mem9/mem9
```

### Method B: From source

```bash
git clone https://github.com/mem9-ai/mem9.git
cd mem9/openclaw-plugin
npm install
```

### Configure OpenClaw

Add mem9 to your project's `openclaw.json`:

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
# {"id": "uuid"}
```

**Step 3: Configure each OpenClaw instance**

Each agent uses the same `apiKey` for the shared memory pool. The plugin sends that value in `X-API-Key` and never places it in the URL path. Legacy `tenantID` config still works as an alias for the same value.

```json
{
  "plugins": {
    "slots": {
      "memory": "mem9"
    },
    "entries": {
      "mem9": {
        "enabled": true,
        "config": {
          "apiUrl": "http://your-server:8080",
          "apiKey": "uuid"
        }
      }
    }
  }
}
```

That's it. The server handles scoping and conflict resolution. Conceptually, the only required values are `apiUrl` + `apiKey`.

### Verify

Start OpenClaw. You should see:

```text
[mem9] Server mode (v1alpha2)
```

If you see `[mem9] No mode configured...`, check your `openclaw.json` config.

## Config Schema

Defined in `openclaw.plugin.json`:

| Field | Type | Description |
|---|---|---|
| `apiUrl` | string | mnemo-server URL |
| `apiKey` | string | Preferred key. Uses `/v1alpha2/mem9s/...` with `X-API-Key` header |
| `provisionToken` | string | Optional one-time create-new token used locally to ensure the first-message create-new provision runs only once and is reused on this machine until an explicit `apiKey` is configured |
| `provisionQueryParams` | object | Optional `utm_*` map forwarded only to the initial `POST /v1alpha1/mem9s` request made during create-new when `apiKey` is absent |
| `defaultTimeoutMs` | number | Default timeout for non-search mem9 API requests in milliseconds. Default: `8000` |
| `searchTimeoutMs` | number | Timeout for `memory_search` and automatic recall search in milliseconds. Default: `15000` |
| `debug` | boolean | When `true`, emit mem9 debug logs. Current coverage includes `before_prompt_build` recall diagnostics; future mem9 debug categories reuse the same switch |
| `debugRecall` | boolean | Deprecated alias for `debug` |
| `tenantID` | string | Legacy alias for `apiKey`. The plugin still uses `/v1alpha2/mem9s/...` with `X-API-Key`. |

> **Note**: `apiKey` takes precedence when both fields are set. If only `tenantID` is present, the plugin treats it as a legacy alias for `apiKey`, still uses v1alpha2, and logs a deprecation warning once at startup. `provisionToken` and `provisionQueryParams` are ignored after an `apiKey` is already configured, and non-`utm_*` keys are dropped before the provision request is sent. During create-new onboarding, the plugin shares one in-flight provision result across concurrent local registrations and reuses the persisted result for the same `provisionToken`, so repeated reloads or repeated setup retries do not create multiple keys. The only valid secret path is `plugins.entries.mem9.config.apiKey`; `plugins.entries.mem9.apiKey` at the entry top level is invalid on OpenClaw and prevents the gateway from loading.

For debugging, set `"debug": true` in the plugin config. The plugin will emit `[mem9][debug]` lines; current coverage shows how `before_prompt_build` stripped OpenClaw metadata wrappers before issuing the recall search. `"debugRecall": true` still works as a deprecated alias.

## Timeout Behavior

The plugin uses two timeout buckets:

- `searchTimeoutMs` applies to `memory_search` and the automatic recall search in `before_prompt_build`
- `defaultTimeoutMs` applies to all other mem9 HTTP requests, including register, store, get, update, delete, and ingest

Example:

```json
{
  "plugins": {
    "entries": {
      "openclaw": {
        "enabled": true,
        "config": {
          "apiUrl": "http://your-server:8080",
          "apiKey": "uuid",
          "defaultTimeoutMs": 8000,
          "searchTimeoutMs": 15000
        }
      }
    }
  }
}
```

## File Structure

```
openclaw-plugin/
├── README.md              # This file
├── openclaw.plugin.json   # Plugin metadata + config schema
├── package.json           # npm package (@mem9/mem9)
├── index.ts               # Plugin entry point + tool registration
├── backend.ts             # MemoryBackend interface
├── server-backend.ts      # Server mode: fetch → mnemo API
├── hooks.ts               # Lifecycle hooks (auto-recall, auto-capture, compact/reset)
└── types.ts               # Shared types (PluginConfig, Memory, etc.)
```

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `No mode configured` | Missing config | Add `apiUrl` and `apiKey` (or legacy `tenantID`) to plugin config |
| `Server mode requires...` | Missing key | Add `apiKey` (or legacy `tenantID`) to config |
| `config reload skipped (invalid config): plugins.entries.mem9: Unrecognized key: "apiKey"` | Setup wrote `plugins.entries.mem9.apiKey` instead of `plugins.entries.mem9.config.apiKey` | Remove the invalid top-level key and keep the secret only under `config.apiKey` |
| Multiple auto-provisioned keys appear during create-new | Setup retriggered create-new provisioning before the first result was reused, or an older plugin still auto-provisions on startup | Upgrade to `@mem9/mem9@0.4.7+`; newer builds provision only from the first post-restart user message and reuse one local result across duplicate setup retries |
| Search requests time out | Hybrid/vector search exceeds plugin timeout | Increase `searchTimeoutMs` in plugin config |
| Plugin not loading | Not in memory slot | Set `"slots": {"memory": "mem9"}` in openclaw.json |
