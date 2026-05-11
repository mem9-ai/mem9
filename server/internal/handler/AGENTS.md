---
title: server/internal/handler — HTTP layer
---

## Purpose

HTTP handlers and router wiring for the mem9 API. This area translates requests into service calls and maps domain/service errors back to HTTP responses.

## Commands

```bash
cd server && go test -race -count=1 ./internal/handler/
cd server && go test -race -count=1 -run TestFunctionName ./internal/handler/
```

## Where to look

| Task | File |
|------|------|
| Router, middleware order, response helpers | `handler.go` |
| Memory CRUD endpoints | `memory.go` |
| Recall endpoint | `recall.go` |
| Tenant endpoints | `tenant.go` |
| Import task endpoints | `task.go` |
| Metering admin endpoints | `metering.go` |

## Local conventions

- Keep handlers thin: parse/validate request shape, resolve services, call service methods, and respond.
- Add or change routes in `handler.go`.
- Keep HTTP/domain error mapping in `handler.go`.
- Read `X-Mnemo-Agent-Id` through the existing request helpers instead of duplicating header parsing.
- Use `respond()` and existing error helpers for JSON responses.

## Anti-patterns

- Do NOT put business reconciliation, embedding, or SQL logic in handlers.
- Do NOT add one-off JSON response writers.
- Do NOT bypass the tenant/API-key middleware when adding tenant-scoped routes.
