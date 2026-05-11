---
title: Active tenants 7d Prometheus metric proposal
---

## Problem

Issue 294 needs an unlabeled gauge, `mnemo_active_tenants_7d_total`, counting tenants where:

1. `tenants.status = 'active'`
2. `tenants.deleted_at IS NULL`
3. The tenant has successful memory activity in the last 7 days

Current metrics only expose memory-level gauges. `ActiveMemoryTotal` and `ActiveMemory7dTotal` are per-cluster gauges refreshed from tenant data-plane memory tables.

## Proposed Design

Add a control-plane `tenant_activity` table and keep activity telemetry out of `tenants`.

Extend `repository.TenantRepo` with:

1. `TouchActivity(ctx context.Context, tenantID string, at time.Time) error`
2. `CountActiveTenantsSince(ctx context.Context, since time.Time) (int64, error)`

Implement both for TiDB/MySQL and Postgres. `db9` continues using the Postgres tenant repository implementation.

Add a shared `service.ActivityTracker` that is injected into both the HTTP handler and upload worker. The tracker owns best-effort activity writes and process-global active-tenant gauge refresh debounce.

## Schema Changes

Add `tenant_activity` to:

1. `server/schema.sql`
2. `server/schema_pg.sql`
3. `server/schema_db9.sql`
4. `server/internal/repository/tidb/testutil_test.go`

Do not add activity columns to `tenants`.

### TiDB/MySQL DDL

```sql
CREATE TABLE IF NOT EXISTS tenant_activity (
  tenant_id        VARCHAR(36) NOT NULL PRIMARY KEY,
  last_activity_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tenant_activity FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  INDEX idx_tenant_activity_last_activity (last_activity_at)
);
```

### Postgres and db9 DDL

```sql
CREATE TABLE IF NOT EXISTS tenant_activity (
    tenant_id        VARCHAR(36) PRIMARY KEY,
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_tenant_activity FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS idx_tenant_activity_last_activity ON tenant_activity(last_activity_at);
```

### Test Schema

`server/internal/repository/tidb/testutil_test.go` must:

1. Create `tenant_activity` after `tenants` and before tests use `TenantRepo`.
2. Add `tenant_activity` to truncation before `tenants` to satisfy the foreign key.

The truncation order should be `tenant_activity`, `tenants`, `memories`.

## Repository SQL

### TiDB/MySQL TouchActivity

```sql
INSERT INTO tenant_activity (tenant_id, last_activity_at)
VALUES (?, ?)
ON DUPLICATE KEY UPDATE
  last_activity_at = GREATEST(last_activity_at, VALUES(last_activity_at));
```

### Postgres/db9 TouchActivity

```sql
INSERT INTO tenant_activity (tenant_id, last_activity_at)
VALUES ($1, $2)
ON CONFLICT (tenant_id) DO UPDATE SET
  last_activity_at = GREATEST(tenant_activity.last_activity_at, EXCLUDED.last_activity_at);
```

`TouchActivity` preserves the greatest timestamp so a delayed background update cannot move activity backward.

The foreign key is intentional. A non-existent tenant ID returns a repository error, and the activity tracker logs and suppresses it. This avoids orphaned activity rows without coupling user-facing writes to activity tracking success.

### CountActiveTenantsSince

TiDB/MySQL uses `?`; Postgres/db9 uses `$1`.

```sql
SELECT COUNT(*)
FROM tenant_activity AS ta
INNER JOIN tenants AS t ON t.id = ta.tenant_id
WHERE t.status = 'active'
  AND t.deleted_at IS NULL
  AND ta.last_activity_at >= ?;
```

The `INNER JOIN` is deliberate. If an orphan row somehow exists, it is not counted.

## Runtime Flow

After successful memory write operations, call the shared activity tracker:

1. Skip if `auth.TenantID == ""`.
2. Run `TouchActivity` with `context.Background()` and a short timeout, not the request context.
3. Log a warning and return on failure.
4. Debounce `CountActiveTenantsSince(now.Add(-7 * 24 * time.Hour))` with a process-global timer.
5. Set `metrics.ActiveTenants7dTotal`.

This must stay outside memory repository transactions. User-facing memory writes must not fail, roll back, or return an error because activity tracking or metric refresh failed.

The active-tenant gauge is write-driven, matching the existing memory gauges. During quiet periods it can become stale until the next write. That is acceptable for this issue; a future background refresh can be added if Prometheus needs wall-clock freshness.

## Activity Tracker Wiring

Add `server/internal/service/activity.go`:

```go
type ActivityTracker struct {
    tenants repository.TenantRepo
    logger  *slog.Logger
    ttl     time.Duration

    mu          sync.Mutex
    lastRefresh time.Time
}

func NewActivityTracker(tenants repository.TenantRepo, logger *slog.Logger) *ActivityTracker
func (t *ActivityTracker) RecordMemoryActivity(tenantID string, at time.Time)
```

`RecordMemoryActivity` is best-effort. It returns without error and is safe to call from handlers and background workers.

Handler wiring:

1. Add `activity *service.ActivityTracker` to `handler.Server`.
2. Add `func (s *Server) WithActivityTracker(tracker *service.ActivityTracker) *Server`.
3. Keep `NewServer` parameters unchanged to avoid updating handler tests.
4. Add helper `afterSuccessfulWrite(auth, svc, written)` that calls `refreshWriteMetrics` and `activity.RecordMemoryActivity`.
5. Keep `afterSuccessfulIngest` as the ingest-specific hook: it calls `afterSuccessfulWrite` and `recordIngestMetering`.

Upload worker wiring:

1. Add `activity *ActivityTracker` to `service.UploadWorker`.
2. Add a final `activity *ActivityTracker` argument to `NewUploadWorker`.
3. After successful session chunk ingest and memory bulk create, call `w.activity.RecordMemoryActivity(task.TenantID, time.Now().UTC())` if configured.

Main wiring:

1. Create one tracker after `tenantRepo := repository.NewTenantRepo(...)`:

```go
activityTracker := service.NewActivityTracker(tenantRepo, logger)
```

2. Pass it to the handler with `.WithActivityTracker(activityTracker)`.
3. Pass it to `service.NewUploadWorker(..., activityTracker)`.

This gives the process one shared debounce timer for the unlabeled gauge.

## Write Sites

Wire activity recording after successful writes in:

1. Create memory: `server/internal/handler/memory.go`
2. Update memory: `server/internal/handler/memory.go`
3. Delete memory: `server/internal/handler/memory.go`
4. Batch delete: `server/internal/handler/memory.go`
5. Bulk create endpoint: `server/internal/handler/memory.go`
6. Import worker memory bulk create: `server/internal/service/upload.go`
7. Import worker session ingest: `server/internal/service/upload.go`

The bulk-create endpoint currently returns without refreshing write metrics or recording ingest metering. Update it to use the same ingest post-write treatment as other successful ingest paths: memory gauge refresh, ingest metering, and activity tracking.

## Metric

Add `ActiveTenants7dTotal` in `server/internal/metrics/metrics.go`:

1. Prometheus name: `mnemo_active_tenants_7d_total`
2. Type: gauge
3. Labels: none
4. Help text: count of active tenants with recorded activity in the last 7 days

Use a plain `prometheus.Gauge`, not `GaugeVec`.

### Debounce

Use a separate debounce from `Server.gaugeDebounce`, because the new metric is process-global and unlabeled.

1. Default TTL: 30 seconds, matching the existing write gauge debounce.
2. Keying: no map key; use one `lastRefresh time.Time` guarded by a mutex in `ActivityTracker`.
3. First successful write after process start must always refresh the gauge.
4. Store the debounce timestamp before running the count query to avoid concurrent write bursts stampeding the control-plane DB.

## Tests

Add focused coverage for:

1. `TouchActivity` inserts a row.
2. `TouchActivity` keeps the greatest timestamp.
3. Recent active tenant is counted.
4. Stale activity is not counted.
5. Tenant with no activity row is not counted.
6. Suspended or deleted tenant with recent activity is not counted.
7. Activity tracking failure does not fail memory operations.
8. Metric refresh sets `mnemo_active_tenants_7d_total`.
9. `bulkCreateMemories` triggers post-write hooks.
10. Upload worker session ingest and memory bulk create call the tracker.

## Risks

1. Handler-level wiring can miss non-HTTP paths; import worker activity must be wired explicitly.
2. Debounce must avoid suppressing the first metric update after process start.
3. Expanding `TenantRepo` requires updating all test doubles.
4. Background goroutines should not use request contexts after the handler returns.
5. `tenant_activity` foreign key failures are intentionally suppressed by the tracker, so logs are the only signal for unexpected tenant IDs.
6. The gauge is write-driven and can be stale during quiet periods.

## Estimated Scope

~300-400 net LoC.
