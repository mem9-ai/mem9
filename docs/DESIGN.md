# Mnemo — Multi-Agent Shared Memory Service

## 1. Problem

AI agents (Claude Code, OpenClaw, etc.) each maintain their own local memory files.
These memories are siloed — they can't be shared across agents, machines, or people.

What we want:
- Multiple agents share a pool of long-term memories via a simple API
- An agent configures one token + URL, and it just works
- When two agents update the same memory, the server resolves it automatically

What we explicitly DON'T want:
- Complex permission/role systems
- Client-side conflict resolution
- Agents making scope/routing decisions at call time

## 2. Core Model

### Space

A **space** is a shared memory pool. All agents in a space can read/write all memories.
That's the only sharing concept. No orgs, teams, roles, or hierarchies.

```
Space "backend-team"
  ├── sj-claude-code  (token: mnemo_aaa)
  ├── sj-openclaw     (token: mnemo_bbb)
  └── bob-claude      (token: mnemo_ccc)
  └── Memories: [shared, everyone reads/writes]
```

Want isolation? Different spaces. Want sharing? Same space.

### Memory

A memory is a piece of knowledge with optional structure:

```
{
  content: "TiKV compaction: set level0-file-num to 4 for write-heavy...",
  key: "tikv/compaction-tuning",      // optional, for upsert lookup
  tags: ["tikv", "performance"],       // optional, for filtering
  source: "sj-openclaw",              // auto-filled from token
  version: 3                           // auto-managed, for conflict detection
}
```

## 3. Project Structure

Three deliverables:

| Component | What | Form |
|-----------|------|------|
| **mnemo-server** | API service + database | Go binary, deployed as container or single binary |
| **@mnemo/openclaw-plugin** | OpenClaw agent integration | npm package, `kind: "memory"` plugin |
| **mnemo-ccplugin** | Claude Code agent integration | Claude Code Plugin (Hooks + Skills) |

The two client packages are thin wrappers over the API. Core logic lives in the server.

```
mnemos/
├── server/                     # Go API server
│   ├── cmd/mnemo-server/
│   │   └── main.go             # Entry point, DI wiring, graceful shutdown
│   ├── internal/
│   │   ├── config/config.go    # Environment variable loading
│   │   ├── domain/
│   │   │   ├── types.go        # Core types (Memory, SpaceToken, AuthInfo, etc.)
│   │   │   ├── errors.go       # Sentinel errors (ErrNotFound, ErrConflict, etc.)
│   │   │   └── tokengen.go     # Token generation (mnemo_ + 32 hex)
│   │   ├── handler/
│   │   │   ├── handler.go      # Router setup, JSON helpers, error mapping
│   │   │   ├── memory.go       # CRUD + search + upsert + bulk
│   │   │   └── space.go        # Space creation + token management
│   │   ├── middleware/
│   │   │   ├── auth.go         # Token → space_id + agent_name via context
│   │   │   └── ratelimit.go    # Per-IP token bucket rate limiter
│   │   ├── repository/
│   │   │   ├── repository.go   # MemoryRepo + SpaceTokenRepo interfaces
│   │   │   └── tidb/
│   │   │       ├── tidb.go     # *sql.DB setup (pool config, ping)
│   │   │       ├── memory.go   # MemoryRepo SQL implementation
│   │   │       └── space_token.go  # SpaceTokenRepo SQL implementation
│   │   └── service/
│   │       ├── memory.go       # Business logic (upsert, LWW, validation, bulk)
│   │       └── space.go        # Space creation, token generation, space info
│   ├── schema.sql              # Database DDL
│   ├── Dockerfile              # Multi-stage build
│   ├── go.mod
│   └── go.sum
│
├── openclaw-plugin/            # OpenClaw plugin (kind: "memory")
│   ├── index.ts                # Register memory_store/search/get/update/delete
│   ├── api-client.ts           # HTTP client for mnemo server
│   ├── openclaw.plugin.json
│   └── package.json
│
├── ccplugin/                   # Claude Code Plugin (Hooks + Skills)
│   ├── .claude-plugin/
│   │   └── plugin.json         # Plugin manifest
│   ├── hooks/
│   │   ├── hooks.json          # Hook definitions (4 lifecycle hooks)
│   │   ├── common.sh           # Shared: env, API client helpers (curl → mnemo API)
│   │   ├── session-start.sh    # Load recent memories → additionalContext
│   │   ├── user-prompt-submit.sh  # Hint: "[mnemo] Memory available"
│   │   ├── stop.sh             # Summarize last turn → POST /api/memories
│   │   └── session-end.sh      # Cleanup
│   └── skills/
│       └── memory-recall/
│           └── SKILL.md        # Semantic recall skill (context: fork)
│
├── assets/logo.png             # Project logo
├── docs/DESIGN.md              # Full design document
├── README.md
├── CLAUDE.md                   # Agent-readable project context
├── CONTRIBUTING.md
├── Makefile
├── LICENSE                     # Apache-2.0
└── .gitignore
```

### Why Go

- **Single binary deployment** — no runtime, no node_modules. Build once, run anywhere (container or bare metal).
- **Goroutines** — natural fit for IO-bound workload (DB queries, LLM API calls in Phase 2).
- **go-sql-driver/mysql** — mature, battle-tested MySQL driver, works directly with TiDB.
- **Long-term extensibility** — when adding vector search or LLM merge, Go can call any REST API; no Python SDK dependency needed.

### Architecture

```
        Claude Code              OpenClaw             Any Agent
   ┌──────────────────┐   ┌──────────────────┐   ┌──────────────┐
   │ mnemo-ccplugin   │   │ @mnemo/          │   │ HTTP Client  │
   │ (Hooks + Skills) │   │ openclaw-plugin  │   │              │
   │                  │   │ (kind: "memory") │   │              │
   │ SessionStart:    │   │                  │   │              │
   │  load memories   │   │                  │   │              │
   │ Stop:            │   │                  │   │              │
   │  save memories   │   │                  │   │              │
   │ Skill:           │   │                  │   │              │
   │  recall memories │   │                  │   │              │
   └───────┬──────────┘   └────────┬─────────┘   └──────┬───────┘
           │                       │                     │
           ▼                       ▼                     ▼
   ┌──────────────────────────────────────────────────────────────┐
   │                   mnemo-server (Go)                          │
   │                                                              │
   │  Auth: Bearer token → space_id + agent_name                 │
   │  Conflict: server-side auto-resolve (lww → llm merge)       │
   │  Search: keyword (MVP), vector + keyword (later)            │
   └──────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
   ┌──────────────────────────────────────────────────────────────┐
   │                    TiDB Cloud                                │
   │    Row-level isolation via space_id                          │
   └──────────────────────────────────────────────────────────────┘
```

## 4. Database Schema

```sql
CREATE TABLE space_tokens (
  api_token     VARCHAR(64)   PRIMARY KEY,
  space_id      VARCHAR(36)   NOT NULL,
  space_name    VARCHAR(255)  NOT NULL,
  agent_name    VARCHAR(100)  NOT NULL,
  agent_type    VARCHAR(50),
  created_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_space (space_id)
);

CREATE TABLE memories (
  id          VARCHAR(36)   PRIMARY KEY,
  space_id    VARCHAR(36)   NOT NULL,
  content     TEXT          NOT NULL,
  key_name    VARCHAR(255),
  source      VARCHAR(100),
  tags        JSON,
  version     INT           DEFAULT 1,
  updated_by  VARCHAR(100),
  created_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_space     (space_id),
  INDEX idx_key       (space_id, key_name),
  INDEX idx_source    (space_id, source),
  INDEX idx_updated   (space_id, updated_at)
);
```

Two tables. `space_tokens` maps tokens to spaces and identifies agents.
A space exists implicitly — no separate spaces table needed.

## 5. API

Auth: `Authorization: Bearer <api_token>`
Server resolves token → space_id + agent_name. All queries auto-scoped to space.

### Memory CRUD

#### POST /api/memories — Create

```json
{ "content": "...", "key": "optional/key", "tags": ["optional"] }
```

`source` is auto-filled from agent_name (derived from token).
If `key` is provided and already exists in the space → upsert (update existing).

#### GET /api/memories — Search / List

```
?q=keyword           Content search
&tags=tag1,tag2      Filter by tags (AND)
&source=sj-openclaw  Filter by author
&key=tikv/tuning     Filter by key
&limit=50&offset=0
```

#### GET /api/memories/:id

#### PUT /api/memories/:id — Update

```
Header: If-Match: 3   (optional)
Body: { "content": "updated", "tags": [...] }
```

- No `If-Match` → direct overwrite (lww)
- `If-Match` matches current version → write, version++
- `If-Match` mismatch → server auto-resolves (MVP: lww, later: llm merge)

Response always includes `version` for client to track.

#### DELETE /api/memories/:id

#### POST /api/memories/bulk

```json
{ "memories": [{ "content": "...", "key": "...", "tags": [...] }, ...] }
```

### Space Management

#### POST /api/spaces — Create space + first agent token

```json
{
  "name": "backend-team",
  "agent_name": "sj-openclaw",
  "agent_type": "openclaw"
}
→ { "ok": true, "space_id": "uuid", "api_token": "mnemo_xxx" }
```

#### POST /api/spaces/:space_id/tokens — Add agent to space

```json
{
  "agent_name": "sj-claude-code",
  "agent_type": "claude_code"
}
→ { "ok": true, "api_token": "mnemo_yyy" }
```

Requires a valid token for this space in the Authorization header.

#### GET /api/spaces/:space_id/info

Returns space name, memory count, agent list.

## 6. Agent Integration

### OpenClaw

Install and configure:

```bash
# 1. Install plugin
openclaw plugins install @mnemo/openclaw-plugin
```

```json
// 2. openclaw.json
{
  "plugins": {
    "slots": { "memory": "mnemo" },
    "entries": {
      "mnemo": {
        "enabled": true,
        "config": {
          "apiUrl": "https://your-server.example.com",
          "apiToken": "mnemo_xxx"
        }
      }
    }
  }
}
```

That's it. The plugin declares `kind: "memory"`, replacing the built-in
memory-core. All memory operations go to the remote mnemo server.

Tools exposed to agent:
```
memory_store(content, key?, tags?)     → POST /api/memories
memory_search(q?, tags?, source?)      → GET /api/memories
memory_get(id)                         → GET /api/memories/:id
memory_update(id, content?, tags?)     → PUT /api/memories/:id
memory_delete(id)                      → DELETE /api/memories/:id
```

### Claude Code — Plugin (Hooks + Skills)

Inspired by [memsearch](https://github.com/zilliztech/memsearch)'s Claude Code Plugin.
Uses Claude Code's native Hooks and Skills system — no MCP server needed.
Memory capture and recall are fully automatic.

```bash
# Install
/plugin marketplace add mashenjun/mnemo   # or local: claude --plugin-dir ./ccplugin
```

Configure via environment variables:
```bash
export MNEMO_API_URL="https://your-server.example.com"
export MNEMO_API_TOKEN="mnemo_xxx"
```

#### How It Works

The plugin hooks into 4 Claude Code lifecycle events:

| Hook | Async | What it does |
|------|-------|-------------|
| **SessionStart** | no | `GET /api/memories?limit=20` → inject recent memories as `additionalContext` |
| **UserPromptSubmit** | no | Return `systemMessage: "[mnemo] Memory available"` as hint to Claude |
| **Stop** | yes | Summarize last turn (via `claude -p --model haiku`), then `POST /api/memories` to save |
| **SessionEnd** | no | Cleanup |

Plus a **memory-recall skill** (`context: fork`):

```markdown
---
name: memory-recall
description: "Search shared memories from past sessions. Use when the user's
  question could benefit from historical context, past decisions, or project knowledge."
context: fork
allowed-tools: Bash
---

You are a memory retrieval agent. Search shared memories and return relevant context.

## Steps
1. Search: curl GET $MNEMO_API_URL/api/memories?q=<query>&limit=10
2. Evaluate: skip irrelevant results
3. Return a curated summary of relevant memories to the main conversation
```

When Claude judges the user's question needs historical context, it auto-invokes
this skill. The skill runs in a **forked subagent** — intermediate search results
stay isolated, only the curated summary enters the main context.

#### Why Hooks + Skills instead of MCP

| Aspect | MCP Server | Hooks + Skills |
|--------|-----------|---------------|
| Memory capture | Manual — Claude must decide to call `memory_store` | Automatic — Stop hook summarizes and saves every session |
| Session start context | None — Claude must call `memory_search` first | Automatic — SessionStart injects recent memories |
| Recall trigger | Claude must decide to call MCP tool | Automatic — Claude sees "[mnemo] Memory available" hint, invokes skill when needed |
| Context cost | MCP tool definitions permanently in context | Skill runs in fork, zero main context cost |
| Dependencies | Node.js MCP server process | Shell scripts + curl (zero dependencies) |

### Any Agent — HTTP

```bash
curl -X POST https://your-server.example.com/api/memories \
  -H "Authorization: Bearer mnemo_xxx" \
  -d '{"content": "...", "key": "topic", "tags": ["tag"]}'
```

## 7. Conflict Resolution

### MVP: Last Writer Wins (lww)

The `version` field is tracked on every write. Conflicts result in overwrite.
Simple, predictable, sufficient for early usage.

### Later: LLM Merge

When enabled per space, version conflicts trigger an LLM call:

```
Two agents updated the same memory. Merge into one coherent version.
- Preserve all important information from both
- Remove duplicates
- Keep markdown formatting

Version A (current in DB):
{current_content}

Version B (incoming):
{new_content}
```

Server handles this transparently. Agent's PUT still returns 200.
The `version` field and `If-Match` support from day one ensure this
can be added without any API changes.

## 8. Scope Boundaries

What this system does:
- Shared long-term memory across agents via REST API
- Keyword search (MVP), vector search (later)
- Server-side conflict resolution
- Simple token-based auth

What this system does NOT do:
- Local/private memory (each agent handles its own)
- Real-time sync or collaboration
- Permission/role management
- Embedding generation on client side

## 9. Implementation Plan

### Phase 1: Core

1. Database schema (2 tables) — TiDB Cloud
2. Go API server: space management + memory CRUD + auth + keyword search + upsert
3. OpenClaw plugin (kind: "memory", TypeScript, calls API)
4. Claude Code plugin (Hooks + Skills, bash + curl, calls API)

### Phase 2: Smart Features

1. LLM conflict merge — Go server calls LLM REST API (configurable per space)
2. Server-side embedding generation + vector search
3. Hybrid search (vector + keyword)

### Phase 3: Polish

1. Web dashboard for space management
2. Bulk import/export
3. Usage stats
