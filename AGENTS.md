---
title: mnemos — Agent context
---

## What this repo is

mnemos is shared, cloud-persistent memory for coding agents. The core system is a Go
REST server backed by TiDB/MySQL, plus three agent integrations, a standalone CLI,
and a small Astro site.

## High-level modules

| Path                 | Role                                                         |
| -------------------- | ------------------------------------------------------------ |
| `server/`            | Go API server, business logic, TiDB SQL, tenant provisioning |
| `cli/`               | Standalone Go CLI for exercising mnemo-server endpoints      |
| `openclaw-plugin/`   | OpenClaw memory plugin (`kind: "memory"`)                    |
| `opencode-plugin/`   | OpenCode plugin (`@mem9/opencode`)                           |
| `claude-plugin/`     | Claude Code plugin (hooks + skills)                          |
| `site/`              | Astro marketing/docs site                                    |
| `e2e/`               | Live end-to-end scripts against a running server             |
| `k8s/`               | Deployment and gateway manifests                             |
| `benchmark/MR-NIAH/` | Benchmark harness for OpenClaw memory evaluation             |

## Commands

```bash
# Go server build / verify
make build
make vet
make test
make test-integration

# Single Go test
cd server && go test -race -count=1 -run TestFunctionName ./internal/service/

# TypeScript verification
cd openclaw-plugin && npm run typecheck
cd opencode-plugin && npm run typecheck

# Site dev/build
cd site && npm run dev
cd site && npm run build

# CLI build
cd cli && go build -o mnemo .

# Run server locally
cd server && MNEMO_DSN="user:pass@tcp(host:4000)/db?parseTime=true" go run ./cmd/mnemo-server
```

## Global conventions

- Architecture is strict `handler -> service -> repository`; plugins always call the HTTP API.
- No ORM. Server SQL is raw `database/sql` with parameter placeholders only.
- `embed.New()` and `llm.New()` may return `nil`; callers must branch correctly.
- Vector and keyword search each fetch `limit * 3` before RRF merge.
- `INSERT ... ON DUPLICATE KEY UPDATE` is the expected upsert pattern.
- Atomic version bump happens in SQL: `SET version = version + 1`.
- `X-Mnemo-Agent-Id` is the per-agent identity header for memory requests.

## Go style

- Format with `gofmt` only.
- Imports use three groups: stdlib, external, internal.
- Use `PascalCase` for exported names, `camelCase` for unexported names.
- Acronyms stay all-caps inside identifiers: `tenantID`, `agentID`.
- Sentinel errors live in `server/internal/domain/errors.go`; compare with `errors.Is()`.
- Wrap errors with `fmt.Errorf("context: %w", err)`.
- Validation errors use `&domain.ValidationError{Field: ..., Message: ...}`.
- HTTP/domain error mapping stays centralized in `server/internal/handler/handler.go`.

## TypeScript style

- ESM only: `"type": "module"`, `module: "NodeNext"` or local package equivalent.
- Always use `.js` on local imports when the package uses NodeNext.
- Use `import type` for type-only imports.
- Formatting is consistent: double quotes, semicolons, trailing commas in multi-line literals.
- Public methods use explicit return types.
- Nullable is `T | null`; optional is `field?: T`.
- No `any`.
- Tool/error strings use `err instanceof Error ? err.message : String(err)`.

## Bash and hooks

- Hook scripts start with `set -euo pipefail`.
- Use Python for JSON/url-encoding helpers instead of `jq` in hook logic.
- `curl` calls use explicit timeouts.

## SQL / storage rules

- Tags are JSON arrays; store `[]`, never `NULL`.
- Filter tags with `JSON_CONTAINS`.
- Every vector search must include `embedding IS NOT NULL`.
- `VEC_COSINE_DISTANCE(...)` must match in `SELECT` and `ORDER BY` byte-for-byte.
- When `autoModel != ""`, do not write the `embedding` column; it is generated.
- `MNEMO_EMBED_AUTO_MODEL` and `MNEMO_EMBED_API_KEY` represent different embedding modes.

## Where to look

| Task                 | File                                        |
| -------------------- | ------------------------------------------- |
| Add/change route     | `server/internal/handler/handler.go`        |
| Memory CRUD / search | `server/internal/service/memory.go`         |
| Ingest pipeline      | `server/internal/service/ingest.go`         |
| TiDB SQL             | `server/internal/repository/tidb/memory.go` |
| Tenant provisioning  | `server/internal/service/tenant.go`         |
| CLI command wiring   | `cli/main.go`                               |
| Claude hooks         | `claude-plugin/hooks/`                      |
| OpenCode wiring      | `opencode-plugin/src/index.ts`              |
| OpenClaw wiring      | `openclaw-plugin/index.ts`                  |
| Site copy/content    | `site/src/content/site.ts`                  |

## Hierarchical AGENTS.md files

Use the local file when you work in these areas:

- `server/AGENTS.md`
- `server/internal/handler/AGENTS.md`
- `server/internal/service/AGENTS.md`
- `server/internal/repository/tidb/AGENTS.md`
- `server/internal/tenant/AGENTS.md`
- `cli/AGENTS.md`
- `openclaw-plugin/AGENTS.md`
- `opencode-plugin/AGENTS.md`
- `claude-plugin/AGENTS.md`
- `site/AGENTS.md`
- `e2e/AGENTS.md`
- `k8s/AGENTS.md`
- `benchmark/MR-NIAH/AGENTS.md`

## Explicitly absent

- No `.cursor/rules/`, `.cursorrules`, or `.github/copilot-instructions.md` were found.
- No TypeScript test runner is configured for the plugin packages.
- No repo-wide lint config exists for the TypeScript code.
