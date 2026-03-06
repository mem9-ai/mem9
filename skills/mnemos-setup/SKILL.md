---
name: mnemos-setup
description: |
  Setup mnemos persistent memory with mnemo-server.
  Triggers: "set up mnemos", "install mnemo plugin", "configure memory plugin",
  "configure openclaw memory", "configure opencode memory",
  "configure claude code memory".
---

# mnemos Setup

**Persistent memory for AI agents.** This skill helps you set up mnemos with any agent platform.

## Prerequisites

You need a running mnemo-server instance. See the [server README](https://github.com/qiffang/mnemos/tree/main/server) for deployment instructions.

## Step 1: Deploy mnemo-server

```bash
cd mnemos/server
MNEMO_DSN="user:pass@tcp(host:4000)/mnemos?parseTime=true" go run ./cmd/mnemo-server
```

## Step 2: Register a tenant and get credentials

```bash
curl -s -X POST http://localhost:8080/api/tenants/register \
  -H "Content-Type: application/json" \
  -d '{"name":"my-tenant","agent_name":"agent-1","agent_type":"openclaw"}' | jq .
# → {"ok":true, "tenant_id":"...", "token":"mnemo_abc123", ...}
```

Save the returned `token` — you'll need it for plugin config.

## Step 3: Configure your agent platform

Pick your platform and follow the instructions:

---

#### OpenClaw

Add to `openclaw.json`:

```json
{
  "plugins": {
    "slots": { "memory": "mnemo" },
    "entries": {
      "mnemo": {
        "enabled": true,
        "config": {
          "apiUrl": "http://localhost:8080",
          "userToken": "mnemo_abc123"
        }
      }
    }
  }
}
```

Restart OpenClaw. You should see:
```
[mnemo] Server mode (workspace isolation)
```

---

#### OpenCode

Set environment variables (add to shell profile or `.env`):

```bash
export MNEMO_API_URL="http://localhost:8080"
export MNEMO_API_TOKEN="mnemo_abc123"
```

Add to `opencode.json`:
```json
{
  "plugin": ["mnemo-opencode"]
}
```

Restart OpenCode. You should see:
```
[mnemo] Server mode (mnemo-server REST API)
```

---

#### Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "env": {
    "MNEMO_API_URL": "http://localhost:8080",
    "MNEMO_API_TOKEN": "mnemo_abc123"
  }
}
```

Install plugin:
```
/plugin marketplace add qiffang/mnemos
/plugin install mnemo-memory@mnemos
```

Restart Claude Code.

---

## Verification

After setup, test memory:

1. Ask your agent: "Remember that the project uses PostgreSQL 15"
2. Start a new session
3. Ask: "What database does this project use?"

The agent should recall the information from memory.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `No MNEMO_API_URL configured` | Set `MNEMO_API_URL` env var or `apiUrl` in plugin config |
| `Server mode requires MNEMO_API_TOKEN` | Set `MNEMO_API_TOKEN` env var or `userToken` in plugin config |
| Plugin not loading | Check platform-specific config format |
