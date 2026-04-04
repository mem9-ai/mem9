---
title: mnemos — Agent context
---

## What this repo is

mnemos is shared, cloud-persistent memory for coding agents. The core system is a Go
REST server backed by TiDB/MySQL, plus three agent integrations, a standalone CLI,
and a small Astro site.

## Cross-repo relationship: `mem9` and `mem9-node`

- `mem9-node` is a sibling repository at `../mem9-node`. It is not a directory inside this repo.
- `dashboard/app` in this repo is the frontend half of the dashboard product. In day-to-day discussion, "the dashboard backend" usually refers to code in `mem9-node`, especially `apps/api` and `apps/worker`.
- `dashboard/app/src/api/analysis-client.ts` calls `mem9-node` endpoints for `v1/analysis-jobs`, `v1/deep-analysis/*`, and taxonomy/deep-analysis workflows.
- `mem9-node/apps/api/src/mem9-source.service.ts` depends on this repo's Go API as the mem9 source of truth. Its `MEM9_SOURCE_API_BASE_URL` defaults to `http://127.0.0.1:8080/v1alpha2/mem9s`.
- `dashboard/app/src/api/provider-http.ts` still sends the dashboard's standard `/your-memory/api/...` data requests to this repo's Go server (`/v1alpha2/mem9s/...`) using `X-API-Key` and `X-Mnemo-Agent-Id`.
- When a task touches dashboard UI and backend behavior together, inspect both repos before assuming the implementation belongs only under `server/` in this repo.

## High-level modules

| Path                 | Role                                                         |
| -------------------- | ------------------------------------------------------------ |
| `server/`            | Go API server, business logic, TiDB SQL, tenant provisioning |
| `cli/`               | Standalone Go CLI for exercising mnemo-server endpoints      |
| `dashboard/app/`     | React dashboard SPA; frontend half of the dashboard product  |
| `openclaw-plugin/`   | OpenClaw memory plugin (`kind: "memory"`)                    |
| `opencode-plugin/`   | OpenCode plugin (`@mem9/opencode`)                           |
| `claude-plugin/`     | Claude Code plugin (hooks + skills)                          |
| `docs/design/`       | Architecture/proposal notes and design drafts                |
| `site/`              | Astro static site — deployed to Netlify from `main` branch   |
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
- Always use `make` targets for building and Docker image operations — never construct raw `go build` or `docker build` commands from scratch. Use `make build-linux` for the server binary and `REGISTRY=<ecr> COMMIT=<tag> make docker` for images.

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
| Dashboard frontend   | `dashboard/app/`                            |
| Dashboard backend (sibling repo) | `../mem9-node/apps/api/`        |
| Dashboard worker (sibling repo) | `../mem9-node/apps/worker/`      |
| Claude hooks         | `claude-plugin/hooks/`                      |
| Architecture notes   | `docs/design/`                              |
| OpenCode wiring      | `opencode-plugin/src/index.ts`              |
| OpenClaw wiring      | `openclaw-plugin/index.ts`                  |
| Site copy/content    | `site/src/content/site.ts`                  |
| Production SKILL.md  | `site/public/SKILL.md`                      |

## site/ — Netlify deployment

`/site/` is the deployment directory for the mem9.ai static website.
It is hosted on Netlify and **automatically deployed from the `main` branch**.

| File | Purpose |
|---|---|
| `site/public/SKILL.md` | **Production** SKILL.md — served at `https://mem9.ai/SKILL.md` |

When updating the SKILL.md that agents fetch, edit **only** these two files:

- `site/public/SKILL.md` — production, changes go live within seconds after merging to `main`

Do **not** edit any other copy (e.g. `clawhub-skill/mem9/SKILL.md` has been removed).
Do **not** manually sync to clawhub — Netlify handles publishing automatically.

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
- `dashboard/app/AGENTS.md`
- `e2e/AGENTS.md`
- `k8s/AGENTS.md`
- `benchmark/MR-NIAH/AGENTS.md`

## GitHub access

Prefer `gh` CLI to read GitHub content (issues, PRs, file contents, comments). Fall back
to `curl` or `webfetch` only when `gh` is unavailable or does not work. Examples:

```bash
# View a PR
gh pr view <number>

# Read a file from a specific ref
gh api repos/{owner}/{repo}/contents/{path}?ref={branch} --jq '.content' | base64 -d

# List issues or PR comments
gh issue view <number> --comments
gh pr view <number> --comments
```

## Explicitly absent

- No `.cursor/rules/`, `.cursorrules`, or `.github/copilot-instructions.md` were found.
- No TypeScript test runner is configured for the plugin packages.
- No repo-wide lint config exists for the TypeScript code.
