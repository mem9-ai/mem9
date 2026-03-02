# CLAUDE.md — Agent context for mnemos

## What is this repo?

mnemos is cloud-persistent memory for AI agents. Two modes, one plugin:
- **Direct mode**: Plugin → TiDB Serverless (zero deployment)
- **Server mode**: Plugin → mnemo-server (Go) → TiDB/MySQL (multi-agent, space isolation)

Three components:
- `server/` — Go REST API (chi router, TiDB/MySQL, optional embedding)
- `openclaw-plugin/` — TypeScript plugin for OpenClaw (direct + server backends)
- `ccplugin/` — Claude Code plugin (bash hooks + skills, mode-aware)

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
server/internal/middleware/         — Auth (Bearer token → context) + rate limiter
server/internal/repository/         — Repository interfaces + TiDB SQL (vector + keyword search)
server/internal/service/            — Business logic: upsert, LWW, hybrid search, embedding on write
server/schema.sql                   — Database DDL (memories with VECTOR column + space_tokens)

openclaw-plugin/index.ts            — Tool registration (mode-agnostic via MemoryBackend interface)
openclaw-plugin/backend.ts          — MemoryBackend interface (store/search/get/update/remove)
openclaw-plugin/direct-backend.ts   — Direct mode: @tidbcloud/serverless + hybrid search
openclaw-plugin/server-backend.ts   — Server mode: fetch → mnemo API
openclaw-plugin/embedder.ts         — OpenAI-compatible embedding provider
openclaw-plugin/schema.ts           — Auto schema init with VECTOR column
openclaw-plugin/types.ts            — Shared TypeScript types

ccplugin/hooks/common.sh            — Mode detection + helpers (direct: TiDB HTTP API, server: REST)
ccplugin/hooks/session-start.sh     — Load recent memories → additionalContext
ccplugin/hooks/stop.sh              — Summarize with Haiku → save memory
ccplugin/hooks/user-prompt-submit.sh — System hint about available memory
ccplugin/skills/memory-recall/      — Forked skill for on-demand search
```

## Code style

- Go: standard `gofmt`, no ORM, raw `database/sql` with parameterized queries
- TypeScript: ESM modules, interface-based backend abstraction
- Bash hooks: `set -euo pipefail`, Python for JSON parsing (avoid shell injection)
- Layers: handler → service → repository (interfaces). Domain types imported by all layers.
- Errors: sentinel errors in `domain/errors.go`, mapped to HTTP status codes in `handler/handler.go`
- No globals. Manual DI in `main.go`. All constructors take interfaces.

## Key design decisions

- **Two modes, one plugin**: `host` in config → direct, `apiUrl` → server. No explicit mode field.
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
- `POST /api/spaces` has no auth — bootstrap endpoint
- Direct mode uses `space_id = "default"` for schema compatibility with server mode

## Server mode: token bootstrap

Server mode uses a two-token system. The `userToken` in plugin config must be created once
manually via the unauthenticated `POST /api/users` bootstrap endpoint.

```bash
# Step 1: create a user token (no auth required)
curl -s -X POST http://<server>/api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"alice"}' | jq .
# → { "ok": true, "user_id": "...", "api_token": "mnemo_..." }
```

Put the returned `api_token` into the plugin config as `userToken`:

```json
{
  "plugins": {
    "entries": {
      "mnemo": {
        "config": {
          "apiUrl": "http://<server>",
          "userToken": "mnemo_..."
        }
      }
    }
  }
}
```

On first tool call, the plugin automatically calls `POST /api/spaces/provision` (authenticated
with `userToken`) to obtain a workspace-scoped `spaceToken`, which is then used for all memory
operations. The `userToken` is never sent to memory endpoints directly.
