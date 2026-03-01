# CLAUDE.md — Agent context for mnemos

## What is this repo?

mnemos is a shared memory service for AI agents. Three components:
- `server/` — Go REST API (chi router, TiDB/MySQL backend)
- `openclaw-plugin/` — TypeScript plugin for OpenClaw agents
- `ccplugin/` — Claude Code plugin (bash hooks + skills)

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
server/internal/config/             — Env var config loading
server/internal/domain/             — Core types (Memory, SpaceToken, AuthInfo), errors, token generation
server/internal/handler/            — HTTP handlers + chi router setup + JSON helpers
server/internal/middleware/         — Auth (Bearer token → context) + rate limiter
server/internal/repository/         — Repository interfaces + TiDB SQL implementations
server/internal/service/            — Business logic: upsert, LWW conflict, validation, bulk
server/schema.sql                   — Database DDL (apply manually to TiDB/MySQL)
```

## Code style

- Go: standard `gofmt`, no ORM, raw `database/sql` with parameterized queries
- Layers: handler → service → repository (interfaces). Domain types imported by all layers.
- Errors: sentinel errors in `domain/errors.go`, mapped to HTTP status codes in `handler/handler.go`
- No globals. Manual DI in `main.go`. All constructors take interfaces.

## Key design decisions

- Upsert uses `INSERT ... ON DUPLICATE KEY UPDATE` (atomic, no race conditions)
- Version increment is atomic in SQL: `SET version = version + 1`
- Tags stored as JSON column, filtered with `JSON_CONTAINS`
- Empty tags stored as `[]` (not NULL) for consistent query behavior
- `POST /api/spaces` has no auth — it's the bootstrap endpoint
