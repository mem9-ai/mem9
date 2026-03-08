# OpenCode Plugin for mnemos

Persistent memory for [OpenCode](https://opencode.ai) — injects memories into system prompt automatically, with 5 memory tools.

## 🚀 Quick Start (server mode)

```bash
# 1. Provision a tenant
curl -s -X POST http://your-server:8080/v1alpha1/mem9s \
  -H "Content-Type: application/json" \
  -d '{}' \
  | jq .
# → { "id": "uuid", "claim_url": "..." }

# 2. Set your mnemo-server connection
export MNEMO_API_URL="http://your-server:8080"
export MNEMO_TENANT_ID="uuid"

# 3. Install the local plugin loader
git clone https://github.com/qiffang/mnemos.git
cd mnemos
bash opencode-plugin/scripts/setup-opencode-plugin.sh

# 4. Start OpenCode
opencode
```

**That's it!** Your agent now has persistent cloud memory.

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
- A running [mnemo-server](../server/) instance

## Installation

### Method A: Local plugin loader (Recommended)

OpenCode loads JavaScript or TypeScript plugins from `~/.config/opencode/plugins/` automatically at startup.
This repo ships a helper script that installs local dependencies and creates the symlink OpenCode expects.

```bash
git clone https://github.com/qiffang/mnemos.git
cd mnemos
bash opencode-plugin/scripts/setup-opencode-plugin.sh
```

The script creates:

```text
~/.config/opencode/plugins/mnemo.js -> /absolute/path/to/mnemos/opencode-plugin/plugin.js
```

If you prefer to install manually:

```bash
cd mnemos/opencode-plugin
npm install
mkdir -p ~/.config/opencode/plugins
ln -s "$(pwd)/plugin.js" ~/.config/opencode/plugins/mnemo.js
```

### Method B: npm package

When `mnemo-opencode` is published to npm, OpenCode can install it from `opencode.json`:

```json
{
  "plugin": ["mnemo-opencode"]
}
```

At the time of writing, the local symlink method is the working source-based install path in this repo.

### Set environment variables

Connect to a self-hosted mnemo-server. Tenant routing uses the tenant ID in the URL path.
All subsequent API calls go to `/v1alpha1/mem9s/{tenantID}/memories/...` and require no headers.

```bash
export MNEMO_API_URL="http://your-server:8080"
export MNEMO_TENANT_ID="uuid"
```

### Verify

Start OpenCode in your project. You should see this log line:

```
[mnemo] Server mode (mnemo-server REST API)
```

For CLI verification, this also works:

```bash
opencode run --print-logs "List available memory tools briefly."
```

If you see `[mnemo] No mode configured...`, check your env vars.

## Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `MNEMO_API_URL` | Yes | — | mnemo-server base URL |
| `MNEMO_TENANT_ID` | Yes (preferred) | — | Tenant ID for URL routing (`/v1alpha1/mem9s/{tenantID}/memories/...`) |
| `MNEMO_API_TOKEN` | No (legacy fallback) | — | Legacy fallback if tenant ID is not set |

## File Structure

```
opencode-plugin/
├── README.md              # This file
├── plugin.js              # OpenCode local plugin entry point
├── package.json           # npm package config
├── scripts/
│   ├── setup-opencode-plugin.sh      # Installs deps + creates symlink in ~/.config/opencode/plugins
│   └── test-setup-opencode-plugin.sh # Shell test for the setup script
├── tsconfig.json          # TypeScript config
└── src/
    ├── index.ts           # Plugin entry point (wiring)
    ├── types.ts           # Config loading, Memory types
    ├── backend.ts         # MemoryBackend interface
    ├── server-backend.ts  # Server mode: mnemo-server REST API
    ├── tools.ts           # 5 memory tools (store/search/get/update/delete)
    └── hooks.ts           # system.transform hook (memory injection)
```

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `No mode configured` | Missing env vars | Set `MNEMO_API_URL` |
| `Server mode requires...` | Missing tenant ID or legacy token | Set `MNEMO_TENANT_ID` (preferred) or `MNEMO_API_TOKEN` |
| Plugin not loading | Local loader symlink missing | Run `bash opencode-plugin/scripts/setup-opencode-plugin.sh` |
| `failed to install plugin` | `mnemo-opencode` not available from npm | Use the local loader method above |
| Local plugin load error for `@opencode-ai/plugin` | Dependencies missing under `opencode-plugin/` | Run the setup script or `npm install --prefix opencode-plugin` |
