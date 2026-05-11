---
title: server/internal/service — Business logic
---

## Purpose

Business logic for memory CRUD/search, recall, ingest reconciliation, sessions, uploads, and tenant orchestration. Services sit between handlers and repository interfaces.

## Commands

```bash
cd server && go test -race -count=1 ./internal/service/
cd server && go test -race -count=1 -run TestFunctionName ./internal/service/
```

## Where to look

| Task | File |
|------|------|
| Memory CRUD and search | `memory.go` |
| Ingest reconciliation | `ingest.go` |
| Recall candidate assembly | `recall.go` |
| Session search helpers | `session.go` |
| Source-turn search | `search_source_turns.go` |
| Tenant service | `tenant.go` |
| Upload service | `upload.go` |

## Local conventions

- Services depend on repository interfaces from `internal/repository`.
- Validate user inputs in service methods before repository writes.
- `embed.New()` and `llm.New()` callers must handle nil dependencies.
- Vector and keyword search each fetch `limit * 3` before RRF merge.
- Keep memory version bumps in repository SQL, not service-side arithmetic.

## Anti-patterns

- Do NOT import TiDB, Postgres, or DB9 concrete repository packages here.
- Do NOT make HTTP response decisions in services.
- Do NOT treat a nil embedder or nil LLM client as impossible.
