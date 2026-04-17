# Mnemos — AI Agent Memory, Everywhere

## 1. Problem

AI agents each maintain their own local memory files — siloed, local, forgotten between sessions.

What we want:
- **Individual user**: My agent remembers across sessions, stored in the cloud, zero ops
- **Team**: Multiple agents share a pool of memories through a single API
- Both work with the same plugin — just different config

What we explicitly DON'T want:
- Forcing users to deploy a server before they can start
- Two separate products for "personal" and "team" use cases
- Agents dealing with infrastructure details (connection strings, schemas)

## 2. Two Modes, One Plugin

The core insight: **personal memory and team memory are the same problem at different scales.**

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Agent Plugin (single codebase)                  │
│              OpenClaw / Claude Code / Any HTTP Client                │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
     has `host` →              has `apiUrl` →
     (direct)                  (server)
              │                         │
              ▼                         ▼
   ┌───────────────────┐     ┌───────────────────┐
   │  TiDB Serverless  │     │   mnemo-server    │
   │                   │     │   (Go, self-host)  │
   │  Plugin → DB      │     │   Plugin → API     │
   │  via HTTP Data API│     │   → DB             │
   │                   │     │                    │
   │  Zero deployment  │     │  Multi-agent       │
   │  Personal / small │     │  Space management  │
   │  team use         │     │  LLM conflict merge│
   └───────────────────┘     └────────┬───────────┘
                                      │
                              ┌───────┴───────┐
                              │ TiDB / MySQL  │
                              └───────────────┘
```

| | Direct Mode | Server Mode |
|---|---|---|
| **Who** | Individual developer, small team | Organization, multi-agent teams |
| **Deploy** | Nothing. TiDB Cloud Serverless free tier | Self-host `mnemo-server` (Go binary or Docker) |
| **Config** | Database credentials (`host`/`username`/`password`) | `apiUrl` + `apiKey` (`tenantID` legacy) |
| **Isolation** | Database-level (each DB is a boundary) | Space-level (server manages space_id scoping) |
| **Multi-agent sharing** | Share DB credentials = shared memory | Create space, issue tokens per agent |
| **Vector search** | Yes (TiDB native VECTOR type) | Yes (server-side embedding + vector) |
| **Conflict resolution** | LWW (client-side, simple) | LWW → LLM merge (server-side, Phase 2) |
| **Rate limiting** | TiDB Cloud built-in | Server-side per-IP rate limiter |

**Direct mode is the default.** Mode is inferred from config: `host` present → direct, `apiUrl` present → server.
No explicit `mode` field needed. Most users start with direct. If they outgrow it — need space isolation, LLM merge, centralized audit — they switch one config block and everything keeps working.

## 3. Core Model

### Memory

A memory is a piece of knowledge with optional structure:

```
{
  content: "TiKV compaction: set level0-file-num to 4 for write-heavy...",
  key: "tikv/compaction-tuning",      // optional, for upsert lookup
  tags: ["tikv", "performance"],       // optional, for filtering
  source: "sj-claude-code",           // who wrote it
  metadata: { severity: "high" },      // optional, arbitrary structured data
  embedding: [0.012, -0.034, ...],     // auto-generated if embedding provider configured
  version: 3,                          // auto-managed, for conflict detection
  score: 0.87                          // only in hybrid search responses, omitted otherwise
}
```

### Space (Server Mode only)

A **space** is a shared memory pool. All agents in a space can read/write all memories.

```
Space "backend-team"
  ├── sj-claude-code  (token: mnemo_aaa)
  ├── sj-openclaw     (token: mnemo_bbb)
  └── bob-claude      (token: mnemo_ccc)
  └── Memories: [shared, everyone reads/writes]
```

Want isolation? Different spaces. Want sharing? Same space.

In Direct mode, the **database itself is the space** — no explicit space management needed.

## 4. Quick Start

### 30-Second Setup (Direct Mode)

Create a free TiDB Cloud Serverless cluster at [tidbcloud.com](https://tidbcloud.com), then:

**Claude Code:**
```bash
export MNEMO_DB_HOST="gateway01.us-east-1.prod.aws.tidbcloud.com"
export MNEMO_DB_USER="xxx.root"
export MNEMO_DB_PASS="xxx"
export MNEMO_DB_NAME="mnemos"
# Optional: enable vector search
export MNEMO_EMBED_API_KEY="sk-..."
```

Done. Next time you start Claude Code, it auto-creates the table, loads past memories,
and saves new ones — all transparently.

**OpenClaw:**
```json
{
  "plugins": {
    "slots": { "memory": "mem9" },
    "entries": {
      "mem9": {
        "enabled": true,
        "config": {
          "apiUrl": "http://localhost:8080",
          "apiKey": "uuid"
        }
      }
    }
  }
}
```

### Team Setup (Server Mode)

```bash
# 1. Deploy server
cd server && MNEMO_DSN="user:pass@tcp(host:4000)/mnemos" go run ./cmd/mnemo-server

# 2. Create space
curl -X POST localhost:8080/api/spaces \
  -d '{"name":"backend-team","agent_name":"alice-claude","agent_type":"claude_code"}'
# → {"ok":true, "space_id":"...", "api_token":"mnemo_abc"}

# 3. Configure agents (apiUrl present → server mode)
export MNEMO_API_URL="http://localhost:8080"
export MNEMO_API_TOKEN="mnemo_abc"
```

## 5. Direct Mode: How It Works

### The Key Idea: TiDB Serverless HTTP Data API

TiDB Cloud Serverless exposes an HTTP endpoint for SQL:

```bash
curl -X POST "https://http-${MNEMO_DB_HOST}/v1beta/sql" \
  -u "${MNEMO_DB_USER}:${MNEMO_DB_PASS}" \
  -H "Content-Type: application/json" \
  -d '{"database":"mnemos","query":"SELECT * FROM memories ORDER BY updated_at DESC LIMIT 20"}'
```

This means the Claude Code hooks can **stay pure bash + curl** in Direct mode too.
No `mysql` CLI, no Go binary, no Python package — the same zero-dependency story as Server mode.

For the OpenClaw plugin, `@tidbcloud/serverless` provides a native JS driver over HTTP.

### Auto Schema Init

On first connection, the plugin checks if the `memories` table exists and creates it if not:

```sql
CREATE TABLE IF NOT EXISTS memories (
  id          VARCHAR(36)     PRIMARY KEY,
  space_id    VARCHAR(36)     NOT NULL,     -- in direct mode: a fixed value derived from DB name
  content     TEXT            NOT NULL,
  key_name    VARCHAR(255),
  source      VARCHAR(100),
  tags        JSON,
  metadata    JSON,
  embedding   VECTOR(${dims}) NULL,         -- dims from config (default 1536), nullable
  version     INT             DEFAULT 1,
  updated_by  VARCHAR(100),
  created_at  TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX idx_key    (space_id, key_name),
  INDEX idx_space         (space_id),
  INDEX idx_source        (space_id, source),
  INDEX idx_updated       (space_id, updated_at)
);
```

The `${dims}` value comes from `MNEMO_EMBED_DIMS` (default 1536). Must match the
embedding model's output dimensions (e.g., `text-embedding-3-small` = 1536,
`nomic-embed-text` = 768).

The VECTOR column is nullable — works on all TiDB Serverless clusters. The vector index
is added in a **separate** `ALTER TABLE` that silently fails (try/catch, no error propagation)
when the index already exists or TiFlash is unavailable — keyword-only search as fallback:

```sql
ALTER TABLE memories ADD VECTOR INDEX idx_cosine ((VEC_COSINE_DISTANCE(embedding)));
-- silent failure ok: index exists or TiFlash unavailable
```

### Direct Mode Isolation

In Direct mode, `space_id` is set to a fixed value `"default"`. All queries still include
`WHERE space_id = ?` for schema compatibility with Server mode. This means:

- Same table structure across both modes
- Migrating from Direct → Server is a data export/import (update space_id values)
- Multiple users sharing the same DB credentials = shared memory (the simple version of spaces)

## 6. Architecture

### Direct Mode

```
     Claude Code              OpenClaw              Any Client
  ┌────────────────┐    ┌────────────────┐    ┌────────────────┐
  │ claude-plugin       │    │ openclaw-      │    │ curl / fetch   │
  │ (Hooks+Skills) │    │ plugin         │    │                │
  │                │    │                │    │                │
  │ bash + curl    │    │ @tidbcloud/    │    │ HTTP POST      │
  │ → HTTP Data API│    │ serverless     │    │ → SQL endpoint │
  └───────┬────────┘    └───────┬────────┘    └───────┬────────┘
          │                     │                      │
          └──────────┬──────────┴──────────────────────┘
                     ▼
          ┌─────────────────────┐
          │  TiDB Serverless    │
          │  HTTP Data API      │
          │                     │
          │  POST /v1beta/sql   │
          │  Basic Auth         │
          │  VECTOR + keyword   │
          └─────────────────────┘
```

### Server Mode

```
     Claude Code              OpenClaw              Any Client
  ┌────────────────┐    ┌────────────────┐    ┌────────────────┐
  │ claude-plugin       │    │ openclaw-      │    │ curl / fetch   │
  │ (Hooks+Skills) │    │ plugin         │    │                │
  │                │    │                │    │                │
  │ bash + curl    │    │ HTTP client    │    │ HTTP client    │
  │ → mnemo API    │    │ → mnemo API    │    │ → mnemo API    │
  └───────┬────────┘    └───────┬────────┘    └───────┬────────┘
          │                     │                      │
          └──────────┬──────────┴──────────────────────┘
                     ▼
          ┌─────────────────────┐
          │  mnemo-server (Go)  │
          │                     │
          │  Bearer token auth  │
          │  Space management   │
          │  Upsert + versioning│
          │  Hybrid search      │
          │  Rate limiting      │
          │  LLM merge (Phase 2)│
          └──────────┬──────────┘
                     │
                     ▼
          ┌─────────────────────┐
          │  TiDB / MySQL       │
          └─────────────────────┘
```

## 7. Plugin Design: Backend Abstraction

Both plugins use a **backend abstraction** — the 5 memory tools (store/search/get/update/delete)
call through an interface. The config fields determine which backend (`host` → direct, `apiUrl` → server):

- **Direct backend**: `@tidbcloud/serverless` (OpenClaw) or `curl → TiDB HTTP Data API` (Claude Code) → SQL
- **Server backend**: `fetch` (OpenClaw) or `curl` (Claude Code) → mnemo-server REST API

The tool registration code and hook scripts are mode-agnostic — they call the same
helper functions regardless of which backend is active.

## 8. Search: Keyword + Vector (Hybrid)

### Design Principle: Graceful Degradation

```
                    Embedding provider configured?
                    ┌─────────┴─────────┐
                   Yes                  No
                    │                    │
              Hybrid search        Keyword only
              (vector + keyword)   (LIKE '%q%')
                    │
         ┌─────────┴─────────┐
    Vector results       Keyword results
    (ANN cosine)         (substring match)
         │                    │
         └─────────┬──────────┘
              Merge & rank
              (vector score priority,
               keyword-only gets 0.5)
```

Vector search is **opt-in but zero-effort to enable**:
- No embedding config → keyword search works immediately
- Add an OpenAI key (or Ollama URL) → hybrid search activates automatically
- No schema migration needed — VECTOR column is nullable from day one

### Embedder Abstraction

The embedding provider is wrapped behind a simple interface (`embed(text) → float[]` + `dims`).
A factory returns `null` when unconfigured — every CRUD function accepts the embedder as
nullable, skipping vector operations when absent. No error, no special handling.

Internally uses the OpenAI SDK with `baseURL` override for Ollama/LM Studio/custom endpoints.

### Embedding Provider Configuration

All fields are optional. Omitting everything → keyword-only mode.

```bash
# OpenAI (default: text-embedding-3-small, 1536 dims)
export MNEMO_EMBED_API_KEY="sk-..."

# Ollama (local, free, e.g. nomic-embed-text = 768 dims)
export MNEMO_EMBED_BASE_URL="http://localhost:11434/v1"
export MNEMO_EMBED_MODEL="nomic-embed-text"
export MNEMO_EMBED_DIMS="768"

# Any OpenAI-compatible endpoint
export MNEMO_EMBED_BASE_URL="https://your-embeddings.example.com/v1"
export MNEMO_EMBED_API_KEY="..."
export MNEMO_EMBED_MODEL="text-embedding-3-small"
export MNEMO_EMBED_DIMS="1536"
```

| Field | Default | Notes |
|-------|---------|-------|
| `MNEMO_EMBED_API_KEY` | — | OpenAI key. For local providers (Ollama), omit or set to `"local"` |
| `MNEMO_EMBED_BASE_URL` | OpenAI default | Override for Ollama (`http://localhost:11434/v1`), LM Studio, etc. |
| `MNEMO_EMBED_MODEL` | `text-embedding-3-small` | Model name passed to embeddings API |
| `MNEMO_EMBED_DIMS` | `1536` | Vector dimensions. **Must match model output**. Used in `VECTOR(dims)` DDL |

**Critical implementation detail**: When calling the embedding API, always set
`encoding_format: "float"`. Ollama and LM Studio default to base64 encoding which
is incompatible with TiDB's VECTOR type. The `"float"` format is also accepted by
OpenAI, so this is safe to always set.

### Where Embeddings Are Generated

| Mode | Where |
|------|-------|
| **Direct** | Plugin-side. OpenClaw plugin calls OpenAI/Ollama before INSERT. Claude Code hooks call the embedding API and include the vector in the SQL. |
| **Server** | Server-side. The Go server calls the embedding API on write and on search. Agents don't deal with embeddings at all. |

### When Embeddings Are Generated

| Operation | Embedding behavior |
|-----------|-------------------|
| **Store** | If embedder exists, embed `content` → store in `embedding` column. If no embedder, `embedding = NULL`. |
| **Update** | Re-generate embedding **only if `content` changed** AND embedder exists. If only tags/metadata change, embedding stays as-is. |
| **Search** | If embedder exists and `q` is provided, embed the query → hybrid search. Otherwise keyword-only. |
| **Single failure** | If embedding fails on a single record (API timeout, etc.), the error propagates — the write/search fails. This is intentional: partial embedding corruption is worse than a retry. |

### Hybrid Search Algorithm

When `q` is provided and an embedder is available:

1. **Embed the query**: `queryVec = embedder.embed(q)`

2. **Vector search** (ANN): Fetch `limit × 3` results for merge headroom.
   ```sql
   SELECT *, VEC_COSINE_DISTANCE(embedding, ?) AS distance
   FROM memories
   WHERE space_id = ? AND embedding IS NOT NULL [AND other filters]
   ORDER BY VEC_COSINE_DISTANCE(embedding, ?)
   LIMIT ?
   ```
   **Critical**: `VEC_COSINE_DISTANCE` must appear identically in both SELECT and ORDER BY —
   this is required for TiDB to use the VECTOR INDEX (ANN scan). Different expressions
   cause a full table scan.

   The `embedding IS NOT NULL` filter is mandatory — ANN queries on NULL vectors fail.

3. **Keyword search**: Also fetch `limit × 3` results.
   ```sql
   SELECT * FROM memories
   WHERE space_id = ? AND content LIKE CONCAT('%', ?, '%') [AND other filters]
   ORDER BY updated_at DESC
   LIMIT ?
   ```

4. **Merge & de-duplicate** (by memory ID):
   - Vector results: `score = 1 - distance` (cosine distance → similarity, range 0–1)
   - Keyword-only results (not in vector set): `score = 0.5` (neutral)
   - If a memory appears in both sets, the vector score wins (higher precision)

5. **Sort & paginate**: Sort merged results by score descending, then `slice(offset, offset + limit)`.
   Pagination happens **after** merge, not before — this ensures correct ordering across both result sets.

6. **Response**: Each memory includes an optional `score` field (only present in hybrid search results,
   omitted in keyword-only or non-search responses).

When no embedder is available, steps 1–2 are skipped — pure keyword search, no score field.

## 9. Database Schema

### Unified Schema (both modes)

```sql
CREATE TABLE IF NOT EXISTS memories (
  id          VARCHAR(36)     PRIMARY KEY,
  space_id    VARCHAR(36)     NOT NULL,
  content     TEXT            NOT NULL,
  key_name    VARCHAR(255),
  source      VARCHAR(100),
  tags        JSON,
  metadata    JSON,
  embedding   VECTOR(${dims}) NULL,     -- dims from MNEMO_EMBED_DIMS (default 1536)
  version     INT             DEFAULT 1,
  updated_by  VARCHAR(100),
  created_at  TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX idx_key    (space_id, key_name),
  INDEX idx_space         (space_id),
  INDEX idx_source        (space_id, source),
  INDEX idx_updated       (space_id, updated_at)
);
```

### Server Mode additional table

```sql
CREATE TABLE IF NOT EXISTS space_tokens (
  api_token     VARCHAR(64)   PRIMARY KEY,
  space_id      VARCHAR(36)   NOT NULL,
  space_name    VARCHAR(255)  NOT NULL,
  agent_name    VARCHAR(100)  NOT NULL,
  agent_type    VARCHAR(50),
  created_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_space (space_id)
);
```

### Schema Differences

| Column | Direct Mode | Server Mode |
|--------|------------|-------------|
| `space_id` | Fixed value (derived from DB name) | Server-managed, maps to space |
| `embedding` | Plugin generates (if configured) | Server generates (if configured) |
| `metadata` | Full JSON support | Full JSON support |
| `version` | Auto-incremented on write | Atomic `version = version + 1` in SQL |

The `memories` table is **identical** across modes. This makes Direct → Server migration
a simple data export/import.

## 10. API (Server Mode)

Auth: `Authorization: Bearer <api_token>`
Server resolves token → space_id + agent_name. All queries auto-scoped to space.

### Memory CRUD

#### POST /api/memories — Create

```json
{ "content": "...", "key": "optional/key", "tags": ["optional"], "metadata": {} }
```

`source` is auto-filled from agent_name (derived from token).
If `key` is provided and already exists in the space → upsert (update existing).
If embedding is configured, server generates embedding before write.

#### GET /api/memories — Search / List

```
?q=keyword           Hybrid search (vector + keyword if embedder configured)
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

- No `If-Match` → direct overwrite (LWW)
- `If-Match` matches current version → write, version++
- `If-Match` mismatch → server auto-resolves (MVP: LWW, later: LLM merge)

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

#### GET /api/spaces/:space_id/info — Space metadata

## 11. Agent Integration

### Claude Code Plugin

Uses Claude Code's native Hooks + Skills. Memory capture and recall are fully automatic.

```bash
# Direct mode (DB credentials present → direct)
export MNEMO_DB_HOST="gateway01.us-east-1.prod.aws.tidbcloud.com"
export MNEMO_DB_USER="xxx.root"
export MNEMO_DB_PASS="xxx"
export MNEMO_DB_NAME="mnemos"

# Or server mode (apiUrl present → server)
export MNEMO_API_URL="http://localhost:8080"
export MNEMO_API_TOKEN="mnemo_xxx"
```

| Hook | Async | What it does |
|------|-------|-------------|
| **SessionStart** | no | Load 20 most recent memories → inject as `additionalContext` |
| **UserPromptSubmit** | no | Return hint: `"[mem9] Shared memory available"` |
| **Stop** | yes | Summarize last turn (via haiku), save as new memory |
| **SessionEnd** | no | Cleanup |

Plus **memory-recall** skill (`context: fork`) for on-demand search.

### OpenClaw Plugin

Declares `kind: "memory"`, replacing the built-in memory provider.

In the current server-mode design, OpenClaw prefers `apiUrl + apiKey`. When
`apiKey` is present, requests go to `/v1alpha2/mem9s/...` and send the key in
the `X-API-Key` header. Legacy `tenantID` config remains supported as an alias
for the same value; the plugin still uses `/v1alpha2/mem9s/...` rather than
keeping a separate v1alpha1 codepath.

**Why plugin (kind: "memory") instead of skill?**

| | Plugin (`kind: "memory"`) | Skill |
|---|---|---|
| Trigger | Framework calls automatically | Agent decides when to call |
| Lifecycle | Framework manages load/save timing | Agent must remember to read/write |
| Integration | Replaces built-in `memory_*` tools | Adds extra tools alongside built-in |
| Reliability | Guaranteed execution | Depends on agent judgment |

Memory should be **automatic, not optional**. A `kind: "memory"` plugin replaces OpenClaw's
built-in memory slot — the framework guarantees memory is always read and written at the
right lifecycle points. A skill would require the agent to judge when to store and recall,
making memory unreliable.

This is the same philosophy as the Claude Code side: Hooks (automatic) over MCP tools (manual).

```json
{
  "mem9": {
    "enabled": true,
    "config": {
      "apiUrl": "http://localhost:8080",
      "apiKey": "uuid"
    }
  }
}
```

Tools exposed (same in both modes):
```
memory_store(content, key?, tags?, metadata?)
memory_search(q?, tags?, source?, key?, limit?, offset?)
memory_get(id)
memory_update(id, content?, tags?, metadata?)
memory_delete(id)
```

### Any Agent — Plain HTTP

Works in both modes:

```bash
# Server mode
curl -X POST https://your-server/api/memories \
  -H "Authorization: Bearer mnemo_xxx" \
  -d '{"content": "...", "key": "topic", "tags": ["tag"]}'

# Direct mode (TiDB HTTP Data API)
curl -X POST "https://http-${HOST}/v1beta/sql" \
  -u "${USER}:${PASS}" \
  -d '{"database":"mnemos","query":"INSERT INTO memories ..."}'
```

## 12. Conflict Resolution

### LWW (Last Writer Wins) — Both Modes

The `version` field is tracked on every write. Conflicts result in overwrite.
Simple, predictable, sufficient for most cases.

### LLM Merge — Server Mode, Phase 2

When enabled per space, version conflicts trigger an LLM call:

```
Two agents updated the same memory. Merge into one coherent version.
- Preserve all important information from both
- Remove duplicates
- Keep markdown formatting

Version A (current): {current_content}
Version B (incoming): {new_content}
```

Server handles this transparently. The agent's PUT still returns 200.

## 13. Project Structure

```
mnemos/
├── server/                     # Go API server (server mode backend)
│   ├── cmd/mnemo-server/
│   │   └── main.go
│   ├── internal/
│   │   ├── config/             # Env var loading
│   │   ├── domain/             # Core types, errors, token generation
│   │   ├── handler/            # HTTP handlers + chi router
│   │   ├── middleware/         # Auth + rate limiter
│   │   ├── repository/         # Interface + TiDB implementation
│   │   └── service/            # Business logic (upsert, LWW, search, embedding)
│   ├── schema.sql
│   └── Dockerfile
│
├── openclaw-plugin/            # OpenClaw agent plugin (TypeScript)
│   ├── index.ts                # Tool registration (mode-agnostic)
│   ├── backend.ts              # MemoryBackend interface
│   ├── direct-backend.ts       # Direct mode: @tidbcloud/serverless → SQL
│   ├── server-backend.ts       # Server mode: fetch → mnemo API
│   ├── embedder.ts             # Embedding provider (OpenAI/Ollama/any)
│   ├── schema.ts               # Auto schema init (direct mode)
│   ├── openclaw.plugin.json
│   └── package.json
│
├── claude-plugin/                   # Claude Code plugin (Hooks + Skills)
│   ├── .claude-plugin/
│   │   └── plugin.json
│   ├── hooks/
│   │   ├── hooks.json
│   │   ├── common.sh           # Mode-aware helpers (server: curl→API, direct: curl→SQL)
│   │   ├── session-start.sh
│   │   ├── user-prompt-submit.sh
│   │   ├── stop.sh
│   │   └── session-end.sh
│   └── skills/
│       └── memory-recall/
│           └── SKILL.md
│
├── assets/logo.png
├── docs/DESIGN.md
├── README.md
├── CLAUDE.md
├── CONTRIBUTING.md
├── Makefile
├── LICENSE
└── .gitignore
```

## 14. Scope Boundaries

What this system does:
- Cloud-persistent memory for AI agents (personal or shared)
- Keyword + vector hybrid search with graceful degradation
- Two connectivity modes: direct-to-database and server-mediated
- Automatic memory capture and recall via agent plugins
- Server-side conflict resolution (LWW now, LLM merge later)

What this system does NOT do:
- Local-only memory (each agent handles its own)
- Real-time sync or collaborative editing
- Permission/role management beyond spaces
- Embedding model hosting (uses external APIs)

## 15. Implementation Plan

### Phase 1: Core + Direct Mode

1. ~~Go API server: CRUD + auth + keyword search + upsert~~ ✅
2. ~~OpenClaw plugin (server mode)~~ ✅
3. ~~Claude Code plugin (server mode)~~ ✅
4. **Direct mode for OpenClaw plugin**: `DirectBackend` + `@tidbcloud/serverless` + auto schema init
5. **Direct mode for Claude Code plugin**: `common.sh` mode-aware helpers using TiDB HTTP Data API
6. **Schema evolution**: Add `metadata JSON` and `embedding VECTOR(1536)` columns
7. **Hybrid search**: Embedder abstraction + vector search in both modes

### Phase 2: Smart Features

1. Server-side embedding generation (Go server calls OpenAI/Ollama on write)
2. LLM conflict merge (configurable per space)
3. Auto-tagging via LLM on write

### Phase 3: Polish

1. Web dashboard for space management
2. Bulk import/export
3. Usage analytics
4. `mnemo setup` CLI wizard for one-command onboarding
