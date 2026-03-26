---
title: "Proposal: GET /session-messages Batch Read API (Issue #110)"
status: implemented
created: 2026-03-19
last_updated: 2026-03-25
---

> **STATUS: IMPLEMENTED** (PR #114)
> `handleListSessionMessages`, `sessionMessageResponse` DTO, `dedupStrings`,
> `ListBySessionIDs` on `SessionRepo`/`SessionService`, `stubSessionRepo`,
> and `ErrNotSupported` → HTTP 501 mapping are all in place.
> Routes registered on both `v1alpha1` and `v1alpha2`.

## Problem

mem9 persists raw conversation messages into the `sessions` table on each
`POST /ingest` call. The row schema includes `session_id`, `role`, `content`, `seq`,
`content_type`, `content_hash`, `tags`, `state`, `created_at`, and `updated_at`.

There is currently **no read API** for these rows. The only retrieval path is
`GET /memories`, which returns processed, deduplicated `Memory` objects — not
raw session rows. Clients that need to inspect what was stored for a given session
(debugging, approximate context review) have no direct way to do so.

Issue #110 proposes adding `GET /session-messages` to close this gap.

### Data model limitations

Callers should be aware of two constraints before using this endpoint:

**Deduplication.** Rows are stored with `INSERT IGNORE` keyed on
`(session_id, content_hash)`, where `content_hash = SHA-256(sessionID+role+content)`.
Identical `role+content` pairs within the same session produce only one row. This
endpoint returns exactly what was stored — it does **not** guarantee a faithful
transcript if the agent sent duplicate turns.

**Tail-window capture.** The OpenClaw integration uploads a recent tail window of
the conversation subject to byte and message caps. Older turns that exceeded the
cap at ingest time are never persisted. Other integrations (Claude, OpenCode) do
not implement raw session ingest today. The stored messages therefore represent
an approximate recent slice of what OpenClaw captured, not a full cross-plugin
conversation history.

---

## Proposed API

```
GET /v1alpha1/mem9s/{tenantID}/session-messages?session_id=a&session_id=b&limit_per_session=2
GET /v1alpha2/mem9s/session-messages?session_id=a&session_id=b&limit_per_session=2
```

### Query parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `session_id` | string (repeatable) | Yes | One or more session IDs; max 100 distinct values |
| `limit_per_session` | integer | No | Max messages per session; defaults to 500; capped at 500 |

### Response

```json
{
  "messages": [
    {
      "id": "...",
      "session_id": "abc",
      "agent_id": "...",
      "source": "...",
      "seq": 0,
      "role": "user",
      "content": "...",
      "content_type": "text",
      "tags": [],
      "state": "active",
      "created_at": "2026-03-19T10:00:00Z",
      "updated_at": "2026-03-19T10:00:00Z"
    }
  ],
  "limit_per_session": 500
}
```

- Flat `messages[]` array; `session_id` included on every item for client-side grouping.
- Ordered by `session_id ASC, created_at ASC, seq ASC, id ASC`.
- Only `state = 'active'` rows returned; deleted rows are always hidden.
- Unknown `session_id` values return an empty array — no 404.
- Duplicate `session_id` params are deduplicated before querying.
- `limit_per_session` in the response reflects the effective value applied (caller's value or 500 default).

---

## Design decisions

### Return a response DTO, not `[]domain.Memory` or `[]*domain.Session`

The existing search methods on `SessionRepo` return `[]domain.Memory` because the
search pipeline feeds into RRF merge and needs score fields. A raw list endpoint has
no use for score, `relative_age`, or the `metadata` JSON envelope that `fillSessionMemory`
currently synthesises from `role`, `seq`, and `content_type`.

Using `[]*domain.Session` directly would be cleaner, but `domain.Session` carries
`ContentHash` — an internal deduplication key (SHA-256 of `sessionID+role+content`)
used by `BulkCreate`'s `INSERT IGNORE`. It must not be exposed in API responses.
Adding `json:"-"` to `domain.Session.ContentHash` would break internal code that
marshals sessions for debugging or logging.

Instead, the handler uses a response-only DTO:

```go
// sessionMessageResponse is the wire shape for a single session message.
// ContentHash is intentionally omitted — it is an internal deduplication key.
type sessionMessageResponse struct {
    ID          string             `json:"id"`
    SessionID   string             `json:"session_id,omitempty"`
    AgentID     string             `json:"agent_id,omitempty"`
    Source      string             `json:"source,omitempty"`
    Seq         int                `json:"seq"`
    Role        string             `json:"role"`
    Content     string             `json:"content"`
    ContentType string             `json:"content_type"`
    Tags        []string           `json:"tags"`
    State       domain.MemoryState `json:"state"`
    CreatedAt   time.Time          `json:"created_at"`
    UpdatedAt   time.Time          `json:"updated_at"`
}
```

The repo/service layers still work with `[]*domain.Session` internally.
The handler maps to `[]sessionMessageResponse` before calling `respond()`.

### Route registered on all backends; non-TiDB returns HTTP 501

`factory.go:NewSessionRepo` currently panics for non-TiDB backends. That panic fires
lazily on the **first incoming request** (not at startup), because `resolveServices`
is called per-request. A postgres or db9 server would start cleanly, pass health
checks, and then crash the handling goroutine on the first request to **any memory
endpoint** — not just session-messages — caught by `chi.Recoverer` as HTTP 500.

**This is a pre-existing bug that this PR fixes as a deliberate side effect.**
Replacing the panic with `stubSessionRepo` restores correct behaviour for all memory
handlers on postgres/db9 (create, list, get, update, delete, ingest). The stub's
write and search methods return `nil`/empty results, matching the existing
`IsTableNotFoundError` silent-skip pattern used throughout the TiDB repo. Only
`ListBySessionIDs` returns `ErrNotSupported`, since that is the only read path
where an empty result would be misleading rather than a safe degradation.

Reviewers with postgres/db9 deployments should verify the stub behaviour covers
their existing memory handler paths. The stub should be explicitly tested:
all non-`ListBySessionIDs` methods return no error, `FTSAvailable()` returns false.

### Add `ErrNotSupported` sentinel

`domain/errors.go` has no `ErrNotSupported`. This PR adds it and wires it for the
session-messages path only:

```go
// domain/errors.go — add alongside existing sentinels
ErrNotSupported = errors.New("not supported")
```

```go
// handler/handler.go — add to handleError switch
case errors.Is(err, domain.ErrNotSupported):
    respondError(w, http.StatusNotImplemented, err.Error())
```

Note: `postgres.AutoVectorSearch` and `db9.AutoVectorSearch` already return bare
`fmt.Errorf` strings for unsupported operations, which currently fall through
`handleError` to HTTP 500. Migrating those callers to `ErrNotSupported` is a
clean-up that is **out of scope for this PR** — it should be a separate issue to
avoid expanding the blast radius of this change.

### `limit_per_session`: default 500, hard cap 500, always applied in SQL

`limit_per_session` is optional in the spec but must always be bounded server-side
to prevent unbounded result sets. The rule is simple:

- If not provided → use 500
- If provided but exceeds 500 → cap at 500
- If provided and ≤ 500 → use as-is

```go
const maxLimitPerSession = 500

if limitPerSession <= 0 || limitPerSession > maxLimitPerSession {
    limitPerSession = maxLimitPerSession
}
```

Because `limitPerSession` is always set before hitting SQL, the implementation uses
a **single SQL path** — the `ROW_NUMBER() OVER (PARTITION BY session_id ...)` window
function always runs. This eliminates the two-path complexity (plain `WHERE IN` vs.
windowed subquery) at negligible cost: the common case of "give me all messages"
simply uses `rn <= 500` which TiDB optimises efficiently.

The effective `limit_per_session` value is returned in the response payload so
callers can distinguish "I got everything" from "I got the first 500".

### Hard cap on `session_id` count: 100

Without a cap on distinct `session_id` values, a caller could pass 1000 IDs and
generate a `WHERE session_id IN (?, ... x1000)` query. The cap is applied **after**
deduplication — 150 params that collapse to 80 unique IDs are accepted.

```go
const maxSessionIDs = 100

sessionIDs := dedupStrings(rawIDs)
if len(sessionIDs) > maxSessionIDs {
    s.handleError(w, &domain.ValidationError{
        Field:   "session_id",
        Message: "too many session_ids: maximum is 100",
    })
    return
}
```

---

## Implementation plan

### 1. Add `ErrNotSupported` to `domain/errors.go`

```go
var (
    ErrNotFound      = errors.New("not found")
    ErrConflict      = errors.New("version conflict")
    ErrDuplicateKey  = errors.New("duplicate key")
    ErrValidation    = errors.New("validation error")
    ErrWriteConflict = errors.New("write conflict, retry")
    ErrNotSupported  = errors.New("not supported")   // ← new
)
```

### 2. Map `ErrNotSupported` → HTTP 501 in `handler/handler.go`

```go
func (s *Server) handleError(w http.ResponseWriter, err error) {
    switch {
    // ... existing cases ...
    case errors.Is(err, domain.ErrNotSupported):
        respondError(w, http.StatusNotImplemented, err.Error())
    // ...
    }
}
```

### 3. Add no-op `stubSessionRepo` in `repository/factory.go`

Replaces the panic. All write/search methods return `nil` (matching the existing
`IsTableNotFoundError` silent-skip behaviour). Only `ListBySessionIDs` returns
`ErrNotSupported`, since that is the only read path that would otherwise surface
a meaningless empty result rather than a clear error.

```go
// stubSessionRepo satisfies SessionRepo for non-TiDB backends.
// Write and search operations are silently skipped (consistent with the
// IsTableNotFoundError no-op pattern). ListBySessionIDs returns ErrNotSupported
// so the handler can return HTTP 501 instead of a misleading empty result.
type stubSessionRepo struct{}

func (stubSessionRepo) BulkCreate(_ context.Context, _ []*domain.Session) error { return nil }
func (stubSessionRepo) PatchTags(_ context.Context, _, _ string, _ []string) error { return nil }
func (stubSessionRepo) AutoVectorSearch(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
    return nil, nil
}
func (stubSessionRepo) VectorSearch(_ context.Context, _ []float32, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
    return nil, nil
}
func (stubSessionRepo) FTSSearch(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
    return nil, nil
}
func (stubSessionRepo) KeywordSearch(_ context.Context, _ string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
    return nil, nil
}
func (stubSessionRepo) FTSAvailable() bool { return false }
func (stubSessionRepo) ListBySessionIDs(_ context.Context, _ []string, _ int) ([]*domain.Session, error) {
    return nil, fmt.Errorf("session messages: %w", domain.ErrNotSupported)
}

func NewSessionRepo(backend string, db *sql.DB, autoModel string, ftsEnabled bool, clusterID string) SessionRepo {
    switch backend {
    case "tidb", "":
        return tidb.NewSessionRepo(db, autoModel, ftsEnabled, clusterID)
    default:
        return stubSessionRepo{}
    }
}
```

### 4. `SessionRepo` interface — add `ListBySessionIDs`

File: `server/internal/repository/repository.go`

```go
// ListBySessionIDs returns raw session messages for the given session IDs.
// If limitPerSession > 0, at most that many messages are returned per session.
// Results are ordered by session_id ASC, created_at ASC, seq ASC, id ASC.
// Returns ErrNotSupported on backends that do not have a sessions table.
ListBySessionIDs(ctx context.Context, sessionIDs []string, limitPerSession int) ([]*domain.Session, error)
```

### 5. TiDB implementation — `tidb.SessionRepo`

File: `server/internal/repository/tidb/sessions.go`

Single SQL path — `ROW_NUMBER()` window function always applied:

```sql
SELECT id, session_id, agent_id, source, seq, role, content, content_type,
       content_hash, tags, state, created_at, updated_at
FROM (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY session_id
      ORDER BY created_at ASC, seq ASC, id ASC
    ) AS rn
  FROM sessions
  WHERE session_id IN (?, ...) AND state = 'active'
) t
WHERE rn <= ?
ORDER BY session_id ASC, created_at ASC, seq ASC, id ASC
```

`limitPerSession` is always a positive integer (normalised by the handler before
the service call). Placeholders built with `strings.Repeat("?,", n)` sliced to
remove the trailing comma — same pattern as `tidb/memory.go`.

A new `scanSessionDomainRows` helper scans directly into `[]*domain.Session`,
bypassing the `domain.Memory` projection used by existing search methods.

### 6. Service layer — `SessionService`

File: `server/internal/service/session.go`

Thin pass-through; no enrichment (no embedding, no `relative_age`):

```go
func (s *SessionService) ListBySessionIDs(
    ctx context.Context,
    sessionIDs []string,
    limitPerSession int,
) ([]*domain.Session, error) {
    return s.sessions.ListBySessionIDs(ctx, sessionIDs, limitPerSession)
}
```

### 7. Handler — `handleListSessionMessages`

File: `server/internal/handler/memory.go`

```go
const (
    maxLimitPerSession = 500
    maxSessionIDs      = 100
)

func (s *Server) handleListSessionMessages(w http.ResponseWriter, r *http.Request) {
    auth := authInfo(r)
    svc := s.resolveServices(auth)

    rawIDs := r.URL.Query()["session_id"]
    if len(rawIDs) == 0 {
        s.handleError(w, &domain.ValidationError{
            Field: "session_id", Message: "at least one session_id required",
        })
        return
    }
    sessionIDs := dedupStrings(rawIDs)
    if len(sessionIDs) > maxSessionIDs {
        s.handleError(w, &domain.ValidationError{
            Field: "session_id", Message: "too many session_ids: maximum is 100",
        })
        return
    }

    limitPerSession := maxLimitPerSession
    if raw := r.URL.Query().Get("limit_per_session"); raw != "" {
        n, err := strconv.Atoi(raw)
        if err != nil || n < 1 {
            s.handleError(w, &domain.ValidationError{
                Field: "limit_per_session", Message: "must be a positive integer",
            })
            return
        }
        if n < limitPerSession {
            limitPerSession = n
        }
    }

    sessions, err := svc.session.ListBySessionIDs(r.Context(), sessionIDs, limitPerSession)
    if err != nil {
        s.handleError(w, err)
        return
    }
    if sessions == nil {
        sessions = []*domain.Session{}
    }
    messages := make([]sessionMessageResponse, len(sessions))
    for i, s := range sessions {
        messages[i] = sessionMessageResponse{
            ID:          s.ID,
            SessionID:   s.SessionID,
            AgentID:     s.AgentID,
            Source:      s.Source,
            Seq:         s.Seq,
            Role:        s.Role,
            Content:     s.Content,
            ContentType: s.ContentType,
            Tags:        s.Tags,
            State:       s.State,
            CreatedAt:   s.CreatedAt,
            UpdatedAt:   s.UpdatedAt,
        }
    }
    respond(w, http.StatusOK, map[string]any{
        "messages":          messages,
        "limit_per_session": limitPerSession,
    })
}

func dedupStrings(ss []string) []string {
    seen := make(map[string]struct{}, len(ss))
    out := ss[:0]
    for _, s := range ss {
        if _, ok := seen[s]; !ok {
            seen[s] = struct{}{}
            out = append(out, s)
        }
    }
    return out
}
```

### 8. Route registration

File: `server/internal/handler/handler.go` — `Router()` method

```go
// v1alpha1
r.Route("/v1alpha1/mem9s/{tenantID}", func(r chi.Router) {
    r.Use(tenantMW)
    // ... existing routes ...
    r.Get("/session-messages", s.handleListSessionMessages)
})

// v1alpha2
r.Route("/v1alpha2/mem9s", func(r chi.Router) {
    r.Use(apiKeyMW)
    // ... existing routes ...
    r.Get("/session-messages", s.handleListSessionMessages)
})
```

Route is registered unconditionally on all backends. Non-TiDB deployments receive
HTTP 501 via the `stubSessionRepo` → `ErrNotSupported` → `handleError` chain.

---

## Files changed

| File | Change |
|---|---|
| `server/internal/domain/errors.go` | Add `ErrNotSupported` sentinel |
| `server/internal/repository/repository.go` | Add `ListBySessionIDs` to `SessionRepo` interface |
| `server/internal/repository/factory.go` | Replace panic with `stubSessionRepo`; add stub type |
| `server/internal/repository/tidb/sessions.go` | Implement `ListBySessionIDs` + `scanSessionDomainRows` helper |
| `server/internal/service/session.go` | Add `ListBySessionIDs` pass-through |
| `server/internal/handler/handler.go` | Add `ErrNotSupported` → 501 to `handleError`; register route on both route groups |
| `server/internal/handler/memory.go` | Add `handleListSessionMessages`, `sessionMessageResponse` DTO, `dedupStrings` |

No schema changes. No auth changes.

---

## Effort estimate

~120 LoC net (production code only, excluding tests).

---

## Edge cases

| Case | Handling |
|---|---|
| Unknown `session_id` | Returns empty array; no 404 |
| Duplicate `session_id` params | Deduplicated before SQL query |
| More than 100 distinct `session_id` values | HTTP 400 after dedup |
| `state != 'active'` rows | Filtered by `WHERE state = 'active'`; deleted rows always hidden |
| `limit_per_session` not provided | Defaults to 500 |
| `limit_per_session` exceeds 500 | Capped at 500 |
| `limit_per_session < 1` or non-integer | HTTP 400 with field validation error |
| Zero `session_id` params | HTTP 400 with field validation error |
| `IsTableNotFoundError` (lazy migration) | SQL returns `nil, nil`; handler returns empty `messages[]` |
| postgres or db9 backend | HTTP 501 via `stubSessionRepo` → `ErrNotSupported` |

---

## Test plan

### Handler validation (unit tests, `handler/memory_test.go`)

| Case | Expected |
|---|---|
| No `session_id` param | HTTP 400, field=`session_id` |
| `limit_per_session=0` | HTTP 400, field=`limit_per_session` |
| `limit_per_session=-1` | HTTP 400, field=`limit_per_session` |
| `limit_per_session=abc` | HTTP 400, field=`limit_per_session` |
| 101 distinct `session_id` values | HTTP 400, field=`session_id` |
| 150 params collapsing to 80 unique | HTTP 200, accepted |
| `limit_per_session` omitted | response `limit_per_session=500` |
| `limit_per_session=600` | response `limit_per_session=500` (capped) |
| `limit_per_session=10` | response `limit_per_session=10` |

### TiDB repository (unit tests, `repository/tidb/sessions_test.go`)

| Case | Expected |
|---|---|
| Single session, messages ordered by `created_at ASC, seq ASC, id ASC` | Correct order |
| Two sessions in one request | Results interleaved correctly by `session_id ASC` then time |
| `limitPerSession=2`, session has 5 rows | Returns first 2 per session |
| Unknown `session_id` | Returns empty slice, no error |
| Duplicate `session_id` values in input | Deduped before SQL; no duplicate rows |

### Table-not-found path (unit test)

When `IsTableNotFoundError` is returned by TiDB (lazy migration not yet run),
`ListBySessionIDs` returns `nil, nil` and the handler responds HTTP 200 with
`"messages": []`.

### 501 fallback (unit test, `repository/factory_test.go` or handler test)

`stubSessionRepo.ListBySessionIDs` returns `ErrNotSupported`. Handler maps it to
HTTP 501. All other `stubSessionRepo` methods (`BulkCreate`, `PatchTags`, search
methods) return `nil`/`nil, nil` — verified they do not panic or error.

---

## Out of scope

- Cursor/offset pagination
- Filtering by role, date range, or tags
- Surfacing `state=deleted` rows
- Session-level metadata (title, summary)
- Cross-tenant access
- postgres / db9 backend support
