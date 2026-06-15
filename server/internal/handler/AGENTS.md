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
| Memory CRUD, search dispatch, batch delete | `memory.go` |
| Confidence recall scoring and query classification | `recall.go` |
| Space Chain runtime routing and recall | `chain_runtime.go` |
| Webhook CRUD (Space + Chain scoped) | `webhook.go` |
| Webhook event enqueueing | `webhook_events.go` |
| Tenant endpoints | `tenant.go` |
| Import task endpoints | `task.go` |
| Metering admin endpoints | `metering.go` |
| Runtime usage helpers and error mapping | `runtime_usage.go` |

## Unwired handlers

The following handlers are defined in `memory.go` and `tenant.go` but are NOT registered in `Router()`:

| Handler | File | Note |
|---------|------|------|
| `bulkCreateMemories` | `memory.go` | Defined, no route. Use `POST /memories` with `messages[]` array instead |
| `bootstrapMemories` | `memory.go` | Defined, no route. Use `GET /memories?scan_all=true&limit=N&sort_by=created_at&sort_dir=desc` instead |
| `getTenantInfo` | `tenant.go` | Defined, no route. Tenant info is available via `GET /v1alpha2/status` |

These may be wired up or removed in a future cleanup pass.

## Search dispatch in `listMemories`

`memory.go:listMemories()` dispatches to one of these search paths based on query parameters:

| Path | Trigger | Description |
|------|---------|-------------|
| `content-keyword` | `search_mode=keyword` or query is short/needs substring match | Direct keyword substring search against content |
| `scan-all` | `scan_all=true`, no query | Return all memories in insertion order (paginated) |
| `default-confidence-recall` | No `search_mode`, no special params | 3-pool confidence recall: pinned + insight + session memories scored and deduplicated |
| `single-pool-confidence-recall` | `memory_type` filter + query | Recall from a single pool (pinned/insight/session only) |
| `session-list` | `session_id` param present, no search query | List memories by session ID(s) |
| `memory-search` | `search_mode=memory-search` | Standard hybrid/keyword search (bypasses confidence recall) |
| `chain` | Chain auth context | Ordered Space Chain recall with stop-score threshold |

## Local conventions

- Keep handlers thin: parse/validate request shape, resolve services, call service methods, and respond.
- Add or change routes in `handler.go`.
- Keep HTTP/domain error mapping in `handler.go`.
- Read `X-Mnemo-Agent-Id` through the existing request helpers instead of duplicating header parsing.
- Use the existing runtime usage helpers for quota error responses and post-success finalization; finalization after tenant writes must survive request cancellation.
- Use `respond()` and existing error helpers for JSON responses.

## Anti-patterns

- Do NOT put business reconciliation, embedding, or SQL logic in handlers.
- Do NOT add one-off JSON response writers.
- Do NOT bypass the tenant/API-key middleware when adding tenant-scoped routes.
