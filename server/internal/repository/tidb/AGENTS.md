---
title: server/internal/repository/tidb — TiDB storage
---

## Purpose

TiDB/MySQL repository implementations for memories, sessions, tenants, upload tasks, and attribution data. This area owns raw SQL and TiDB-specific search behavior.

## Commands

```bash
cd server && go test -race -count=1 ./internal/repository/tidb/
make test-integration
```

## Where to look

| Task | File |
|------|------|
| Memory persistence and search | `memory.go` |
| Session persistence and search | `sessions.go` |
| Tenant records | `tenant.go` |
| Upload task records | `upload_task.go` |
| DB connection helper | `tidb.go` |
| TiDB schema | `../../../schema.sql` |

## Local conventions

- Use `database/sql` with placeholder arguments.
- Store tags as JSON arrays; use `[]`, never `NULL`.
- Filter tags with `JSON_CONTAINS`.
- Every vector search must include `embedding IS NOT NULL`.
- Keep `VEC_COSINE_DISTANCE(...)` byte-for-byte identical in `SELECT` and `ORDER BY`.
- When `autoModel != ""`, omit the `embedding` column so TiDB generates it.
- Use `INSERT ... ON DUPLICATE KEY UPDATE` for upserts.
- Increment versions atomically in SQL with `version = version + 1`.

## Anti-patterns

- Do NOT build SQL by concatenating user input.
- Do NOT scan nullable DB values directly into non-null domain fields without conversion helpers.
- Do NOT add service-level policy decisions to repository methods.
