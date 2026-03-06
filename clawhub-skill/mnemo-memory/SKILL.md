---
name: mnemo-memory
version: 0.3.0
description: "Cloud-persistent memory for AI agents. Stateless plugins + mnemo-server = cross-session recall, multi-agent sharing, and hybrid vector + keyword search. Works with OpenClaw, Claude Code, and OpenCode."
author: qiffang
keywords: [memory, agent-memory, persistent-memory, tidb, vector-search, hybrid-search, cloud-memory, multi-agent, cross-session, openclaw, claude-code, opencode, stateless, ai-agent, developer-tools]
metadata:
  openclaw:
    emoji: "\U0001F9E0"
---

# mnemo — Cloud-Persistent Memory for AI Agents 🧠

**Your agents are stateless. Your memory shouldn't be.**

Every AI agent session starts from zero. Context is lost, decisions are forgotten, and your agents keep rediscovering what they already knew. mnemo externalizes agent memory into a central server — so agents stay disposable, but memory persists forever.

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Claude Code  │     │  OpenCode   │     │  OpenClaw   │
│   Plugin     │     │   Plugin    │     │   Plugin    │
└──────┬───────┘     └──────┬──────┘     └──────┬──────┘
       │                    │                    │
       └────────────────────┼────────────────────┘
                            │
                    ┌───────┴────────┐
                    │  mnemo-server  │  ← Go REST API
                    └───────┬────────┘
                            │
                    ┌───────┴────────┐
                    │   TiDB / MySQL │  ← your database
                    │                │
                    │  • VECTOR type │
                    │  • Hybrid      │
                    │    search      │
                    └────────────────┘
```

## What Problem Does This Solve?

| Pain Point | Without mnemo | With mnemo |
|---|---|---|
| **Session amnesia** | Agent forgets everything on restart | Memory persists in the cloud |
| **Machine-locked** | Memory in local files, lost on device switch | Same memory from any machine |
| **Agent silos** | Claude can't see what OpenCode learned | All agents share one memory pool |
| **Team isolation** | Teammate's agent starts from scratch | Shared spaces with per-agent tokens |
| **No semantic search** | Grep through flat files | Hybrid vector + keyword search |

## Hybrid Search: Vector + Keyword

The server supports hybrid search when an embedding provider is configured:
- **Vector search** — Semantic similarity via cosine distance
- **Keyword search** — Full-text search with fallback to LIKE
- **RRF merge** — Results from both legs are merged and ranked

No embedding config? Keyword search works immediately. Add vectors later — no migration needed.

## Install for OpenClaw

```bash
npm install mnemo-openclaw
```

Add to `openclaw.json`:

```json
{
  "plugins": {
    "slots": { "memory": "mnemo" },
    "entries": {
      "mnemo": {
        "enabled": true,
        "config": {
          "apiUrl": "http://your-server:8080",
          "userToken": "mnemo_your_token"
        }
      }
    }
  }
}
```

## Also Works With

| Platform | Install |
|---|---|
| **Claude Code** | `/plugin marketplace add qiffang/mnemos` → `/plugin install mnemo-memory@mnemos` |
| **OpenCode** | `"plugin": ["mnemo-opencode"]` in `opencode.json` |
| **Any HTTP client** | REST API via mnemo-server |

## 5 Memory Tools

| Tool | What it does |
|---|---|
| `memory_store` | Store a memory |
| `memory_search` | Hybrid vector + keyword search across all memories |
| `memory_get` | Retrieve a single memory by ID |
| `memory_update` | Update an existing memory |
| `memory_delete` | Delete a memory |

## Links

- **GitHub**: [github.com/qiffang/mnemos](https://github.com/qiffang/mnemos)
- **Design Doc**: [docs/DESIGN.md](https://github.com/qiffang/mnemos/blob/main/docs/DESIGN.md)
- **TiDB Cloud**: [tidbcloud.com](https://tidbcloud.com) (free tier)

---

*Built for agents that need to remember. Powered by [mnemo-server](https://github.com/qiffang/mnemos/tree/main/server).*
