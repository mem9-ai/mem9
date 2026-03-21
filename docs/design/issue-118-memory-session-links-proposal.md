---
title: "Issue #118: memory_session_links — Memory/Session Provenance Tracking"
---

## Context

`memories.session_id` already provides indexed single-session lookup: `MemoryFilter.SessionID`
maps directly to `WHERE session_id = ?` with `idx_session` covering it. The actual gap
is two-fold:

1. **Reverse lookup across replacements.** `updateInsight` archives the old row and
   creates a new one with a fresh ID. The new row carries only the current session in
   `session_id`. A query like *"which memories were ever shaped by session X?"* will
   miss every active memory whose earlier version was touched by session X —
   `MemoriesBySession(X)` on `memories.session_id` only sees the row whose
   *most recent* contributing session was X.

2. **Multi-session contribution.** A memory may be updated across several sessions over
   time. `memories.session_id` stores only the last-writing session. There is no
   per-memory view of all contributing sessions.

Issue #118 requests a `memory_session_links` join table to make this cumulative,
many-to-many provenance explicit and queryable, complementing rather than replacing
the existing `session_id` column.

**Note on `CopyLinks`:** The join table records the direct write relationship between a
session and the memory row it produced. S1 created `mem-1` → `(mem-1, S1)`. S2 updated
it to `mem-2` → `(mem-2, S2)`. Both facts are accurately recorded. Lineage traversal
across the archive chain (finding that `mem-2` descends from `mem-1`) is a query-time
concern using `superseded_by`, not a storage concern. `CopyLinks` is therefore not
needed — `Link` alone is sufficient.

**Query contract — direct-row semantics:** `MemoriesBySession(sessionID)` returns
memory row IDs whose direct write was attributed to that session (`link.session_id =
sessionID`). This is "direct-row only" — it does not expand lineage. A session S1 that
created `mem-1`, which was later superseded by `mem-2` written by S2, will return
`mem-1` (archived) from `MemoriesBySession(S1)` and `mem-2` (active) from
`MemoriesBySession(S2)`.

**Scope boundary:** This PR delivers row-level provenance only. `MemoriesBySession(S1)`
will return `mem-1` (archived) — not `mem-2`, the active descendant written by S2. The
original motivating question ("which currently active memories were ever shaped by session
X") is not answered by this PR; it requires lineage traversal via `superseded_by` and is
deferred to a follow-on. Acceptance criteria and consumers of this feature must be aware
of this boundary before depending on the API.

Callers wanting "which *currently active* memories descend from rows S1 ever wrote"
must traverse `superseded_by` client-side or via a follow-on lineage query. That
expanded query is deferred; this PR only guarantees: for every row in `memories` that
was written (created or replaced) within a session, the link row exists and the
direct-row lookup is accurate.

---

## Schema

The join table lives in the per-tenant data-plane database (same DB as `memories` and
`sessions`). It follows the same conventions as the existing tables: no FK enforcement
(matching the codebase's no-FK policy), string IDs, `INSERT IGNORE` for idempotent
inserts, and `CREATE TABLE IF NOT EXISTS` for safe re-runs.

```sql
CREATE TABLE IF NOT EXISTS memory_session_links (
    id         BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    memory_id  VARCHAR(36)  NOT NULL,
    session_id VARCHAR(100) NOT NULL,
    created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    UNIQUE INDEX uq_msl (memory_id, session_id),
    INDEX idx_msl_session_id (session_id, id),
    INDEX idx_msl_memory_id  (memory_id, id)
)
```

The composite indexes `(session_id, id)` and `(memory_id, id)` cover the deterministic
`ORDER BY ... id ASC` ordering used by the read methods (see What Changes #6) without an
extra sort step.

**Design choices vs. the issue's proposal:**

| Point | Issue proposal | This proposal | Reason |
|---|---|---|---|
| Primary key | `BIGSERIAL` | `BIGINT AUTO_INCREMENT` | TiDB/MySQL syntax |
| FK `memory_id` | `REFERENCES memories(id)` | none | codebase has no FK constraints anywhere |
| FK `session_id` | `REFERENCES sessions(session_id)` | none | same policy; also `sessions.session_id` is not a PK |
| Column type `memory_id` | `BIGINT` | `VARCHAR(36)` | `memories.id` is UUID string, not bigint |
| `session_id` type | `TEXT` | `VARCHAR(100)` | matches `memories.session_id` column type |

---

## What Changes

### 1. `server/internal/tenant/schema.go`

Add one constant and no build function (the table is static — no embedding column):

```go
const TenantMemorySessionLinksSchema = `CREATE TABLE IF NOT EXISTS memory_session_links (
    id         BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    memory_id  VARCHAR(36)  NOT NULL,
    session_id VARCHAR(100) NOT NULL,
    created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    UNIQUE INDEX uq_msl (memory_id, session_id),
    INDEX idx_msl_session_id (session_id, id),
    INDEX idx_msl_memory_id  (memory_id, id)
)`
```

### 2. `server/internal/tenant/zero.go` — `InitSchema`

Add one DDL call after the sessions block:

```go
if _, err := db.ExecContext(ctx, TenantMemorySessionLinksSchema); err != nil {
    return fmt.Errorf("init schema: memory_session_links table: %w", err)
}
```

### 3. `server/internal/service/tenant.go` — `EnsureMemorySessionLinksTable`

A new lazy-migration method, mirroring `EnsureSessionsTable`, called on first request
from `handler.resolveServices`:

```go
func (s *TenantService) EnsureMemorySessionLinksTable(ctx context.Context, db *sql.DB) error {
    if _, err := db.ExecContext(ctx, tenant.TenantMemorySessionLinksSchema); err != nil {
        return fmt.Errorf("ensure memory_session_links table: %w", err)
    }
    return nil
}
```

### 4. `server/internal/handler/handler.go` — `resolveServices`

Chain the new ensure call alongside the existing sessions-table migration goroutine. The
goroutine is guarded by the `!loaded` result from `svcCache.LoadOrStore`, which means it
fires **exactly once per tenant per server process**, not on every request:

```go
actual, loaded := s.svcCache.LoadOrStore(key, svc)
if !loaded {
    go func() {
        if err := s.tenant.EnsureSessionsTable(context.Background(), auth.TenantDB); err != nil {
            s.logger.Warn("sessions table migration failed", ...)
        }
        if err := s.tenant.EnsureMemorySessionLinksTable(context.Background(), auth.TenantDB); err != nil {
            s.logger.Warn("memory_session_links table migration failed", ...)
        }
    }()
}
```

**Migration failure behavior:** If `EnsureMemorySessionLinksTable` fails (e.g., transient
TiDB unavailability at cold-start), the goroutine logs a warning and exits. **Because
`svcCache` already holds the tenant entry, subsequent requests return the cached
`resolvedSvc` immediately and do not re-run the goroutine.** The ensure does not retry
automatically within the same server process.

Consequences for `Link` calls while the table is absent: `Link` is guarded by
`IsTableNotFoundError` (MySQL 1146 → silent skip), so no write panics or user-visible
errors occur. However, link rows are silently dropped until the table exists, creating a
provenance gap.

**Recovery: restart-based (Option A).** A pod restart clears the in-memory cache and
re-triggers the ensure goroutine. This is the same recovery model used by the `sessions`
table, which has operated in production without incident. No periodic reconciler is
added. Gaps are bounded by the restart window.

**Failure alerting:** The `"memory_session_links table migration failed"` log line
appearing more than once for the same tenant within a 10-minute window indicates a
non-transient failure. On-call engineer should restart the pod; if the table is still
absent after two restart attempts, run the manual repair below.

Manual repair runbook:
- **Diagnosis**: `SHOW WARNINGS` / `SHOW ERRORS` on the tenant DB, check TiDB audit log.
- **Manual table creation**: re-run `CREATE TABLE IF NOT EXISTS memory_session_links (...)`
  directly on the tenant database.
- **Gap fill**: run the repair query in What Changes #9 to backfill any missed links.

### 5. `server/internal/repository/repository.go` — new interface

```go
// MemorySessionLinkRepo tracks which sessions contributed to which memories.
type MemorySessionLinkRepo interface {
    // Link records that sessionID contributed to memoryID.
    // Silently succeeds if the pair already exists (INSERT IGNORE semantics).
    // Silently skips if the table is not yet migrated (MySQL 1146).
    Link(ctx context.Context, memoryID, sessionID string) error

    // MemoriesBySession returns all memory IDs directly written by the given session,
    // ordered by the link row creation time (ascending). Includes both active and
    // archived rows — callers that want only active rows must join with `memories.state`.
    // Returns nil, nil on pre-migration tenants (table not found) or empty results.
    // Limit 0 means no cap (use sparingly); callers are expected to pass a sane limit.
    // Read path only — not exposed via HTTP in this PR.
    MemoriesBySession(ctx context.Context, sessionID string, limit int) ([]string, error)

    // SessionsByMemory returns all session IDs that directly wrote the given memory row,
    // ordered by link row creation time (ascending, i.e. oldest contributor first).
    // Returns nil, nil on pre-migration tenants or empty results.
    // Limit 0 means no cap.
    // Read path only — not exposed via HTTP in this PR.
    SessionsByMemory(ctx context.Context, memoryID string, limit int) ([]string, error)
}
```

**Lineage note:** `MemoriesBySession` returns direct-row matches only (session wrote
that specific row). It does not follow `superseded_by` links to find descendant active
rows. The caller must chain queries or use a CTE if lineage expansion is needed.

### 6. `server/internal/repository/tidb/memory_session_links.go` — implementation

New file, ~90 LoC. Struct holds `*sql.DB` only. All methods use
`internaltenant.IsTableNotFoundError` to silently skip on pre-migration tenants,
matching the pattern from `SessionRepo.BulkCreate`.

```go
func (r *MemorySessionLinkRepo) Link(ctx context.Context, memoryID, sessionID string) error {
    _, err := r.db.ExecContext(ctx,
        `INSERT IGNORE INTO memory_session_links (memory_id, session_id) VALUES (?, ?)`,
        memoryID, sessionID,
    )
    if err != nil && internaltenant.IsTableNotFoundError(err) {
        return nil
    }
    return err
}
```

`MemoriesBySession` queries `SELECT memory_id FROM memory_session_links WHERE
session_id = ? ORDER BY id ASC LIMIT ?` on `idx_msl_session_id (session_id, id)`.
Ordering by `id ASC` (auto-increment) is deterministic even when two rows are inserted
within the same timestamp, unlike `ORDER BY created_at ASC` which is non-deterministic
under concurrent same-timestamp inserts. Returns `nil, nil` on pre-migration tenants
(MySQL 1146) or zero rows. Callers pass limit > 0; `0` is treated as no cap (no `LIMIT`
clause appended).

`SessionsByMemory` queries `SELECT session_id FROM memory_session_links WHERE memory_id
= ? ORDER BY id ASC LIMIT ?` on `idx_msl_memory_id (memory_id, id)`. Same nil-on-not-found and
limit semantics.

**Unit tests** (`tidb/memory_session_links_test.go`, ~80 LoC) must cover:
- `Link` idempotency: two identical calls, count = 1.
- `MemoriesBySession`: returns correct IDs in insertion order (by `id ASC`); excludes other sessions.
- `SessionsByMemory`: returns correct IDs in insertion order (by `id ASC`); excludes other memories.
- Pre-migration table-not-found: returns `nil, nil` (no error) for both read methods.
- `Link` on missing table: returns nil (silent skip).
- Recovery test seam: an `EnsureMemorySessionLinksTable` call against a DB where the
  table does not yet exist creates it; a subsequent `Link` call succeeds. This validates
  the manual restart / reconciler recovery path without requiring integration with
  `resolveServices`.

### 7. `server/internal/repository/factory.go` — `NewMemorySessionLinkRepo`

Add a factory function following the `NewSessionRepo` pattern. Only TiDB has
`memory_session_links`; all other backends return a no-op stub:

```go
// NewMemorySessionLinkRepo creates a MemorySessionLinkRepo for the specified backend.
// Only TiDB has a memory_session_links table; other backends return a silent no-op stub.
func NewMemorySessionLinkRepo(backend string, db *sql.DB) MemorySessionLinkRepo {
    switch backend {
    case "tidb", "":
        return tidb.NewMemorySessionLinkRepo(db)
    default:
        return stubMemorySessionLinkRepo{}
    }
}

type stubMemorySessionLinkRepo struct{}

func (stubMemorySessionLinkRepo) Link(_ context.Context, _, _ string) error { return nil }
func (stubMemorySessionLinkRepo) MemoriesBySession(_ context.Context, _ string, _ int) ([]string, error) {
    return nil, nil
}
func (stubMemorySessionLinkRepo) SessionsByMemory(_ context.Context, _ string, _ int) ([]string, error) {
    return nil, nil
}
```

### 8. Wire in all `NewIngestService` call sites

Four sites must be updated to pass `linkRepo`:

| File | Location |
|---|---|
| `handler/handler.go` | `resolveServices` — ×2 (anonymous-auth and tenant-auth branches) |
| `service/upload.go` | `processTask` — constructs its own `IngestService` for async upload jobs |
| `service/memory.go` | `NewMemoryService` — embeds an `IngestService` for reconcile-on-write |

Each site already constructs `memRepo` and `sessRepo`; add `linkRepo := repository.NewMemorySessionLinkRepo(s.dbBackend, auth.TenantDB)` alongside them and pass into `NewIngestService`.

### 9. `server/internal/service/ingest.go` — `IngestService`

Add `links repository.MemorySessionLinkRepo` field. Inject via `NewIngestService`.

**`addInsight`** — after `s.memories.Create(ctx, m)`:

```go
if sessionID != "" {
    if err := s.links.Link(ctx, m.ID, sessionID); err != nil {
        slog.Warn("memory_session_links: failed to link memory",
            "memory_id", m.ID, "session_id", sessionID, "err", err)
    }
}
```

**`updateInsight`** — after `s.memories.ArchiveAndCreate(ctx, oldID, newID, m)`:

```go
if sessionID != "" {
    if err := s.links.Link(ctx, newID, sessionID); err != nil {
        slog.Warn("memory_session_links: failed to link memory",
            "memory_id", newID, "session_id", sessionID, "err", err)
    }
}
```

`oldID` is not linked — it has been archived (`state = 'archived'`). The default
repository filter (`buildFilterConds` with `f.State == ""`) adds `state = 'active'`,
so archived rows do not appear in normal search/list results. They remain queryable via
`MemoryFilter{State: "archived"}` or `State: "all"`. Linking `oldID` to the current
session would be misleading (the session did not produce that content; it replaced it),
so only `newID` (the active replacement) is linked.

**`ingestRaw`** — after `s.memories.Create(ctx, m)`: same `Link` call as `addInsight`.

**Durability posture**: link writes are post-transaction and non-fatal. `Link` is
idempotent (`INSERT IGNORE` / `UNIQUE INDEX`), so missing links can be repaired at any
time with:

```sql
INSERT IGNORE INTO memory_session_links (memory_id, session_id)
SELECT id, session_id FROM memories
WHERE session_id IS NOT NULL AND session_id != ''
  AND id NOT IN (SELECT DISTINCT memory_id FROM memory_session_links);
```

### 10. `server/internal/domain/types.go` — no change

`SessionIDs []string` is not added to `domain.Memory`. Read access goes through the
two repo methods directly; the shape of any future HTTP endpoint is not yet decided.

---

## What Is Explicitly Out of Scope

- **New HTTP endpoints** (`GET /memories/{id}/sessions`, `GET /sessions/{id}/memories`)
  — `MemoriesBySession` and `SessionsByMemory` are implemented but not routed. The shape
  of these APIs is deferred to a follow-on PR once there is a concrete consumer.
- **Backfill** — historical memories already have `session_id` on the `memories` row,
  but `memory_session_links` starts empty on deploy. Backfill is not required: missing
  historical provenance is acceptable, and the repair query exists for on-demand use if
  needed later. This PR covers forward provenance only (from deploy onwards).
- **`MemoryService.Create` direct-write path** — passes `sessionID=""`, no link written.
  Correct: pinned memories written via HTTP POST have no session context.
- **Postgres / db9 backends** — `TenantMemorySessionLinksSchema` uses MySQL/TiDB syntax.
  A Postgres variant is not needed until those backends gain an ingest path.

---

## Effort Estimate

| Layer | File | Net LoC |
|---|---|---|
| Schema constant | `tenant/schema.go` | ~15 |
| `InitSchema` DDL call | `tenant/zero.go` | ~3 |
| Lazy migration method | `service/tenant.go` | ~8 |
| Handler goroutine chain + runbook note | `handler/handler.go` | ~10 |
| Repository interface | `repository/repository.go` | ~18 |
| Repository impl | `tidb/memory_session_links.go` | ~90 |
| Stub + factory | `repository/factory.go` | ~22 |
| `IngestService` field + wiring (4 production sites) | `service/ingest.go` + callers | ~30 |
| `NewIngestService` signature update (18 test callsites in `ingest_test.go`) | `service/ingest_test.go` | ~20 |
| Unit tests (link idempotency, read ordering, pre-migration skip, failure/recovery) | `tidb/memory_session_links_test.go` | ~80 |
| **Total** | | **~296 LoC** |

The previous estimate of ~233 LoC undercounted the 18 `NewIngestService(...)` test
callsites in `ingest_test.go` and the expanded test coverage for method contracts and
migration-failure scenarios.

---

## Decisions Log

| Decision | Choice | Reason |
|---|---|---|
| `CopyLinks` | Not needed | Join table records the direct write relationship only. S1→`mem-1`, S2→`mem-2` are complete accurate facts. Lineage traversal across `superseded_by` is a query-time concern, not a storage concern |
| Link failure durability | Best-effort, non-fatal; recovery via restart (Option A) | `Link` is idempotent; the ensure goroutine fires once per tenant per server process; a pod restart re-runs ensure; repair query restores missing links; same model as `sessions` table in production |
| HTTP endpoints for read methods | Deferred | Shape of `MemoriesBySession` / `SessionsByMemory` APIs not yet decided; no consumer in this PR |
| Non-TiDB stub read behaviour | `nil, nil` | Consistent with `stubSessionRepo` search methods; `ErrNotSupported` revisited when endpoints are added |

**Design trade-off matrix — direct-row vs lineage-expanded semantics:**

| Approach | Write cost | Read correctness | Read latency | Storage |
|---|---|---|---|---|
| **Direct-row only (chosen)** | O(1) INSERT IGNORE per write | Exact for "who wrote this row"; caller must traverse `superseded_by` for lineage | O(1) indexed lookup | 1 row per write event |
| Lineage-expanded at write | O(depth) recursive lookups + inserts per write | Returns all ancestors' sessions transitively | Same O(1) lookup | O(depth) rows per write; grows with chain length |
| Lineage-expanded at read | O(1) write | Returns transitively contributing sessions | O(depth) recursive query or CTE | 1 row per write event |

Direct-row is chosen because: (a) write cost is bounded and predictable regardless of
chain depth; (b) the stated reverse-lookup problem ("which memories were shaped by
session X") is satisfiable by direct-row lookup for the active PR scope — lineage
expansion is a follow-on query that can be added without schema changes; (c) read
latency is O(1) with covering indexes in all cases.

---

## Open Questions

| # | Question | Owner | Decision deadline |
|---|---|---|---|
| OQ-1 | Should `MemoriesBySession` offer a lineage-expanded variant (follows `superseded_by` to return only currently-active descendant rows)? Deferred from this PR — see scope boundary in Context. Required before routing any HTTP endpoint that consumers depend on. | Implementer | Before routing HTTP endpoints |
| OQ-4 | Default limit for `MemoriesBySession` / `SessionsByMemory` when HTTP endpoints are added — what is a sane upper bound to prevent accidental full-table scans? | Implementer | Before HTTP endpoints PR |

---

## Acceptance Criteria Mapping

| Issue AC | Covered by |
|---|---|
| `memory_session_links` table created via migration | `InitSchema` in `zero.go` + `EnsureMemorySessionLinksTable` lazy path |
| `addInsight` writes a link row | `addInsight` / `updateInsight` / `ingestRaw` post-write `Link` call |
| `MemoriesBySession` implemented and tested | `MemorySessionLinkRepo.MemoriesBySession` (with limit, ordered) + unit tests covering ordering, empty result, pre-migration skip |
| `SessionsByMemory` implemented and tested | `MemorySessionLinkRepo.SessionsByMemory` (with limit, ordered) + unit tests covering same cases |
| No breaking change when `sessionID` is empty | `Link` is skipped when `sessionID == ""`; failures are non-fatal |
| Non-TiDB backends — link writes no-op | `stubMemorySessionLinkRepo` no-ops all link writes; `EnsureMemorySessionLinksTable` will warn and no-op on non-TiDB backends (same pre-existing behavior as `EnsureSessionsTable`); backend-aware guards deferred until db9/postgres DDL is verified |
| Migration failure is recoverable | Ensure goroutine fires once per tenant per server process; recovery is via pod restart (same model as `sessions` table); repair query available for gap fill; test seam validates ensure + link round-trip |
