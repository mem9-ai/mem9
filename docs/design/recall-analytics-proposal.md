---
title: "[Proposal] Recall analytics — track memory recall events and surface interest profiles"
source: https://github.com/mem9-ai/mem9/issues/116
date: 2026-03-20
revised: 2026-03-20 (post-design-review r2: search_id is internal UUID not chi request_id, clusterID added to factory, agent_id default ownership clarified to handler, storage/privacy note restored)
status: Draft
---

## Background

Every `GET /memories?q=...` call performs a hybrid search across the `memories`
and `sessions` tables and returns matching results to the caller. Once the response
is sent, no record of the event survives. There is currently no way to answer:

- What topics has an agent been recalling most this week?
- Which memories are "hot" (recalled frequently) vs "cold" (never recalled)?
- How do an agent's interests shift over time?

Both tables already carry a `tags JSON` column. Insights carry user-assigned tags;
session messages carry LLM-generated per-message tags from Phase 1 extraction
(e.g. `["tech", "debug", "go"]`). These tags are a ready-made topic vocabulary —
but without an event log, they cannot be aggregated over time.

## Current State

| Item | Status |
|------|--------|
| `recall_events` table | Does not exist |
| Recall logging in `listMemories` | Not present |
| `GET /memories/interests` endpoint | Not registered on any route |
| Partial implementation anywhere | None found |

## Proposed Changes

Three phases, each independently deployable.

---

### Phase 1 — Recall event logging (~180 LoC)

#### 1a. Schema — `recall_events` table

New function `BuildRecallEventsSchema()` in `server/internal/tenant/schema.go`:

```sql
CREATE TABLE IF NOT EXISTS recall_events (
    id           VARCHAR(36)   PRIMARY KEY,

    -- UUID generated in the handler per listMemories invocation; groups all rows
    -- from one search. NOT the chi request_id — chi accepts inbound X-Request-Id
    -- verbatim, so callers could reuse one ID across requests, breaking
    -- COUNT(DISTINCT search_id) semantics. UUID is always server-generated.
    -- VARCHAR(36) matches id column; request_id is logged separately for correlation.
    search_id    VARCHAR(36)   NOT NULL,

    -- full query text, stored verbatim. TEXT (up to 64KB); no truncation applied.
    -- used only for MIN(query) display in top_queries; all grouping uses query_hash.
    query        TEXT          NOT NULL,

    -- SHA-256(query) hex string. fixed 64 chars, indexed for O(1) GROUP BY.
    -- computed from the full query string. case-sensitive.
    query_hash   VARCHAR(64)   NOT NULL,

    -- agent that issued the search (X-Mnemo-Agent-Id header). NULL if not provided.
    agent_id     VARCHAR(100)  NULL,

    -- session context of the search request (filter.SessionID from ?session_id=
    -- query param). NOT a FK to sessions.id — this is the calling agent's session,
    -- not the recalled row's session. NULL if caller did not supply session_id.
    session_id   VARCHAR(100)  NULL,

    -- ID of the recalled item. points to memories.id when memory_type is
    -- 'pinned' or 'insight'; points to sessions.id when memory_type is 'session'.
    -- no FK constraint: memory_id references two different tables depending on
    -- memory_type, and TiDB Serverless does not enforce FK constraints.
    memory_id    VARCHAR(36)   NOT NULL,

    -- discriminates which table memory_id belongs to: 'pinned'|'insight'|'session'
    memory_type  VARCHAR(20)   NOT NULL,

    -- snapshot of the recalled item's tags at recall time. stored as JSON array
    -- (e.g. '["go","debug"]'). always NOT NULL; empty slice stored as '[]'.
    -- immune to later tag edits on the source row.
    tags         JSON          NOT NULL,

    -- relevance score at recall time. NULL for keyword-only searches (no embedding
    -- configured). non-null for vector/hybrid results (RRF or cosine similarity).
    score        DOUBLE        NULL,

    created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_re_agent    (agent_id),
    INDEX idx_re_created  (created_at),
    INDEX idx_re_query    (query_hash),
    INDEX idx_re_memory   (memory_id),
    INDEX idx_re_search   (search_id)
)
```

Design points:
- One row per recalled item per search. A search returning 10 results produces 10 rows.
- `search_id` is a `uuid.NewString()` generated in the handler before the goroutine
  fires. It groups all rows from one `listMemories` invocation, enabling
  `COUNT(DISTINCT search_id)` for correct `top_queries.count` semantics (query
  invocations, not recalled items). The chi `request_id` is intentionally NOT used
  here — chi accepts inbound `X-Request-Id` verbatim, so a caller sending the same
  header on every request would collapse all rows to one `search_id`. The chi
  `request_id` is logged alongside `search_id` in drop logs for access-log
  correlation.
- `tags` is a point-in-time snapshot — immune to later tag edits on the source row.
  A memory with no tags yet stores `[]`.
- `query_hash` (SHA-256 of the full query string) enables O(1) indexed grouping.
  `MIN(query)` recovers display text at aggregation time. Case-sensitive.
- `query TEXT` is stored verbatim, once per recalled item per search (a 20-result
  search stores the same query string 20 times). At ~100 bytes/query average,
  100 searches/day × 20 results × 365 days ≈ 73 MB/tenant/year in query text alone.
  Combined with other columns, total storage is ~146 MB/tenant/year — negligible
  on TiDB Cloud Serverless (25 GiB free tier). Queries persist indefinitely (no
  retention policy). If tenants require PII-free analytics, a future per-tenant
  opt-out can zero the `query` column on insert while preserving `query_hash`; no
  schema change needed.
- `rank` is absent — plugins regroup results by `memory_type` before prompt
  injection, discarding server response order. `score` captures the only meaningful
  retrieval quality signal.

#### 1b. Domain type

New struct in `server/internal/domain/types.go`:

```go
type RecallEvent struct {
    ID         string    `json:"id"`
    SearchID   string    `json:"search_id"`
    Query      string    `json:"query"`
    QueryHash  string    `json:"query_hash"`
    AgentID    string    `json:"agent_id,omitempty"`
    SessionID  string    `json:"session_id,omitempty"`
    MemoryID   string    `json:"memory_id"`
    MemoryType string    `json:"memory_type"`
    Tags       []string  `json:"tags"`
    Score      *float64  `json:"score,omitempty"`
    CreatedAt  time.Time `json:"created_at"`
}
```

#### 1c. Repository interface

New interface in `server/internal/repository/repository.go`:

```go
// RecallEventRepo records and aggregates recall events.
// BulkRecord is best-effort: callers must not propagate errors to clients.
// BulkRecord silently skips MySQL 1146 (table not yet migrated), same pattern
// as SessionRepo.BulkCreate.
// Aggregate returns ErrNotSupported on non-TiDB backends (consistent with
// stubSessionRepo.ListBySessionIDs).
type RecallEventRepo interface {
    BulkRecord(ctx context.Context, events []*domain.RecallEvent) error
    Aggregate(ctx context.Context, f domain.InterestFilter) (*domain.InterestProfile, error)
}
```

TiDB implementation in `server/internal/repository/tidb/recall_events.go`:
- `BulkRecord`: `INSERT IGNORE INTO recall_events (...)` in a single
  prepared-statement batch. Checks `internaltenant.IsTableNotFoundError(err)`
  at both prepare-time and execute-time and silently returns nil (migration window
  safety net, identical to `sessions.go:58`).
- `Aggregate`: runs the tag-frequency and top-queries SQL (see Phase 2). On
  `IsTableNotFoundError`, logs `slog.Error` with cluster ID and error, then returns
  an empty `InterestProfile` — observable in logs, no HTTP 500 to the caller. All
  other errors propagate and surface as HTTP 500.

Factory in `repository/factory.go` — `NewRecallEventRepo(backend, db, clusterID)`:
- Signature matches `NewMemoryRepo` and `NewSessionRepo` — `clusterID string` is
  passed through for log enrichment in the TiDB implementation.
- `"tidb"` / `""` → TiDB implementation (stores `clusterID` as struct field).
- All other backends → `stubRecallEventRepo{}`: no-op `BulkRecord`; `Aggregate`
  returns `ErrNotSupported` (consistent with `stubSessionRepo.ListBySessionIDs`).

#### 1d. Lazy schema migration

New method in `service/tenant.go`, mirroring `EnsureSessionsTable`:

```go
func (s *TenantService) EnsureRecallEventsTable(ctx context.Context, db *sql.DB) error {
    if _, err := db.ExecContext(ctx, tenant.BuildRecallEventsSchema()); err != nil {
        return fmt.Errorf("ensure recall_events table: %w", err)
    }
    return nil
}
```

Uses `CREATE TABLE IF NOT EXISTS` — idempotent for both new tenants and existing
tenants provisioned before this feature shipped. No separate migration runner needed.

Called from `handler/handler.go` inside the same `!loaded` guard that already
calls `EnsureSessionsTable`, with exponential backoff for transient failures:

```go
actual, loaded := s.svcCache.LoadOrStore(key, svc)
if !loaded {
    go func() {
        if err := s.tenant.EnsureSessionsTable(context.Background(), auth.TenantDB); err != nil {
            s.logger.Warn("sessions table migration failed", "tenant", key, "err", err)
        }

        const (
            recallEnsureMaxAttempts = 5
            recallEnsureBaseDelay   = 2 * time.Second
            recallEnsureMaxDelay    = 60 * time.Second
        )
        delay := recallEnsureBaseDelay
        for attempt := 1; attempt <= recallEnsureMaxAttempts; attempt++ {
            ensureCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
            err := s.tenant.EnsureRecallEventsTable(ensureCtx, auth.TenantDB)
            cancel()
            if err == nil {
                break
            }
            s.logger.Warn("EnsureRecallEventsTable failed — will retry",
                "tenant", key, "attempt", attempt, "err", err)
            if attempt == recallEnsureMaxAttempts {
                s.logger.Error("EnsureRecallEventsTable exhausted retries — recall analytics disabled for this process lifetime",
                    "tenant", key, "err", err)
                break
            }
            time.Sleep(delay)
            delay = min(delay*2, recallEnsureMaxDelay)
        }
    }()
}
```

Key properties:
- **5 attempts, exponential backoff** (2 s → 4 s → 8 s → 16 s → cap at 60 s).
- **Process-owned contexts only** — all `context.WithTimeout` calls derive from
  `context.Background()`, not the HTTP request.
- **Per-attempt 10-second timeout** — stalled DB cannot block indefinitely.
- **Terminal `slog.Error` at exhaustion** — degradation persists until process
  restart. During the retry window `BulkRecord` silently drops events and `Aggregate`
  logs an error and returns an empty profile.

#### 1e. Service layer — `RecallService`

Architecture rule: `handler -> service -> repository`. `RecallEventRepo` must not
be wired directly into `resolvedSvc` or called from handlers.

New `server/internal/service/recall.go`:

```go
const recallWriteTimeout = 5 * time.Second

type RecallService struct {
    repo repository.RecallEventRepo
    llm  *llm.Client
}

func NewRecallService(repo repository.RecallEventRepo, llm *llm.Client) *RecallService

// Record builds and persists recall events for one search invocation.
// Best-effort: never returns an error; logs drops internally.
// Must not receive a request context — goroutine outlives the HTTP response.
// requestID is the chi request_id, included in drop logs for access-log correlation
// but NOT stored in the DB; searchID is the internal UUID stored as search_id.
func (s *RecallService) Record(agentID, sessionID, searchID, requestID, query string, results []domain.Memory)

// Interests aggregates recall events into an interest profile.
func (s *RecallService) Interests(ctx context.Context, f domain.InterestFilter) (*domain.InterestProfile, error)
```

`resolvedSvc` gains `recall *service.RecallService` (not the repo).

#### 1f. Async write in the search handler

After `listMemories` sends its response:

```go
// handler/memory.go — inside listMemories, after respond(...)
if filter.Query != "" {
    searchID := uuid.NewString()
    requestID := chimw.GetReqID(r.Context())
    go svc.recall.Record(auth.AgentName, filter.SessionID, searchID, requestID, filter.Query, memories)
}
```

`RecallService.Record` implementation:

```go
func (s *RecallService) Record(agentID, sessionID, searchID, requestID, query string, results []domain.Memory) {
    ctx, cancel := context.WithTimeout(context.Background(), recallWriteTimeout)
    defer cancel()

    events := buildRecallEvents(searchID, query, agentID, sessionID, results)
    if err := s.repo.BulkRecord(ctx, events); err != nil {
        slog.Warn("recall_events write failed — event dropped",
            "search_id", searchID,
            "request_id", requestID,
            "agent_id", agentID,
            "event_count", len(events),
            "err", err)
    }
}
```

Key properties:
- **`recallWriteTimeout = 5 * time.Second`** — package-level constant, no env var,
  consistent with `upload.go`'s `defaultTaskTimeout` pattern.
- **Structured drop logging** with `search_id`, `agent_id`, `event_count`.
- **No retries** — write attempted exactly once per search.
- **Fire-and-forget** — same durability contract as the existing session raw save
  goroutine. Analytics loss is acceptable; drops never affect search correctness.

The goroutine only fires when `filter.Query != ""`.

---

### Phase 2 — Interest profile API (~250 LoC)

#### New endpoint

```
GET /v1alpha1/mem9s/{tenantID}/memories/interests
GET /v1alpha2/mem9s/memories/interests
```

Registered before the `{id}` route in both route groups to avoid the wildcard
capturing the literal segment `"interests"`.

#### Query parameters

| Param | Type | Default | Validation | Description |
|-------|------|---------|------------|-------------|
| `from` | RFC 3339 | 7 days ago | Must parse; if after `to`, returns `ValidationError` | Start of aggregation window |
| `to` | RFC 3339 | now | Must parse | End of aggregation window |
| `top` | int | 20 | 1–100; out-of-range clamped | Max tags to return |
| `agent_id` | string | `X-Mnemo-Agent-Id` header | No constraints | Filter to specific agent; empty = all agents |

`agent_id` default resolution lives in the **handler**, not `RecallService`. The
handler reads `?agent_id=` from the query param; if absent, falls back to
`auth.AgentName` (resolved from `X-Mnemo-Agent-Id` header by `authInfo`). The
resolved value is passed in `InterestFilter.AgentID`. `RecallService.Interests`
receives it ready-to-use — same pattern as `listMemories` using `auth.AgentName`.
| `include_queries` | bool | `false` | Only `"true"` is truthy | Include `top_queries` block |
| `include_summary` | bool | `false` | Only `"true"` is truthy | Request LLM-generated `topic_summary` |

Parse and error matrix:

| Param | Input | Outcome | HTTP | `ValidationError` message |
|-------|-------|---------|------|--------------------------|
| `from` | absent | default: `now - 7 days` | — | — |
| `from` | unparseable | reject | 400 | `Field:"from", Message:"invalid RFC 3339 timestamp"` |
| `from` | after `to` | reject | 400 | `Field:"from", Message:"must be before to"` |
| `to` | absent | default: `now` | — | — |
| `to` | unparseable | reject | 400 | `Field:"to", Message:"invalid RFC 3339 timestamp"` |
| `top` | absent | default: `20` | — | — |
| `top` | non-numeric | reject | 400 | `Field:"top", Message:"must be an integer"` |
| `top` | `< 1` | clamp to `1` | — | — |
| `top` | `> 100` | clamp to `100` | — | — |
| `include_queries` | `"true"` | `true` | — | — |
| `include_queries` | anything else | `false` | — | — |
| `include_summary` | `"true"` | `true` | — | — |
| `include_summary` | anything else | `false` | — | — |

#### Response

```json
{
  "period": {
    "from": "2026-03-13T00:00:00Z",
    "to":   "2026-03-20T23:59:59Z"
  },
  "agent_id": "alice",
  "tag_profile": [
    {
      "tag": "go",
      "recall_count": 142,
      "unique_queries": 38,
      "memory_types": { "insight": 80, "session": 62 }
    }
  ],
  "top_queries": [
    {
      "query_hash": "abc123",
      "sample_query": "How to debug OOM in TiKV?",
      "count": 12
    }
  ],
  "topic_summary": "..."
}
```

- `top_queries` omitted when `include_queries=false`; when `true` always a JSON
  array (possibly empty `[]`).
- `topic_summary` omitted when `include_summary=false` or `llm == nil`.

#### SQL aggregation

Tag frequency (uses TiDB's `JSON_TABLE` to expand the tags array):

```sql
SELECT tag.value                    AS tag,
       COUNT(*)                     AS recall_count,
       COUNT(DISTINCT query_hash)   AS unique_queries,
       SUM(memory_type = 'insight') AS insight_count,
       SUM(memory_type = 'session') AS session_count,
       SUM(memory_type = 'pinned')  AS pinned_count
FROM recall_events,
     JSON_TABLE(tags, '$[*]' COLUMNS (value VARCHAR(100) PATH '$')) AS tag
WHERE created_at BETWEEN ? AND ?
  AND (? = '' OR agent_id = ?)
GROUP BY tag.value
ORDER BY recall_count DESC
LIMIT ?
```

Top queries (only when `include_queries=true`):

```sql
SELECT query_hash,
       MIN(query)                AS sample_query,
       COUNT(DISTINCT search_id) AS count
FROM recall_events
WHERE created_at BETWEEN ? AND ?
  AND (? = '' OR agent_id = ?)
GROUP BY query_hash
ORDER BY count DESC
LIMIT 10
```

`count` is `COUNT(DISTINCT search_id)` — distinct search invocations, not recalled
items.

#### Implementation path

`Aggregate` lives on `RecallEventRepo` (SQL is pure storage logic). `RecallService.Interests`
owns defaulting, validation, and the optional LLM summary call. The handler parses
params, calls `svc.recall.Interests(ctx, filter)`, writes the response.

New domain types in `server/internal/domain/types.go`:

```go
type InterestFilter struct {
    From           time.Time
    To             time.Time
    AgentID        string
    Top            int
    IncludeQueries bool
    IncludeSummary bool
}

type TagStat struct {
    Tag           string         `json:"tag"`
    RecallCount   int            `json:"recall_count"`
    UniqueQueries int            `json:"unique_queries"`
    MemoryTypes   map[string]int `json:"memory_types"`
}

type QueryStat struct {
    QueryHash   string `json:"query_hash"`
    SampleQuery string `json:"sample_query"`
    Count       int    `json:"count"`
}

type PeriodRange struct {
    From time.Time `json:"from"`
    To   time.Time `json:"to"`
}

type InterestProfile struct {
    Period       PeriodRange `json:"period"`
    AgentID      string      `json:"agent_id,omitempty"`
    TagProfile   []TagStat   `json:"tag_profile"`
    TopQueries   []QueryStat `json:"top_queries,omitempty"`
    TopicSummary string      `json:"topic_summary,omitempty"`
}
```

`stubRecallEventRepo.Aggregate` returns `ErrNotSupported` → HTTP 501.

---

### Phase 3 — LLM topic summary (~80 LoC, optional)

When `include_summary=true` and `s.llm != nil`, `RecallService.Interests` calls
an internal `summarize(ctx, profile)` method:

```
Given the following recall analytics for an AI agent over the past N days,
write a 1–2 sentence summary of what the agent was primarily working on.

Tags (by frequency): go (142 recalls), debug (97), tidb (65), kubernetes (41) ...
```

The summary is appended as `topic_summary`. If the LLM call fails, the response
is returned without the field — aggregated data is never blocked by a summary
failure.

Gating conditions (all must be true):
1. `include_summary=true` in request
2. `s.llm != nil` (configured via `MNEMO_LLM_BASE_URL` + `MNEMO_LLM_API_KEY`)
3. `len(profile.TagProfile) > 0` (nothing to summarise for an empty window)

---

## Design Decisions

**No search path latency impact.** The goroutine fires after `respond(...)` returns.
Same fire-and-forget contract as the existing session raw save goroutine. No
graceful shutdown drain added — consistent with current codebase posture.

**`search_id` is an internal server-generated UUID, not the chi `request_id`.**
`uuid.NewString()` is called in the handler before the goroutine fires. The chi
`request_id` is intentionally not used as `search_id` — chi accepts inbound
`X-Request-Id` verbatim (line 70, `middleware/request_id.go`), so a caller sending
the same header on every request would stamp all rows with the same `search_id`,
breaking `COUNT(DISTINCT search_id)` semantics. The chi `request_id` is instead
passed to `RecallService.Record` as a separate `requestID` argument, included only
in drop-log entries for access-log correlation — it is never stored in the DB.

**Tags as a snapshot, not a foreign key.** Storing tags at recall time means later
tag edits on a memory do not retroactively alter analytics. The interest profile
reflects what the agent actually saw.

**`query_hash` instead of full-text grouping.** SHA-256 of the full raw query
string, stored as a fixed 64-char hex column. Grouping repeated queries is an O(1)
index scan. `MIN(query)` recovers display text at aggregation time. Case-sensitive;
no normalisation. Query stored verbatim as `TEXT` — no truncation.

**Query storage and privacy.** The `query` column is duplicated once per recalled
item — a 20-result search stores the same query string 20 times. At ~100 bytes
average query length: 100 searches/day × 20 results × 365 days ≈ 73 MB/tenant/year
in query text. Combined with all other columns (~200 bytes/row), total storage is
~146 MB/tenant/year — negligible on TiDB Cloud Serverless (25 GiB free tier).
Queries persist indefinitely (no retention policy). Tenants should be aware their
search queries are stored verbatim. A future per-tenant opt-out can zero the `query`
column on insert while preserving `query_hash` — aggregation semantics are
unaffected since all grouping uses `query_hash`; only the `sample_query` display
field in `top_queries` would become empty.

**`rank` dropped.** Plugins regroup results by `memory_type` before prompt injection,
discarding server response order. `score` captures the only meaningful retrieval
quality signal.

**`listMemories` is the only hook point.** `bootstrapMemories`, `MemoryService.Bootstrap`,
and `MemoryRepo.ListBootstrap` are dead code (handler not registered in router) and
have been marked `// Deprecated:` in their respective files. No other handler calls
`Search()`.

**`agent_id` default resolution is the handler's responsibility.** The `getInterests`
handler reads `?agent_id=` from the query param; if absent, falls back to
`auth.AgentName` (from `X-Mnemo-Agent-Id` header). The resolved value is placed in
`InterestFilter.AgentID` before calling `RecallService.Interests`. The service
receives it ready-to-use — it owns defaulting for `from`, `to`, and `top`, but not
identity fields that require HTTP context.

**`NewRecallEventRepo` takes `clusterID string`.** Consistent with `NewMemoryRepo`
and `NewSessionRepo`. The TiDB implementation stores it as a struct field and
includes it in `slog.Error` calls from `Aggregate` for log-based tenant diagnosis.

**Service layer owns all recall logic.** `handler -> service -> repository`.
`RecallService` is the single entry point for `Record` and `Interests`. Handlers
never call `RecallEventRepo` directly.

**Graceful degradation — writes.** Three layers: (1) MySQL 1146 → `BulkRecord`
silently returns nil. (2) `recallWriteTimeout = 5 * time.Second` package-level
constant — goroutine exits at deadline if DB stalls. No env var; consistent with
`upload.go`'s `defaultTaskTimeout` pattern. (3) Every drop logged via `slog.Warn`
with `search_id`, `agent_id`, `event_count`.

**Graceful degradation — reads.** On `IsTableNotFoundError`, `Aggregate` logs
`slog.Error` (observable for diagnosing migration failures) and returns an empty
`InterestProfile` — no HTTP 500 to the caller. All other DB errors propagate as
HTTP 500. The retry-with-backoff in the `!loaded` goroutine minimises the window
during which the table is absent.

**Non-TiDB backends.** `stubRecallEventRepo.BulkRecord` is a silent no-op.
`stubRecallEventRepo.Aggregate` returns `ErrNotSupported` → HTTP 501. Consistent
with `stubSessionRepo`: writes no-op, dedicated reads return 501.

**No retention policy.** `recall_events` rows accumulate indefinitely. Analytics
data is more valuable over time. At ~200 bytes/row, 100 searches/day × 20 results
× 365 days ≈ 146 MB/tenant/year — negligible on TiDB Cloud Serverless (25 GiB
free tier). Revisit only if storage cost becomes a real concern at scale.

**Route ordering.** `/memories/interests` must be registered before `/memories/{id}`
in both route groups. Chi matches routes in registration order.

**Write-path alternatives considered.**

| Option | Durability | Latency impact | Complexity | Decision |
|--------|-----------|----------------|------------|----------|
| **Best-effort async (chosen)** — goroutine + 5 s timeout, drop on failure | Low | Zero | Low | Chosen: analytics loss acceptable, search must never stall |
| **Durable in-process queue** — buffered channel + retry worker | Medium | Zero | Medium | Rejected for Phase 1; upgrade path if drop rate proves unacceptable |
| **Synchronous write before respond** | High | ~1–5 ms per search | Low | Rejected: violates zero latency impact constraint |
| **External queue (Kafka / SQS)** | High | Near-zero | High | Rejected: out of scope for single-server serverless-DB deployment |

The durable queue option requires only adding a bounded `chan []*domain.RecallEvent`
and a retry worker in `RecallService` — no schema changes.

---

## Files Changed

| File | Change |
|------|--------|
| `server/internal/domain/types.go` | Add `RecallEvent`, `InterestFilter`, `TagStat`, `QueryStat`, `PeriodRange`, `InterestProfile` |
| `server/internal/tenant/schema.go` | Add `BuildRecallEventsSchema()` |
| `server/internal/repository/repository.go` | Add `RecallEventRepo` interface (`BulkRecord` + `Aggregate`) |
| `server/internal/repository/tidb/recall_events.go` | New: TiDB impl; `BulkRecord` skips 1146 silently; `Aggregate` logs error + returns empty on 1146 |
| `server/internal/repository/factory.go` | Add `NewRecallEventRepo(backend, db, clusterID)` + `stubRecallEventRepo` |
| `server/internal/service/recall.go` | New: `RecallService` with `Record`, `Interests`, `summarize` |
| `server/internal/service/tenant.go` | Add `EnsureRecallEventsTable(ctx, db)` |
| `server/internal/handler/handler.go` | Add `recall *service.RecallService` to `resolvedSvc`; wire in `resolveServices`; register `/memories/interests` before `{id}`; call `EnsureRecallEventsTable` with retry in `!loaded` goroutine |
| `server/internal/handler/memory.go` | Fire `svc.recall.Record` goroutine in `listMemories`; add `getInterests` handler |

---

## LoC Estimate

| Phase | Scope | Est. LoC |
|-------|-------|----------|
| Phase 1 | Schema, domain type, repo interface + TiDB impl, factory stub, lazy migration + retry, handler goroutine | ~180 |
| Phase 2 | `Aggregate` SQL, domain response types, `getInterests` handler | ~250 |
| Phase 3 | `RecallService.summarize`, LLM prompt, gating | ~80 |
| Tests | Unit tests for `buildRecallEvents`, `Aggregate` SQL, handler | ~100 |
| **Total** | | **~610 LoC** |

---

## Open Questions

1. **Tag normalisation.** LLM-generated tags have free-form vocabulary (`"golang"`
   vs `"go"`, `"kubernetes"` vs `"k8s"`). The interest profile surfaces these as
   separate entries. Synonym merging is a Phase 3+ concern — defer until production
   data reveals which synonyms actually appear.

2. **Recall event scope.** Should recall events be recorded for `GET /memories/{id}`
   (get-by-ID)? The issue only mentions search, and get-by-ID has no query text.
   Propose: search-only for now, revisit if direct-fetch analytics become valuable.
