# CLAUDE.md — Agent context for mnemos

## What is this repo?

mnemos is cloud-persistent memory for AI agents. Plugins connect to mnemo-server (Go) for multi-agent, tenant-isolated memory with hybrid vector + keyword search.

Three components:
- `server/` — Go REST API (chi router, TiDB/MySQL, optional embedding)
- `openclaw-plugin/` — Agent plugin for OpenClaw (server backend)
- `claude-plugin/` — Claude Code plugin (bash hooks + skills)

## Commands

```bash
# Build server
cd server && go build ./cmd/mnemo-server

# Run server (requires MNEMO_DSN)
cd server && MNEMO_DSN="user:pass@tcp(host:4000)/mnemos?parseTime=true" go run ./cmd/mnemo-server

# Vet / lint
cd server && go vet ./...

# Run all checks
make build && make vet
```

## Project layout

```
server/cmd/mnemo-server/main.go     — Entry point, DI wiring, graceful shutdown
server/internal/config/             — Env var config loading (DB + embedding)
server/internal/domain/             — Core types (Memory with Metadata/Embedding/Score), errors
server/internal/embed/              — Embedding provider (OpenAI-compatible HTTP client)
server/internal/handler/            — HTTP handlers + chi router setup + JSON helpers
server/internal/middleware/         — Tenant resolution (tenantID → DB) + rate limiter
server/internal/repository/         — Repository interfaces + TiDB SQL (vector + keyword search)
server/internal/service/            — Business logic: upsert, LWW, hybrid search, embedding on write
server/schema.sql                   — Database DDL (control plane + tenant data plane)

openclaw-plugin/index.ts            — Tool registration via MemoryBackend interface
openclaw-plugin/backend.ts          — MemoryBackend interface (store/search/get/update/remove)
openclaw-plugin/server-backend.ts   — Server mode: fetch → mnemo API
openclaw-plugin/hooks.ts            — Lifecycle hooks (auto-recall, auto-capture, compact/reset)
openclaw-plugin/types.ts            — Shared TypeScript types

claude-plugin/hooks/common.sh            — Server helpers (REST API calls)
claude-plugin/hooks/session-start.sh     — Load recent memories → additionalContext
claude-plugin/hooks/stop.sh              — Save last response as memory
claude-plugin/hooks/user-prompt-submit.sh — System hint about available memory
claude-plugin/skills/memory-recall/      — On-demand search skill
claude-plugin/skills/memory-store/       — On-demand save skill
```

## Code style

- Go: standard `gofmt`, no ORM, raw `database/sql` with parameterized queries
- TypeScript: ESM modules, interface-based backend abstraction
- Bash hooks: `set -euo pipefail`, Python for JSON parsing (avoid shell injection)
- Layers: handler → service → repository (interfaces). Domain types imported by all layers.
- Errors: sentinel errors in `domain/errors.go`, mapped to HTTP status codes in `handler/handler.go`
- No globals. Manual DI in `main.go`. All constructors take interfaces.

## Key design decisions

- **Server-only architecture**: All plugins connect to mnemo-server via REST API. No direct DB access from plugins.
- **Plugin over skill**: Memory uses `kind: "memory"` plugin (automatic) not skill (agent-dependent)
- **Hooks over MCP tools**: Claude Code memory is via lifecycle hooks (guaranteed) not tools (optional)
- **Hybrid search**: Vector + keyword with graceful degradation. No embedder → keyword only.
- **Embedder nullable**: `embed.New()` returns nil when unconfigured. All code accepts nil embedder.
- **encoding_format: "float"**: Always set when calling embedding API (Ollama defaults to base64)
- **VEC_COSINE_DISTANCE**: Must appear identically in SELECT and ORDER BY for TiDB VECTOR INDEX
- **embedding IS NOT NULL**: Mandatory in vector search WHERE clause
- **3x fetch limit**: Both vector and keyword search fetch limit×3, merge after
- **Score**: `1 - distance` for vector results, `0.5` for keyword-only
- Upsert uses `INSERT ... ON DUPLICATE KEY UPDATE` (atomic, no race conditions)
- Version increment is atomic in SQL: `SET version = version + 1`
- Tags stored as JSON column, filtered with `JSON_CONTAINS`; empty tags stored as `[]` (not NULL)
- **No auth required**: Tenant ID in URL path is the only identification. No Bearer tokens, no API keys.

## Tenant provisioning

Provision a new tenant via the unauthenticated bootstrap endpoint:

```bash
curl -s -X POST http://<server>/v1alpha1/mem9s | jq .
# → { "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", "claim_url": "..." }
```

Save the returned `id` — this is the tenant ID used in all subsequent API calls.

All memory operations use tenant-scoped routes:
```
POST   /v1alpha1/mem9s/{tenantID}/memories          — Create
GET    /v1alpha1/mem9s/{tenantID}/memories           — Search/list
GET    /v1alpha1/mem9s/{tenantID}/memories/{id}      — Get by ID
PUT    /v1alpha1/mem9s/{tenantID}/memories/{id}      — Update
DELETE /v1alpha1/mem9s/{tenantID}/memories/{id}      — Delete
```

Agent identity is passed via the `X-Mnemo-Agent-Id` header.

## Installing the Claude Code plugin

If a user asks to install or set up the claude-plugin, read `claude-plugin/README.md` for the full guide.

**Marketplace install (recommended):**

1. In Claude Code: `/plugin marketplace add qiffang/mnemos`
2. Then: `/plugin install mnemo-memory@mnemos`
3. Accept the hook permissions when prompted
4. Add server credentials to `~/.claude/settings.json` under `env`:
   - Set `MNEMO_API_URL` and `MNEMO_TENANT_ID`
5. Restart Claude Code

**Manual install (alternative):**

1. `chmod +x claude-plugin/hooks/*.sh`
2. Copy skills: `cp -r claude-plugin/skills/memory-{recall,store} ~/.claude/skills/`
3. Add `env` + `hooks` entries to `~/.claude/settings.json` (see `claude-plugin/README.md` for full config)

## Installing the OpenCode plugin

If a user asks to install mnemo for OpenCode, read `opencode-plugin/README.md` for the full guide.

**npm plugin (recommended):**

1. Add to `opencode.json`: `{"plugin": ["mnemo-opencode"]}`
2. Set env vars: `MNEMO_API_URL` and `MNEMO_TENANT_ID`
3. Restart OpenCode — plugin auto-installs from npm and logs `[mnemo] Server mode...`

**From source (alternative):**

1. `cd opencode-plugin && npm install`
2. Add to `opencode.json`: `{"plugins": {"mnemo": {"path": "/absolute/path/to/mnemos/opencode-plugin"}}}`
3. Set env vars (same as above)

## Installing the OpenClaw plugin

If a user asks to install mnemo for OpenClaw, read `openclaw-plugin/README.md` for the full guide. Quick summary:

1. `cd openclaw-plugin && npm install`
2. Add to `openclaw.json`:
   - Set `plugins.slots.memory` to `"mnemo"`
   - Add `plugins.entries.mnemo` with `enabled: true` and config
   - Set `apiUrl` and `tenantID` in config
3. Plugin is `kind: "memory"` — OpenClaw framework manages the lifecycle automatically
