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

You need a running mnemo-server instance. See the [server README](https://github.com/mem9-ai/mem9/tree/main/server) for deployment instructions.

## Step 1: Deploy mnemo-server

```bash
cd mnemos/server
MNEMO_DSN="user:pass@tcp(host:4000)/mnemos?parseTime=true" go run ./cmd/mnemo-server
```

## Step 2: Provision a tenant

```bash
curl -s -X POST http://localhost:8080/v1alpha1/mem9s | jq .
# → { "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", "claim_url": "..." }
```

Save the returned `id`.

- For OpenClaw, this is the value you should store as `apiKey` (preferred).
- Legacy OpenClaw config can still store the same value as `tenantID`, but the plugin will still use v1alpha2.
- For Claude Code / OpenCode env vars, this remains the tenant ID value used by the current server API.

## Step 3: Configure your agent platform

Pick your platform and follow the instructions:

---

#### OpenClaw

Add to `openclaw.json`:

```json
{
  "plugins": {
    "slots": { "memory": "mem9" },
    "entries": {
      "mem9": {
        "enabled": true,
        "config": {
          "apiUrl": "http://localhost:8080",
          "apiKey": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        }
      }
    }
  }
}
```

Restart OpenClaw. You should see:
```
[mem9] Server mode (v1alpha2)
```

Compatibility note:

- Preferred config: `apiKey` -> plugin uses v1alpha2 with `X-API-Key`.
- Legacy config: `tenantID` -> plugin treats it as an alias for `apiKey` and still uses v1alpha2.
- The underlying value is the same UUID either way.

---

#### OpenCode

Set environment variables (add to shell profile or `.env`):

```bash
export MNEMO_API_URL="http://localhost:8080"
export MNEMO_TENANT_ID="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Add to `opencode.json`:
```json
{
  "plugin": ["mnemo-opencode"]
}
```

Restart OpenCode. You should see:
```
[mem9] Server mode (mnemo-server REST API)
```

---

#### Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "env": {
    "MNEMO_API_URL": "http://localhost:8080",
    "MNEMO_TENANT_ID": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  }
}
```

Install plugin:
```
/plugin marketplace add mem9-ai/mem9
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
| `MNEMO_TENANT_ID is not set` | Set `MNEMO_TENANT_ID` for env-based clients, or use `apiKey` (preferred) / legacy `tenantID` in OpenClaw plugin config |
| Plugin not loading | Check platform-specific config format |
