<p align="center">
  <img src="assets/logo.png" alt="mnemos" width="180" />
</p>

<h1 align="center">mnemos</h1>

<p align="center">
  <strong>AI Agent Memory, Everywhere.</strong><br/>
  Personal cloud memory or shared team memory — one plugin, two modes.
</p>

<p align="center">
  <a href="https://goreportcard.com/report/github.com/qiffang/mnemos/server"><img src="https://goreportcard.com/badge/github.com/qiffang/mnemos/server" alt="Go Report Card"></a>
  <a href="https://github.com/qiffang/mnemos/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License"></a>
  <a href="https://github.com/qiffang/mnemos"><img src="https://img.shields.io/github/stars/qiffang/mnemos?style=social" alt="Stars"></a>
</p>

---

> AI agents each maintain their own memory files — siloed, local, forgotten between sessions.
> **mnemos** gives them cloud-persistent memory with hybrid vector + keyword search.
> Start with zero-ops direct mode, scale to a shared server when you need it.

## Two Modes, One Plugin

| | Direct Mode | Server Mode |
|---|---|---|
| **Who** | Individual developer, small team | Organization, multi-agent teams |
| **Deploy** | Nothing. TiDB Cloud Serverless free tier | Self-host `mnemo-server` |
| **Config** | Database credentials | API URL + token |
| **Vector search** | Yes (TiDB native VECTOR) | Yes (server-side) |
| **Conflict resolution** | LWW (client-side) | LWW → LLM merge (Phase 2) |

**Direct mode is the default.** Mode is inferred from config: `host` → direct, `apiUrl` → server.

## Quick Start (Direct Mode — 30 seconds)

Create a free [TiDB Cloud Serverless](https://tidbcloud.com) cluster, then:

**Claude Code:**
```bash
export MNEMO_DB_HOST="gateway01.us-east-1.prod.aws.tidbcloud.com"
export MNEMO_DB_USER="xxx.root"
export MNEMO_DB_PASS="xxx"
export MNEMO_DB_NAME="mnemos"
# Optional: enable vector search
export MNEMO_EMBED_API_KEY="sk-..."
```

Done. Next time you start Claude Code, it auto-creates the table, loads past memories, and saves new ones.

**OpenClaw:**
```json
{
  "plugins": {
    "slots": { "memory": "mnemo" },
    "entries": {
      "mnemo": {
        "enabled": true,
        "config": {
          "host": "gateway01.us-east-1.prod.aws.tidbcloud.com",
          "username": "xxx.root",
          "password": "xxx",
          "database": "mnemos",
          "embedding": {
            "apiKey": "sk-...",
            "model": "text-embedding-3-small"
          }
        }
      }
    }
  }
}
```

## Quick Start (Server Mode — Team Setup)

```bash
# 1. Deploy server
cd server && MNEMO_DSN="user:pass@tcp(host:4000)/mnemos?parseTime=true" go run ./cmd/mnemo-server

# 2. Create space
curl -s -X POST localhost:8080/api/spaces \
  -H "Content-Type: application/json" \
  -d '{"name":"backend-team","agent_name":"alice-claude","agent_type":"claude_code"}'
# → {"ok":true, "space_id":"...", "api_token":"mnemo_abc"}

# 3. Configure agents
export MNEMO_API_URL="http://localhost:8080"
export MNEMO_API_TOKEN="mnemo_abc"
```

## Hybrid Search (Vector + Keyword)

Search auto-upgrades to hybrid mode when an embedding provider is configured:

- **No embedding config** → keyword search works immediately
- **Add an API key** → hybrid search activates automatically
- **No schema migration** — VECTOR column is nullable from day one

Supports OpenAI, Ollama, LM Studio, or any OpenAI-compatible endpoint.

```bash
# OpenAI
export MNEMO_EMBED_API_KEY="sk-..."

# Ollama (local, free)
export MNEMO_EMBED_BASE_URL="http://localhost:11434/v1"
export MNEMO_EMBED_MODEL="nomic-embed-text"
export MNEMO_EMBED_DIMS="768"
```

## Architecture

```
     Claude Code              OpenClaw              Any Client
  ┌────────────────┐    ┌────────────────┐    ┌────────────────┐
  │ ccplugin       │    │ openclaw-      │    │ curl / fetch   │
  │ (Hooks+Skills) │    │ plugin         │    │                │
  └───────┬────────┘    └───────┬────────┘    └───────┬────────┘
          │                     │                      │
          └──────────┬──────────┴──────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
   has `host` →              has `apiUrl` →
   (direct)                  (server)
        │                         │
        ▼                         ▼
 ┌──────────────┐      ┌───────────────────┐
 │ TiDB Cloud   │      │  mnemo-server     │
 │ Serverless   │      │  (Go, self-host)  │
 │ HTTP Data API│      │  → TiDB / MySQL   │
 └──────────────┘      └───────────────────┘
```

## Agent Plugins

### Claude Code Plugin

Automatic memory capture and recall via [Hooks + Skills](https://docs.anthropic.com/en/docs/claude-code/hooks).

| Lifecycle Hook | What happens |
|---------------|-------------|
| **Session Start** | Loads recent memories into Claude's context |
| **User Prompt** | Hint: *"[mnemo] Shared memory is available"* |
| **Stop** | Summarizes session with Haiku, saves as memory |
| **Memory Recall** | Forked skill for on-demand search |

Works in both modes — set `MNEMO_DB_HOST` (direct) or `MNEMO_API_URL` (server).

### OpenClaw Plugin

Replaces OpenClaw's built-in memory with mnemos. Declares `kind: "memory"`.

Tools: `memory_store`, `memory_search`, `memory_get`, `memory_update`, `memory_delete`

Set `host` in config (direct) or `apiUrl` (server).

## API Reference (Server Mode)

Auth: `Authorization: Bearer <token>`. Server resolves token → space + agent.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/memories` | Create/upsert. Server generates embedding if configured. |
| `GET` | `/api/memories` | Search: `?q=`, `?tags=`, `?source=`, `?key=`, `?limit=`, `?offset=` |
| `GET` | `/api/memories/:id` | Get single memory |
| `PUT` | `/api/memories/:id` | Update. Optional `If-Match` for version check. |
| `DELETE` | `/api/memories/:id` | Delete |
| `POST` | `/api/memories/bulk` | Bulk create (max 100) |
| `POST` | `/api/spaces` | Create space + first token (no auth) |
| `POST` | `/api/spaces/:id/tokens` | Add agent to space |
| `GET` | `/api/spaces/:id/info` | Space metadata |

## Self-Hosting (Server Mode)

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MNEMO_DSN` | Yes | — | Database connection string |
| `MNEMO_PORT` | No | `8080` | HTTP listen port |
| `MNEMO_RATE_LIMIT` | No | `100` | Requests/sec per IP |
| `MNEMO_RATE_BURST` | No | `200` | Burst size |
| `MNEMO_EMBED_API_KEY` | No | — | Embedding provider API key |
| `MNEMO_EMBED_BASE_URL` | No | OpenAI | Custom embedding endpoint |
| `MNEMO_EMBED_MODEL` | No | `text-embedding-3-small` | Model name |
| `MNEMO_EMBED_DIMS` | No | `1536` | Vector dimensions |

### Build & Run

```bash
cd server
go build -o mnemo-server ./cmd/mnemo-server
MNEMO_DSN="user:pass@tcp(host:4000)/mnemos?parseTime=true" ./mnemo-server
```

## Project Structure

```
mnemos/
├── server/                     # Go API server (server mode)
│   ├── cmd/mnemo-server/       # Entry point
│   ├── internal/
│   │   ├── config/             # Environment variable loading
│   │   ├── domain/             # Core types, errors, token generation
│   │   ├── embed/              # Embedding provider (OpenAI/Ollama/any)
│   │   ├── handler/            # HTTP handlers + chi router
│   │   ├── middleware/         # Auth + rate limiter
│   │   ├── repository/         # Interface + TiDB SQL implementation
│   │   └── service/            # Business logic (upsert, LWW, hybrid search)
│   ├── schema.sql
│   └── Dockerfile
│
├── openclaw-plugin/            # OpenClaw agent plugin (TypeScript)
│   ├── index.ts                # Tool registration (mode-agnostic)
│   ├── backend.ts              # MemoryBackend interface
│   ├── direct-backend.ts       # Direct: @tidbcloud/serverless → SQL
│   ├── server-backend.ts       # Server: fetch → mnemo API
│   ├── embedder.ts             # Embedding provider abstraction
│   ├── schema.ts               # Auto schema init (direct mode)
│   ├── types.ts                # Shared type definitions
│   └── openclaw.plugin.json    # Plugin manifest (kind: "memory")
│
├── ccplugin/                   # Claude Code plugin (Hooks + Skills)
│   ├── hooks/
│   │   ├── common.sh           # Mode-aware helpers (direct: curl→SQL, server: curl→API)
│   │   ├── session-start.sh
│   │   ├── stop.sh
│   │   └── user-prompt-submit.sh
│   └── skills/memory-recall/   # Forked search skill
│
└── docs/DESIGN.md              # Full design document
```

## Roadmap

| Phase | What | Status |
|-------|------|--------|
| **Phase 1** | Core server + CRUD + auth + hybrid search + upsert + dual-mode plugins | Done |
| **Phase 2** | LLM conflict merge, auto-tagging | Planned |
| **Phase 3** | Web dashboard, bulk import/export, CLI wizard | Planned |

## License

[Apache-2.0](LICENSE)
