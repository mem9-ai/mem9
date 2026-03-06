# OpenCode Plugin for mnemos

Persistent memory for [OpenCode](https://opencode.ai) — injects memories into system prompt automatically, captures session context on idle, with 5 memory tools.

## 🚀 Quick Start (server mode)

```bash
# 1. Set your mnemo-server connection
export MNEMO_API_URL="http://your-server:8080"
export MNEMO_API_TOKEN="mnemo_your_token_here"

# 2. Add plugin to opencode.json
echo '{"plugin": ["mnemo-opencode"]}' > opencode.json

# 3. Start OpenCode - plugin auto-installs from npm
opencode
```

**That's it!** Your agent now has persistent cloud memory.

---

## How It Works

```
System Prompt Transform → Inject recent memories (cached 5min)
          ↓
    Agent works normally, can use memory_* tools anytime
          ↓
Session Idle Event → Auto-capture session marker
```

| Hook / Tool | Trigger | What it does |
|---|---|---|
| `system.transform` | Every chat turn | Injects recent memories into system prompt (5-min TTL cache) |
| `session.idle` event | Session goes idle | Auto-saves a session-end marker as memory |
| `memory_store` tool | Agent decides | Store a new memory (with optional key for upsert) |
| `memory_search` tool | Agent decides | Hybrid vector + keyword search (or keyword-only) |
| `memory_get` tool | Agent decides | Retrieve a single memory by ID |
| `memory_update` tool | Agent decides | Update an existing memory |
| `memory_delete` tool | Agent decides | Delete a memory by ID |

## Prerequisites

- [OpenCode](https://opencode.ai) installed
- A running [mnemo-server](../server/) instance

## Installation

### Method A: npm plugin (Recommended)

The simplest way — OpenCode auto-installs npm plugins at startup.

Add to your `opencode.json`:

```json
{
  "plugin": ["mnemo-opencode"]
}
```

That's it. OpenCode will install `mnemo-opencode` from npm automatically on next startup.

### Method B: From source

```bash
git clone https://github.com/qiffang/mnemos.git
cd mnemos/opencode-plugin
npm install
```

Then register in `opencode.json`:

```json
{
  "plugins": {
    "mnemo": {
      "path": "/absolute/path/to/mnemos/opencode-plugin"
    }
  }
}
```

### Set environment variables

Connect to a self-hosted mnemo-server. Supports multi-agent collaboration with space isolation.

```bash
export MNEMO_API_URL="http://your-server:8080"
export MNEMO_API_TOKEN="mnemo_your_token_here"
```

### Verify

Start OpenCode in your project. You should see this log line:

```
[mnemo] Server mode (mnemo-server REST API)
```

If you see `[mnemo] No mode configured...`, check your env vars.

## Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `MNEMO_API_URL` | Yes | — | mnemo-server base URL |
| `MNEMO_API_TOKEN` | Yes | — | API token for server mode |

## File Structure

```
opencode-plugin/
├── README.md              # This file
├── package.json           # npm package config
├── tsconfig.json          # TypeScript config
└── src/
    ├── index.ts           # Plugin entry point (wiring)
    ├── types.ts           # Config loading, Memory types
    ├── backend.ts         # MemoryBackend interface
    ├── server-backend.ts  # Server mode: mnemo-server REST API
    ├── tools.ts           # 5 memory tools (store/search/get/update/delete)
    └── hooks.ts           # system.transform + session.idle hooks
```

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `No mode configured` | Missing env vars | Set `MNEMO_API_URL` |
| `Server mode requires...` | Missing API token | Set `MNEMO_API_TOKEN` |
| Plugin not loading | Not registered in OpenCode config | Add to `opencode.json` plugins section |
