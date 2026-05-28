---
title: server — Go API server
---

## Purpose

Go REST API server for mem9. This area owns HTTP routing, services, tenant provisioning, repositories, schemas, metrics, runtime usage quota/metering, and the server binary.

## Commands

```bash
make build
make dev
make vet
make test
make test-integration
cd server && go test -race -count=1 -run TestFunctionName ./internal/service/
```

## Where to look

| Task | File |
|------|------|
| Server entrypoint | `cmd/mnemo-server/main.go` |
| HTTP router and error mapping | `internal/handler/handler.go` |
| Memory business logic | `internal/service/memory.go` |
| Ingest pipeline | `internal/service/ingest.go` |
| Repository interfaces | `internal/repository/repository.go` |
| TiDB repository | `internal/repository/tidb/` |
| Tenant provisioning | `internal/tenant/` |
| Runtime usage quota and outbox | `internal/runtimeusage/` |
| Metering writers | `internal/metering/` |
| Config parsing | `internal/config/config.go` |
| Domain types and errors | `internal/domain/` |
| Database schema | `schema.sql` |

## Local conventions

- Keep the architecture boundary strict: `handler -> service -> repository`.
- Use raw `database/sql`; do not add an ORM.
- Format Go with `gofmt` only.
- Prefer sentinel errors from `internal/domain/errors.go` and compare with `errors.Is()`.
- Wrap errors with `fmt.Errorf("context: %w", err)`.
- Keep route and domain error mapping centralized in `internal/handler/handler.go`.
- Keep runtime usage quota hooks at high-level handler operation boundaries; reserve before tenant work, then release or commit after the operation outcome is known.
- Keep legacy `MNEMO_METERING_*` API metering separate from `MNEMO_RUNTIME_USAGE_*` quota and console metering.
- Use `make` targets for server builds and Docker image work.

## Anti-patterns

- Do NOT build server binaries with ad hoc `go build` commands from the repo root; use `make build` or `make build-linux`.
- Do NOT let handlers reach into SQL repositories directly.
- Do NOT route runtime usage console metering through `MNEMO_METERING_URL`.
- Do NOT write generated embeddings when `MNEMO_EMBED_AUTO_MODEL` is set.
