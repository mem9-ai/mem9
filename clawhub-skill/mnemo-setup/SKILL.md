---
name: mem9-setup
version: 1.0.0
description: |
  Install mem9 plugin for OpenClaw. Gives your agent persistent cloud memory via mnemo-server REST API.
  Use when: "install mem9", "setup memory plugin", "configure openclaw memory", "mem9 onboarding", 
  "add persistent memory", "connect to mnemo-server", "upload memories", "upload sessions".
author: qiffang
keywords: [mem9, mnemo, openclaw, memory, plugin, install, setup, onboarding, persistent-memory]
metadata:
  openclaw:
    emoji: "⚡"
---

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   ███╗   ███╗███████╗███╗   ███╗ █████╗                         │
│   ████╗ ████║██╔════╝████╗ ████║██╔══██╗                        │
│   ██╔████╔██║█████╗  ██╔████╔██║╚██████║                        │
│   ██║╚██╔╝██║██╔══╝  ██║╚██╔╝██║ ╚═══██║                        │
│   ██║ ╚═╝ ██║███████╗██║ ╚═╝ ██║ █████╔╝                        │
│   ╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝ ╚════╝                         │
│                                                                 │
│   persistent memory for ai agents                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

# mem9-setup

Stateless plugin → mnemo-server REST API → TiDB/MySQL.
Your agent forgets nothing.

---

## Endpoints

```
POST   /v1alpha1/mem9s                              → provision tenant (returns id)
POST   /v1alpha1/mem9s/{tenantID}/memories          → create memory
GET    /v1alpha1/mem9s/{tenantID}/memories          → search (?q=, ?tags=, ?limit=)
GET    /v1alpha1/mem9s/{tenantID}/memories/{id}     → get by id
PUT    /v1alpha1/mem9s/{tenantID}/memories/{id}     → update
DELETE /v1alpha1/mem9s/{tenantID}/memories/{id}     → delete
POST   /v1alpha1/mem9s/{tenantID}/imports           → upload file (multipart)
GET    /v1alpha1/mem9s/{tenantID}/imports           → list upload tasks
GET    /v1alpha1/mem9s/{tenantID}/imports/{id}      → task status
```

Header: `X-Mnemo-Agent-Id: <agent-name>` (optional, for multi-agent)

---

## Onboarding

### Step 1 — Provision tenant

```bash
curl -sX POST https://api.mem9.ai/v1alpha1/mem9s | jq .
```

Output:
```json
{"id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", "claim_url": "..."}
```

Save the `id`. This is your `tenantID`.

### Step 2 — Install plugin

```bash
npm install mem9-openclaw
```

### Step 3 — Configure openclaw.json

```json
{
  "plugins": {
    "slots": { "memory": "mnemo" },
    "entries": {
      "mnemo": {
        "enabled": true,
        "config": {
          "apiUrl": "https://api.mem9.ai",
          "tenantID": "<your-tenant-id>"
        }
      }
    }
  }
}
```

### Step 4 — Upload existing data (optional)

If you have existing memory/session files from previous OpenClaw runs:

```bash
# Find openclaw.json
OPENCLAW_JSON="./openclaw.json"

# Get configured agents
AGENTS=$(jq -r '.agents | keys[]' "$OPENCLAW_JSON")

# For each agent, upload memory and session files
for AGENT in $AGENTS; do
  WORKSPACE=$(jq -r ".agents[\"$AGENT\"].workspace // \"./\"" "$OPENCLAW_JSON")
  
  # Upload memory.json if exists
  [ -f "$WORKSPACE/memory.json" ] && \
curl -sX POST "https://api.mem9.ai/v1alpha1/mem9s/$TENANT_ID/imports" \
      -F "file=@$WORKSPACE/memory.json" \
      -F "agent_id=$AGENT" \
      -F "file_type=memory"
  
  # Upload session files
  for SESSION in "$WORKSPACE"/sessions/*.json; do
    [ -f "$SESSION" ] && \
curl -sX POST "https://api.mem9.ai/v1alpha1/mem9s/$TENANT_ID/imports" \
        -F "file=@$SESSION" \
        -F "agent_id=$AGENT" \
        -F "session_id=$(basename "$SESSION" .json)" \
        -F "file_type=session"
  done
done
```

### Step 5 — Restart OpenClaw

```bash
# Verify
openclaw --version
```

Look for:
```
[mnemo] Server mode
```

---

## What You Get

| Capability | Description |
|------------|-------------|
| `memory_store` | Persist facts, decisions, context |
| `memory_search` | Hybrid vector + keyword search |
| `memory_get` | Retrieve by ID |
| `memory_update` | Modify existing memory |
| `memory_delete` | Remove memory |

Lifecycle hooks (automatic):
- `before_prompt_build` — injects relevant memories
- `before_reset` — saves session summary
- `agent_end` — captures last response

---

## Examples

**Store a memory:**
```bash
curl -sX POST "https://api.mem9.ai/v1alpha1/mem9s/$TENANT_ID/memories" \
  -H "Content-Type: application/json" \
  -H "X-Mnemo-Agent-Id: my-agent" \
  -d '{"content": "Project uses PostgreSQL 15", "tags": ["tech-stack"]}'
```

**Search memories:**
```bash
curl -s "https://api.mem9.ai/v1alpha1/mem9s/$TENANT_ID/memories?q=database&limit=5"
```

**Check upload task:**
```bash
curl -s "https://api.mem9.ai/v1alpha1/mem9s/$TENANT_ID/imports/$TASK_ID"
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `[mnemo] No mode configured` | Check `openclaw.json` has `apiUrl` + `tenantID` |
| `Plugin not loading` | Verify `slots.memory = "mnemo"` |
| `401 / 404` | Confirm tenantID is correct |
| Upload stuck | `GET /imports` to check status |

---

## Next Steps

After setup:

1. **Verify** — Ask your agent: "Remember the codebase uses React 18"
2. **New session** — Start fresh
3. **Test recall** — Ask: "What frontend framework?"
4. **Print capabilities** — `memory_search`, `memory_store`, `memory_get`, `memory_update`, `memory_delete`

---

## Update Mechanism

Add to your cron or heartbeat (e.g., daily 12:00):

```bash
# Pull latest skill
curl -s https://raw.githubusercontent.com/qiffang/mnemos/main/clawhub-skill/mnemo-setup/SKILL.md \
  -o ~/.openclaw/skills/mem9-setup/SKILL.md

# Or via clawhub
clawhub skill update mem9-setup
```

---

## Links

- **GitHub**: [github.com/qiffang/mnemos](https://github.com/qiffang/mnemos)
- **Server**: [mnemo-server](https://github.com/qiffang/mnemos/tree/main/server)
- **API Docs**: [CLAUDE.md](https://github.com/qiffang/mnemos/blob/main/CLAUDE.md)

---

```
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
░  stateless agents. cloud memory. zero amnesia.                ░
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
```
