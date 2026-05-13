---
title: Issue 305 Active Memory Metrics Proposal
---

## Goal

Fix issue #305 by changing:

1. `mnemo_active_memory_total{cluster_id=...}`
2. `mnemo_active_memory_7d_total{cluster_id=...}`

Into unlabeled server-level gauges:

1. `mnemo_active_memory_total`
2. `mnemo_active_memory_7d_total`

Keep tenant and cluster identity only in server-side aggregation, not Prometheus labels.

## Current State

1. Metrics are `GaugeVec` with `cluster_id` in `server/internal/metrics/metrics.go:137`.
2. HTTP writes refresh per-cluster gauges from tenant DB `CountStats` in `server/internal/handler/memory.go:689`.
3. Upload memory imports set the same per-cluster gauges in `server/internal/service/upload.go:336`.
4. `tenant_activity` already stores one row per tenant, but only has `last_activity_at` in `server/schema.sql:27`.
5. `ActivityTracker` already debounces control-plane aggregate refresh for active tenant count in `server/internal/service/activity.go:41`.

## Proposed Design

1. Extend `tenant_activity` in all control-plane schema files.

TiDB `server/schema.sql` uses `TIMESTAMP NULL`:

```sql
ALTER TABLE tenant_activity
  ADD COLUMN active_memory_total BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN active_memory_7d_total BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN memory_stats_observed_at TIMESTAMP NULL;
```

Postgres `server/schema_pg.sql` and db9 `server/schema_db9.sql` use the same count columns with `TIMESTAMPTZ NULL` for `memory_stats_observed_at`.

2. Extend `repository.TenantRepo` with memory-stat methods:

```go
UpsertMemoryStats(ctx context.Context, tenantID string, activityAt time.Time, total, last7d int64, observedAt time.Time) error
SumActiveMemoryStats(ctx context.Context) (total int64, last7d int64, err error)
```

3. Implement TiDB and Postgres/db9 SQL.

Use greatest-timestamp semantics for `last_activity_at`. For memory stats, only overwrite counts when `observedAt` is newer than or equal to the stored `memory_stats_observed_at`, so concurrent delayed refreshes cannot replace newer counts with older snapshots.

Example race: goroutine A counts `(100, 50)` at `T1`, goroutine B counts `(101, 51)` at `T2`, B upserts first, then A upserts later. The SQL guard must keep B's `(101, 51)` because `T1 < memory_stats_observed_at`.

TiDB should implement this with `INSERT ... ON DUPLICATE KEY UPDATE` and conditional `IF(...)` expressions. Postgres and db9 should implement the same semantics with `ON CONFLICT (tenant_id) DO UPDATE` and `CASE WHEN EXCLUDED.memory_stats_observed_at >= tenant_activity.memory_stats_observed_at THEN ...`.

4. Change active-memory metrics from `GaugeVec` to `Gauge`.

Keep names unchanged, remove labels.

5. Replace direct per-cluster gauge writes with this flow after successful memory write, delete, or import:

```text
tenant DB CountStats
-> control-plane tenant_activity upsert
-> debounced control-plane SUM over active tenants
-> set unlabeled Prometheus gauges
```

6. Move the debounce point after the tenant snapshot upsert.

The current debounce skips counting and setting for 30 seconds per `cluster_id`. The new design should always update the affected tenant snapshot after successful writes, but debounce the global aggregate refresh.

7. Reuse or extend `ActivityTracker`.

Preferred minimal path: add `RecordMemoryStats(...)` to `ActivityTracker`, because it already owns `tenant_activity`, control-plane aggregate refresh, and debounce behavior.

Use explicit tracker method signatures:

```go
func (t *ActivityTracker) RecordMemoryStats(ctx context.Context, tenantID string, activityAt time.Time, total, last7d int64, observedAt time.Time)
func (t *ActivityTracker) refreshAggregateMetrics(ctx context.Context, now time.Time)
```

`activityAt` updates `last_activity_at`; `observedAt` guards memory-count snapshot ordering.

`ActivityTracker` should use one debounce claim to refresh all control-plane aggregate gauges together:

```text
RecordMemoryActivity(...)
-> UpsertMemoryActivity(...)
-> refreshAggregateMetrics(ctx, now)

RecordMemoryStats(...)
-> UpsertMemoryStats(...)
-> refreshAggregateMetrics(ctx, now)
```

`refreshAggregateMetrics(ctx, now)` should run both aggregate queries under one `shouldRefresh(now)` claim:

1. `CountActiveTenantsSince(ctx, now.Add(-7*24*time.Hour))` -> `mnemo_active_tenants_7d_total`
2. `SumActiveMemoryStats(ctx)` -> `mnemo_active_memory_total` and `mnemo_active_memory_7d_total`

This avoids the ambiguous case where `RecordMemoryActivity` claims the only `lastRefresh` slot and `RecordMemoryStats` then skips memory-gauge refresh, or vice versa. If either aggregate query fails, log a warning, call the existing refresh-claim rollback path, and leave all control-plane gauges unchanged. This all-or-nothing behavior prevents partial gauge updates.

If tenant DB `CountStats` fails after a successful write, still call `RecordMemoryActivity` so `last_activity_at` remains updated. Only skip `RecordMemoryStats` for that event because the snapshot counts are unavailable.

## Handler Rewrite

Rewrite `server/internal/handler/memory.go:689` so it still queries tenant DB stats through `svc.memory.CountStats(ctx)`, but no longer writes active-memory gauges directly.

| Current code | Current behavior | New behavior |
| --- | --- | --- |
| `server/internal/handler/memory.go:704` | `gaugeDebounce.Load(clusterID)` skips per-cluster refresh | Remove; debounce moves to `ActivityTracker.refreshAggregateMetrics` |
| `server/internal/handler/memory.go:709` | `svc.memory.CountStats(ctx)` queries tenant DB | Keep; handler must not bypass `MemoryService` |
| `server/internal/handler/memory.go:714` | `ActiveMemoryTotal.WithLabelValues(clusterID).Set(...)` | Replace with `s.activity.RecordMemoryStats(ctx, auth.TenantID, now, total, last7d, observedAt)` |
| `server/internal/handler/memory.go:715` | `ActiveMemory7dTotal.WithLabelValues(clusterID).Set(...)` | Removed; aggregate refresh sets unlabeled gauge |
| `server/internal/handler/handler.go:45` | `gaugeDebounce sync.Map` | Remove if no other user remains |

Preserve the existing nil guard pattern: if `s.activity == nil`, skip the control-plane stats path after logging at most a warning. `MemoryChangesTotal{cluster_id=...}` stays unchanged.

## Call Sites

All write/delete/import paths that currently refresh active-memory gauges must feed the new stats path.

| Call site | Current behavior | New behavior |
| --- | --- | --- |
| `server/internal/handler/memory.go:103` POST memory | `go s.afterSuccessfulWrite(auth, svc, written)` | Existing path calls rewritten `refreshWriteMetrics` |
| `server/internal/handler/memory.go:120` async ingest | `s.afterSuccessfulIngest(auth, svc, written)` | Existing path calls rewritten `refreshWriteMetrics` |
| `server/internal/handler/memory.go:491` PUT memory | `go s.afterSuccessfulWrite(auth, svc, 1)` | Existing path calls rewritten `refreshWriteMetrics` |
| `server/internal/handler/memory.go:506` DELETE memory | `go s.afterSuccessfulWrite(auth, svc, 0)` | Re-query `CountStats` after delete and record post-delete stats |
| `server/internal/handler/memory.go:529` batch delete | `go s.afterSuccessfulWrite(auth, svc, 0)` | Re-query `CountStats` after delete and record post-delete stats |
| `server/internal/service/upload.go:335` raw JSON import | Keep `MemoryChangesTotal.WithLabelValues(clusterID).Add(...)` | Keep unchanged |
| `server/internal/service/upload.go:336` raw JSON import | `memRepo.CountStats(...)` then direct per-cluster gauges | Call `w.activity.RecordMemoryStats(taskCtx, task.TenantID, now, total, last7d, observedAt)` |
| `server/internal/service/upload.go:260` memory file import | `w.recordActivity(task.TenantID)` only | Add `memRepo.CountStats(...)` after import and call `RecordMemoryStats(...)` |

The upload worker can either extend `recordActivity` to accept optional stats or keep `recordActivity` unchanged and add a separate helper for `RecordMemoryStats`. Prefer a separate helper so activity recording still happens even when `CountStats` fails.

## Aggregate Query

```sql
SELECT
  COALESCE(SUM(ta.active_memory_total), 0),
  COALESCE(SUM(ta.active_memory_7d_total), 0)
FROM tenant_activity AS ta
INNER JOIN tenants AS t ON t.id = ta.tenant_id
WHERE t.status = 'active'
  AND t.deleted_at IS NULL;
```

## Dashboard And Query Migration

1. Replace `mnemo_active_memory_total{cluster_id=...}` with `mnemo_active_memory_total`.
2. Replace `mnemo_active_memory_7d_total{cluster_id=...}` with `mnemo_active_memory_7d_total`.
3. Existing `sum(mnemo_active_memory_total)` remains valid after the old labeled series are no longer returned by the active scrape path. During migration and historical/range queries, avoid summing old labeled series together with the new unlabeled series because that can double count.
4. Cluster-level active-memory dashboards should move to a separate control-plane query/storage path, not Prometheus labels.

## Consistency And Failure Modes

1. Metrics are eventually consistent. The aggregate gauges can lag writes by up to `activityGaugeTTL` (`30s` today), matching the existing active-tenant gauge debounce. This is intentional to avoid tenant DB fanout during `/metrics` scrape.
2. Process crash after tenant DB write but before `UpsertMemoryStats`: the affected tenant snapshot remains stale until that tenant's next successful write/import/delete. This is acceptable for best-effort metrics.
3. Process crash after debounce claim but before aggregate refresh: gauges are process-local and restart at zero; the first post-restart write claims a fresh debounce and refreshes aggregates.
4. Control-plane aggregate query failure: log, clear the refresh claim, keep the previous gauge values, and retry on the next write event.
5. Concurrent writes for the same tenant: `memory_stats_observed_at` prevents an older count snapshot from replacing a newer one.

## Tests

1. Repository tests:
   1. Upsert preserves greatest `last_activity_at`.
   2. Older `memory_stats_observed_at` does not overwrite newer counts.
   3. Aggregate excludes suspended/deleted tenants and `deleted_at IS NOT NULL`.

2. Activity tracker tests:
   1. Records tenant stats and sets unlabeled gauges.
   2. Debounces aggregate refresh, not tenant snapshot writes.
   3. Logs and leaves gauges unchanged on aggregate query failure.
   4. One refresh claim updates active-tenant and active-memory aggregate gauges together.

3. Handler/upload tests:
   1. Mocks updated for new `TenantRepo` methods.
   2. Successful writes/deletes/imports call the new stats path.
   3. `MemoryChangesTotal{cluster_id=...}` remains unchanged.
   4. `CountStats` failure still records tenant activity but skips memory stats.

## Rollout

1. Apply control-plane DB migration before deploying code.
2. Deploy code that writes snapshots and exposes unlabeled gauges.
3. Update dashboards and alerts to remove `cluster_id` filters.
4. Avoid historical/range queries that sum old labeled series with new unlabeled series during the retention overlap.
5. Accept that old labeled time series may remain visible until metrics retention expires, but new scrapes will not expose `cluster_id`.

## Non-goals

1. Do not preserve per-cluster active-memory Prometheus labels.
2. Do not change `mnemo_memory_changes_total{cluster_id=...}` in this issue.
3. Do not fan out across tenant databases during `/metrics` scrape.
4. Do not add scrape-time tenant/cluster labels.

## Estimate

~150-250 LoC, mostly repository methods, schema/test updates, and replacing the active-memory gauge refresh path.
