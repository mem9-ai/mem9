---
title: proposal — raw session storage
status: implemented
created: 2026-03-10
last_updated: 2026-03-25
---

> **STATUS: IMPLEMENTED** (PR #103)
> `sessions` table, `SessionRepo`, `SessionService`, content-hash deduplication
> (`INSERT IGNORE`), parallel goroutine raw-save in `handler/memory.go`,
> and unified search append are all in place.
> Phase 2 (LLM-generated tags via `ExtractPhase1`/`PatchTags`) is also
> implemented — `service/ingest.go` exposes `ExtractPhase1`/`ReconcilePhase2`.

## Problem

When `POST /memories` is called with `messages`, the smart ingest pipeline
immediately discards the original conversation. If:

- The LLM extraction misses facts or makes wrong reconciliation decisions,
- The pipeline is re-run later with improved prompts or models,
- A bug causes partial processing that needs replay,
- A developer needs to audit exactly what an agent sent,

…there is no way to recover the original input. The raw session is gone.

## Goal

Persist each raw session message-by-message into a dedicated `sessions`
table in the tenant database, in parallel with smart ingest. Enable unified
search that appends session results after memory results in `GET /memories`.

**Scope of raw storage**: the table stores a *deduplicated message set* —
not a verbatim append log. Two sends of the same message content within the
same session produce one row. This is a deliberate trade-off: the plugin
sends overlapping cumulative slices on every turn (verified against OpenClaw
source), so verbatim logging would multiply every message N times. The
deduplication key is `SHA-256(session_id + role + content)`; identical
content from different sessions or different roles always produces distinct
rows.

## Non-Goals

- Re-ingestion pipeline triggered from stored sessions (future work)
- A dedicated sessions read API (unified search covers the use case)
- Changes to the file import path (`POST /imports` / upload worker)

---

## Data Model

### Why message-by-message

The plugin (`openclaw-plugin/hooks.ts:347`) calls `backend.ingest()` with
a **selected slice** of messages (up to 200KB budget), not a single blob.
Storing each message as its own row gives:

- Granular FTS/vector search per message
- No single-row size problem for long sessions

### ⚠ Fragile design point: deduplication

**Background — how `agent_end` actually works (verified against OpenClaw source):**

`agent_end` fires **once per user turn**, not once per session. In a
10-turn session it fires 10 times. Source: `attempt.ts:1788` — the hook
fires at the end of `runEmbeddedAttempt()`, which processes one inbound
prompt.

`messages` passed to the hook is **cumulative** — it is
`activeSession.messages.slice()`, a snapshot of the full session buffer
backed by a persistent on-disk file (`SessionManager.open(params.sessionFile)`).
Every turn appends to that file. Source: `attempt.ts:1746, 1756`.

So the sequence for a 3-turn session looks like:

```
Turn 1: agent_end → messages = [U1, A1]
Turn 2: agent_end → messages = [U1, A1, U2, A2]
Turn 3: agent_end → messages = [U1, A1, U2, A2, U3, A3]
```

`selectMessages` (`hooks.ts:72`) then trims to ≤200KB / ≤20 messages from
the tail. For short sessions the trimmed slice still overlaps heavily
across turns — U1 and A1 appear in every call until they age out of the
200KB window.

**Why slice index cannot be used as a stable offset:**

Three mechanisms mutate `activeSession.messages` between turns, making
indices unreliable:

1. **History limit truncation** (`history.ts:15`, `limitHistoryTurns`):
   every turn drops old messages from the front to stay within the
   configured turn limit. `U3` at index 4 last turn may be at index 0
   this turn.

2. **Compaction** (`compact.ts:616`, `replaceMessages`): when the context
   window fills up, the entire messages array is replaced with a compacted
   version — typically a single summary message plus recent turns. All
   prior indices are invalidated.

3. **`selectMessages` tail trim** (`hooks.ts:72`): the plugin already
   trims to the tail before sending; the server sees no indication of
   where in the full conversation the slice starts.

There is **no offset field** in `PluginHookAgentEndEvent`
(`plugins/types.ts:509`). The full type is:

```typescript
type PluginHookAgentEndEvent = {
  messages: unknown[];
  success: boolean;
  error?: string;
  durationMs?: number;   // duration of THIS turn only — not usable as index
};
```

No `offset`, `startIndex`, `totalMessages`, or any positional field.

**sessionId stability:**

`sessionId` (`params.sessionId`) is a `randomUUID()` generated once per
session and stored in the session store on disk (`sessions.ts:515`). It is
**stable across all turns** of the same session. It only changes on an
explicit `/reset` or `/new` command.

The instability in the plugin is the last-resort fallback
(`hooks.ts:339`):

```typescript
const sessionId = nonEmptyString(evt.sessionId)
  ?? nonEmptyString(hookCtx.sessionId)   // stable — from params.sessionId
  ?? nonEmptyString(hookCtx.sessionKey)  // stable — human-readable name
  ?? `ses_${Date.now()}`;                // unstable — only in edge cases
```

In normal TUI/gateway operation `hookCtx.sessionKey` is always present,
so the `Date.now()` fallback is never reached. The instability is an edge
case (e.g. some embedded or test modes), not the common path.

**Why `(session_id, role, seq)` dedup key is broken:**

`seq` is position within the current call's slice. After history limit
truncation or compaction, the same message gets a different `seq`:

```
Turn 2: U1=seq0, A1=seq1, U2=seq2, A2=seq3
Turn 3: U1=seq0, A1=seq1, U2=seq2, A2=seq3, U3=seq4, A3=seq5
Turn 11 (U1 trimmed out): A1=seq0, U2=seq1, ...
  → A1 stored again with seq=0 (was seq=1 previously)
```

Result: every message gets stored **multiple times** — once per turn it
appears in the slice — until it ages out of the 200KB / 20-message window.

**Two options to fix this:**

**Option A — Content hash deduplication (recommended):**
Add a `content_hash VARCHAR(64)` column. Compute
`SHA-256(session_id + role + content)` before insert. Add a unique index
on `(session_id, content_hash)`. Use `INSERT IGNORE` so re-sent messages
are silently skipped.

```sql
content_hash VARCHAR(64) NOT NULL COMMENT 'SHA-256(session_id+role+content)',
UNIQUE INDEX idx_sess_dedup (session_id, content_hash)
```

```go
h := sha256.Sum256([]byte(s.SessionID + s.Role + s.Content))
s.ContentHash = hex.EncodeToString(h[:])
// SQL: INSERT IGNORE INTO sessions (...) VALUES (...)
```

Pros: simple, no read-before-write, idempotent.
Cons: two messages with identical content in the same session (e.g. two
identical user greetings) deduplicate to one row. Acceptable for the raw
storage use case.

**Option B — Delta detection (read-before-write):**
Query `SELECT content_hash FROM sessions WHERE session_id = ?` before
inserting, then only insert messages not yet present.

Pros: no extra schema change beyond the hash column.
Cons: extra read per ingest call; adds latency to the background goroutine.
Not worth the complexity over Option A.

**Decision: Option A (content hash + `INSERT IGNORE`).**
Rationale: no read-before-write, idempotent, aligns with the goal of
storing a deduplicated message set. The "identical greetings" case is
accepted — it is rare and the stored content is still correct.
Option B (read-before-write delta) is not used.

### New table: `sessions`

```sql
CREATE TABLE IF NOT EXISTS sessions (
    id           VARCHAR(36)     PRIMARY KEY,
    session_id   VARCHAR(100)    NULL,
    agent_id     VARCHAR(100)    NULL,
    source       VARCHAR(100)    NULL        COMMENT 'agent name / plugin identifier',
    seq          INT             NOT NULL    COMMENT 'message position within ingest call (0-based)',
    role         VARCHAR(20)     NOT NULL    COMMENT 'user | assistant | system | tool',
    content      MEDIUMTEXT      NOT NULL,   -- raw message content; JSON, Markdown, plain-text, any format
    content_type VARCHAR(20)     NOT NULL DEFAULT 'text'
                                 COMMENT 'text | json',
    content_hash VARCHAR(64)     NOT NULL    COMMENT 'SHA-256(session_id+role+content) for dedup',
    tags         JSON,
    %EMBEDDING_COL%
    state        VARCHAR(20)     NOT NULL DEFAULT 'active',
    created_at   TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX  idx_sess_session  (session_id),
    INDEX  idx_sess_agent    (agent_id),
    INDEX  idx_sess_state    (state),
    INDEX  idx_sess_created  (created_at),
    UNIQUE INDEX idx_sess_dedup (session_id, content_hash)
);
```

The `%EMBEDDING_COL%` placeholder follows the same pattern as `memories`
(`tenant/schema.go:BuildMemorySchema`):

- `autoModel != ""` → `VECTOR(N) GENERATED ALWAYS AS (EMBED_TEXT('%s', content, '{"dimensions": %d}')) STORED`
- otherwise → `VECTOR(1536) NULL`

After the `CREATE TABLE`, two `ALTER TABLE` statements add the search
indexes conditionally — identical pattern to `ZeroProvisioner.InitSchema`:

```sql
-- if autoModel != "":
ALTER TABLE sessions
    ADD VECTOR INDEX idx_sess_cosine ((VEC_COSINE_DISTANCE(embedding)))
    ADD_COLUMNAR_REPLICA_ON_DEMAND;

-- if ftsEnabled:
ALTER TABLE sessions
    ADD FULLTEXT INDEX idx_sess_fts (content)
    WITH PARSER MULTILINGUAL
    ADD_COLUMNAR_REPLICA_ON_DEMAND;
```

`tags` stores `[]` by default (never NULL), consistent with `memories`.
Filtered via `JSON_CONTAINS(tags, ?)` — same pattern as
`memory.go:buildFilterConds` (`repository/tidb/memory.go:553-560`).

`content_type` is auto-detected server-side: `json.Valid()` → `"json"`,
otherwise `"text"`. Agents may send JSON tool output, Markdown, plain
text, or any format; the column stores it verbatim.

`seq` is retained for ordering rows within a single ingest call. It is
**not** a stable position in the full session history.

### Domain type

```go
// Session represents a single raw message in a conversation.
type Session struct {
    ID          string          `json:"id"`
    SessionID   string          `json:"session_id,omitempty"`
    AgentID     string          `json:"agent_id,omitempty"`
    Source      string          `json:"source,omitempty"`
    Seq         int             `json:"seq"`
    Role        string          `json:"role"`
    Content     string          `json:"content"`
    ContentType string          `json:"content_type"`
    ContentHash string          `json:"content_hash"`
    Tags        []string        `json:"tags"`
    Embedding   []float32       `json:"-"`
    State       MemoryState     `json:"state"`
    CreatedAt   time.Time       `json:"created_at"`
    UpdatedAt   time.Time       `json:"updated_at"`
}
```

---

## Write Flow

### Current

```
POST /memories {messages}
  └─ return 202
  └─ goroutine: IngestService.Ingest (strip → extract → reconcile → DB)
```

### Proposed

```
POST /memories {messages}
  └─ launch goroutine A: SessionRepo.BulkCreate (store raw messages)
  └─ launch goroutine B: IngestService.Ingest   (smart pipeline, unchanged)
  └─ return 202 immediately
```

Both goroutines run in parallel. The handler returns `202 Accepted` without
waiting for either. Raw save failure is logged but does not affect smart
ingest or the API response.

**Rationale for parallel goroutines (not serial):** Smart ingest can take
seconds (LLM calls). Making raw save synchronous would add latency to the
202 response for no benefit to the caller. Both paths are best-effort
after the 202 is returned — the raw save has the same durability contract
as the existing smart ingest goroutine.

### `SessionRepo.BulkCreate` logic

```
for i, msg := range req.Messages:
    h := sha256.Sum256([]byte(req.SessionID + msg.Role + msg.Content))
    session := &domain.Session{
        ID:          uuid.New().String(),
        SessionID:   req.SessionID,
        AgentID:     req.AgentID,
        Source:      agentName,
        Seq:         i,
        Role:        msg.Role,
        Content:     msg.Content,
        ContentType: detectContentType(msg.Content),   // json.Valid() → "json", else "text"
        ContentHash: hex.EncodeToString(h[:]),
        Tags:        []string{},                        // empty by default; caller may set
        State:       StateActive,
    }
sessions → INSERT IGNORE INTO sessions
           (id, session_id, agent_id, source, seq, role, content, content_type,
            content_hash, tags, state, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW(), NOW())
           -- autoModel branch omits embedding column (GENERATED ALWAYS)
           -- non-autoModel branch includes embedding with vecToString()
           -- UNIQUE idx_sess_dedup (session_id, content_hash) silently skips
           -- rows already stored from a prior agent_end call
```

---

## Read Flow: Unified Search

`GET /memories?q=<query>` currently searches only the `memories` table.
With sessions, the handler appends session results after memory results:

```
GET /memories?q=foo&limit=20
  → MemoryService.Search (existing)   → up to limit results from memories
  → SessionService.Search (new)       → up to limit results from sessions (RRF internally)
  → append session rows as Memory objects
  → bump total += len(sessionMems)
  → return combined list (up to 2×limit rows by design)
```

Sessions are only appended when `q` is provided. Plain `GET /memories`
(no query) returns memories only — pagination semantics unchanged.

### Session row → Memory projection

Sessions surface as `Memory` objects with:

| Memory field   | Source |
|----------------|--------|
| `id`           | `sessions.id` |
| `content`      | `sessions.content` (raw message text) |
| `memory_type`  | `"session"` (new constant `TypeSession = "session"`) |
| `agent_id`     | `sessions.agent_id` |
| `session_id`   | `sessions.session_id` |
| `source`       | `sessions.source` |
| `tags`         | `sessions.tags` |
| `state`        | `sessions.state` |
| `created_at`   | `sessions.created_at` |
| `metadata`     | `{"role": "user", "seq": 3, "content_type": "text"}` |

`TypeSession = "session"` must be added to `domain/types.go` alongside
`TypePinned` and `TypeInsight`.

`metadata` encodes session-specific fields (`role`, `seq`, `content_type`)
that have no counterpart in `Memory`. Callers can inspect them without a
separate API.

### `memory_type=session` filter routing

When a caller passes `memory_type=session` in `GET /memories`:

- `MemoryService.Search` is **skipped entirely** — the `memories` table
  has no `memory_type=session` rows.
- Only `SessionService.Search` is called.
- The `MemoryType` field in `MemoryFilter` is checked in `listMemories`
  before invoking either service:

```go
onlySession := filter.MemoryType == string(domain.TypeSession)

var memories []domain.Memory
var total int
if !onlySession {
    memories, total, err = svc.memory.Search(r.Context(), filter)
    // handle err ...
}
if filter.Query != "" && svc.session != nil {
    if onlySession || filter.MemoryType == "" {
        sessionMems, _ := svc.session.Search(r.Context(), filter)
        memories = append(memories, sessionMems...)
        total += len(sessionMems)
    }
}
```

This means:
- `memory_type=` (empty) → both memory + session results
- `memory_type=session` → session results only
- `memory_type=insight` or `memory_type=pinned` → memory results only, no sessions

### Search implementation

`SessionService.Search` runs the same full hybrid pipeline as
`MemoryService.autoHybridSearch` (`service/memory.go:282`). The
`sessions` table has identical embedding and FTS indexes to `memories`,
so all search modes are supported:

| Condition | Mode | SQL |
|-----------|------|-----|
| `autoModel != ""` | Auto hybrid | `AutoVectorSearch` + `FTSSearch`/`KeywordSearch` → RRF merge |
| `embedder != nil` | Hybrid | `VectorSearch` + `FTSSearch`/`KeywordSearch` → RRF merge |
| `FTSAvailable()` | FTS only | `fts_match_word('...', content)` |
| fallback | Keyword | `content LIKE '%...%'` |

Note: `SessionRepo.VectorSearch(ctx, []float32, ...)` is only reachable
when `embedder != nil` AND `autoModel == ""` — i.e. client-side embedding
mode. In `autoModel` mode only `AutoVectorSearch` is called.
`VectorSearch` is included in the interface for completeness and to
match the `MemoryRepo` pattern; it is dead code in the default Starter
deployment (which uses `autoModel`).

`rrfMerge`, `collectMems`, `sortByScore`, `setScores`, `populateRelativeAge`
from `service/memory.go` are reused as-is — they operate on
`[]domain.Memory` and `map[string]float64`, both table-agnostic.

**`applyTypeWeights` is skipped for sessions.** That function boosts
`TypePinned` memories by 1.5×. Sessions project as `TypeSession` which
has no boost — their RRF scores remain unweighted, appropriate for
supporting context rather than elevated user preferences.

RRF is applied **within** session results only. Sessions are **not**
re-ranked against memories — they are appended after the memory result
set. This keeps sessions clearly separated in the response.

**2×limit behaviour (explicit API contract change):** when both memory
and session results are returned, the combined slice contains up to
`2×limit` entries. The `Limit` field in `listResponse` still reflects
the original query parameter. Clients must not assume `len(memories) <=
Limit` when `memory_type` is empty or `session`. This is intentional —
sessions are supplementary results appended after the primary memory
set.

---

## Interface Changes

### New repository interface

```go
// SessionRepo handles raw message storage and search.
// Search methods accept domain.MemoryFilter for consistency with MemoryRepo
// and to support tag/state/session_id filtering on sessions.
// All four search methods return []domain.Memory (already projected),
// so rrfMerge/collectMems/sortByScore from service/memory.go are reused as-is.
type SessionRepo interface {
    BulkCreate(ctx context.Context, sessions []*domain.Session) error
    AutoVectorSearch(ctx context.Context, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error)
    VectorSearch(ctx context.Context, queryVec []float32, f domain.MemoryFilter, limit int) ([]domain.Memory, error)
    FTSSearch(ctx context.Context, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error)
    KeywordSearch(ctx context.Context, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error)
    FTSAvailable() bool
}
```

`domain.MemoryFilter` is reused directly. The session repo ignores
`MemoryType` (not a column on `sessions`) but honours `AgentID`, `Tags`,
`SessionID`, `State`, `Limit`, and `Offset`.

### New service

```go
// SessionService stores and searches raw session messages.
type SessionService struct {
    sessions  repository.SessionRepo
    embedder  *embed.Embedder
    autoModel string
}

func (s *SessionService) BulkCreate(ctx context.Context, agentName string, req IngestRequest) error

// Search runs the same hybrid pipeline as MemoryService.autoHybridSearch.
// Returns []domain.Memory (projected) for direct append into listMemories response.
func (s *SessionService) Search(ctx context.Context, f domain.MemoryFilter) ([]domain.Memory, error)
```

`Search` selects its mode identically to `MemoryService.Search`:
- `autoModel != ""` → `AutoVectorSearch` + FTS/keyword → RRF
- `embedder != nil` → `VectorSearch` + FTS/keyword → RRF
- `FTSAvailable()` → FTS only
- fallback → keyword only

`applyTypeWeights` is not called — sessions have no type-based boost.

### Handler change

`handler/memory.go` `createMemory`, `hasMessages` branch:

```go
// Launch raw save and smart ingest in parallel.
go func(agentName string, req service.IngestRequest) {
    if err := svc.session.BulkCreate(context.Background(), agentName, req); err != nil {
        slog.Error("async session raw save failed",
            "cluster_id", auth.ClusterID,
            "session", req.SessionID, "err", err)
    }
}(auth.AgentName, ingestReq)

go func(agentName string, req service.IngestRequest) {
    result, err := svc.ingest.Ingest(context.Background(), agentName, req)
    // existing log lines ...
}(auth.AgentName, ingestReq)

respond(w, http.StatusAccepted, map[string]string{"status": "accepted"})
```

Note: `svc.session` is always non-nil (constructed at cache time). The
nil-guard is removed. Instead, `SessionRepo.BulkCreate` swallows MySQL
error 1146 (table not found) internally, logging at DEBUG — see B2 fix
in "Existing tenants" section. This means during the migration window,
session write failures are silent at DEBUG level, not ERROR floods.

`handler/memory.go` `listMemories`:

```go
onlySession := filter.MemoryType == string(domain.TypeSession)

var memories []domain.Memory
var total int
var err error
if !onlySession {
    memories, total, err = svc.memory.Search(r.Context(), filter)
    if err != nil {
        s.handleError(w, err)
        return
    }
}
if filter.Query != "" {
    if onlySession || filter.MemoryType == "" {
        sessionMems, _ := svc.session.Search(r.Context(), filter)
        memories = append(memories, sessionMems...)
        total += len(sessionMems)
    }
}
// NOTE: combined len(memories) may exceed filter.Limit (up to 2×limit by design)
```

### `Server` struct and `resolvedSvc`

`handler/handler.go` — add `autoDims` to `Server` and pass it to `NewServer`:

```go
type Server struct {
    tenant      *service.TenantService
    uploadTasks repository.UploadTaskRepo
    uploadDir   string
    embedder    *embed.Embedder
    llmClient   *llm.Client
    autoModel   string
    ftsEnabled  bool
    ingestMode  service.IngestMode
    dbBackend   string
    logger      *slog.Logger
    svcCache    sync.Map
}
```

`NewServer` signature is **unchanged** — `autoDims` is not added.
`TenantService` already holds it from construction (`main.go:108`).

`resolvedSvc`:

```go
type resolvedSvc struct {
    memory  *service.MemoryService
    ingest  *service.IngestService
    session *service.SessionService   // always non-nil; BulkCreate swallows 1146
}
```

`resolveServices` — additions after building `memRepo`:

```go
sessRepo := tidb.NewSessionRepo(auth.TenantDB, s.autoModel, s.ftsEnabled, auth.ClusterID)
svc := resolvedSvc{
    memory:  service.NewMemoryService(memRepo, s.llmClient, s.embedder, s.autoModel, s.ingestMode),
    ingest:  service.NewIngestService(memRepo, s.llmClient, s.embedder, s.autoModel, s.ingestMode),
    session: service.NewSessionService(sessRepo, s.embedder, s.autoModel),
}
s.svcCache.Store(key, svc)

// Fire background migration — TenantService owns the DDL logic (not handler).
go func() {
    if err := s.tenant.EnsureSessionsTable(context.Background(), auth.TenantDB); err != nil {
        s.logger.Warn("sessions table migration failed",
            "cluster_id", auth.ClusterID,
            "tenant", auth.TenantID, "err", err)
    }
}()
```

---

## Schema Evolution and Migration

### New tenants (Zero provisioner)

`ZeroProvisioner.InitSchema` (`tenant/zero.go:165`) already runs DDL on
cluster creation. Add the `sessions` table DDL there, with the same
embedding column conditional:

```go
if _, err := db.ExecContext(ctx, BuildSessionsSchema(p.autoModel, p.autoDims)); err != nil {
    return fmt.Errorf("init schema: sessions table: %w", err)
}
```

`BuildSessionsSchema` follows the same pattern as `BuildMemorySchema` in
`tenant/schema.go`.

Add optional FTS and vector indexes — same `ADD_COLUMNAR_REPLICA_ON_DEMAND`
pattern as memories, reusing `tenant.IsIndexExistsError` (see below):

```go
if p.autoModel != "" {
    _, err := db.ExecContext(ctx,
        `ALTER TABLE sessions ADD VECTOR INDEX idx_sess_cosine `+
        `((VEC_COSINE_DISTANCE(embedding))) ADD_COLUMNAR_REPLICA_ON_DEMAND`)
    if err != nil && !IsIndexExistsError(err) {
        return fmt.Errorf("init schema: sessions vector index: %w", err)
    }
}
if p.ftsEnabled {
    _, err := db.ExecContext(ctx,
        `ALTER TABLE sessions ADD FULLTEXT INDEX idx_sess_fts (content) `+
        `WITH PARSER MULTILINGUAL ADD_COLUMNAR_REPLICA_ON_DEMAND`)
    if err != nil && !IsIndexExistsError(err) {
        return fmt.Errorf("init schema: sessions fulltext index: %w", err)
    }
}
```

`IsIndexExistsError` is moved from `zero.go` to a new shared file
`tenant/util.go` and exported (see Existing tenants section below).

No `schema_version` bump needed — `CREATE TABLE IF NOT EXISTS` is idempotent.

### TiDB Cloud Starter provisioner

`TiDBCloudProvisioner.InitSchema` is intentionally a **no-op** — the Pool
API pre-creates the schema on the cluster template before takeover
(`starter.go:108`). The `sessions` table must be added to the **pool
cluster template** managed via the TiDB Cloud console or API.

**Action required:** Update the pool cluster template SQL to include the
`sessions` DDL before deploying this feature.

### Existing tenants (schema migration)

Existing tenant databases have `schema_version = 1` and no `sessions`
table. The chosen approach is **fail-open with background `CREATE TABLE IF
NOT EXISTS`** — no `schema_version` tracking needed.

**Why no version tracking:**
- `CREATE TABLE IF NOT EXISTS` is a pure no-op if the table already exists:
  zero risk of data modification, no locks on existing data.
- Updating `schema_version` in the control-plane `tenants` table is itself
  a write that can fail, adding a second thing to keep in sync.
- The idempotency of `CREATE TABLE IF NOT EXISTS` is sufficient — it is
  safe to run on every cold start per tenant with no coordination overhead.

**Migration strategy — background goroutine at service resolution time:**

When `resolveServices` builds a new `resolvedSvc` for a tenant (once per
tenant per server cold start, due to `svcCache`), it fires a background
goroutine delegating to `TenantService.EnsureSessionsTable` (C5 fix —
DDL lives in the service layer, not the handler):

```go
// service/tenant.go — new method
func (s *TenantService) EnsureSessionsTable(ctx context.Context, db *sql.DB) error {
    if _, err := db.ExecContext(ctx,
        tenant.BuildSessionsSchema(s.autoModel, s.autoDims)); err != nil {
        return fmt.Errorf("ensure sessions table: create: %w", err)
    }
    if s.autoModel != "" {
        _, err := db.ExecContext(ctx,
            `ALTER TABLE sessions ADD VECTOR INDEX idx_sess_cosine `+
            `((VEC_COSINE_DISTANCE(embedding))) ADD_COLUMNAR_REPLICA_ON_DEMAND`)
        if err != nil && !tenant.IsIndexExistsError(err) {
            return fmt.Errorf("ensure sessions table: vector index: %w", err)
        }
    }
    if s.ftsEnabled {
        _, err := db.ExecContext(ctx,
            `ALTER TABLE sessions ADD FULLTEXT INDEX idx_sess_fts (content) `+
            `WITH PARSER MULTILINGUAL ADD_COLUMNAR_REPLICA_ON_DEMAND`)
        if err != nil && !tenant.IsIndexExistsError(err) {
            return fmt.Errorf("ensure sessions table: fts index: %w", err)
        }
    }
    return nil
}
```

**B2 fix — MySQL 1146 swallowed in `SessionRepo.BulkCreate`:**

`svc.session` is always non-nil (constructed before the goroutine fires).
To avoid a silent SQL error flood during the migration window, `BulkCreate`
swallows MySQL error 1146 (ER_NO_SUCH_TABLE) at DEBUG level instead of
returning it:

```go
// In tidb/sessions.go BulkCreate:
var mysqlErr *mysql.MySQLError
if errors.As(execErr, &mysqlErr) && mysqlErr.Number == 1146 {
    slog.Debug("sessions table not yet ready, skipping raw save",
        "cluster_id", r.clusterID)
    return nil
}
return execErr
```

The same guard applies in all four search methods — if the table doesn't
exist, return empty results rather than an error.

**Fail-open behaviour:** session writes are silently skipped at DEBUG
level until `EnsureSessionsTable` completes. Smart ingest and all memory
operations are completely unaffected. The goroutine runs once per tenant
per cold start; `CREATE TABLE IF NOT EXISTS` is idempotent on all
subsequent cold starts.

---

## Deploy Notes

### Safe deployment order

**The pool template must be updated BEFORE the binary is deployed.**
Rationale: if the binary deploys first, any new tenant provisioned from
an old-template cluster during the drain window will have no `sessions`
table. The lazy migration (`EnsureSessionsTable`) is the safety net for
that case, but it is better not to rely on it for brand-new tenants.

Numbered sequence:

1. **Update pool cluster template** — add `sessions` DDL (with embedding
   and FTS indexes) to the TiDB Cloud pool cluster template SQL script.
2. **Drain old-template clusters** — let the pool recycler replace
   old-template clusters with new ones. No immediate action required;
   this happens automatically as old clusters expire.
3. **Deploy binary** — roll out the new server image.
4. **Coverage**: all tenant cases are covered:
   - New tenants after step 3: claimed from new-template pool → have `sessions` already.
   - New tenants during drain window (steps 2-3): claimed from old-template cluster →
     no `sessions` table → `EnsureSessionsTable` fires on first request → migrated.
   - Existing tenants (pre-deploy): `EnsureSessionsTable` fires on first
     request after server restart → migrated.

All straggler cases (new or existing tenants from old-template clusters)
are covered by the lazy migration path.

The `sessions` DDL to add to the pool template:

```sql
CREATE TABLE IF NOT EXISTS sessions (
    id           VARCHAR(36)   PRIMARY KEY,
    session_id   VARCHAR(100)  NULL,
    agent_id     VARCHAR(100)  NULL,
    source       VARCHAR(100)  NULL,
    seq          INT           NOT NULL,
    role         VARCHAR(20)   NOT NULL,
    content      MEDIUMTEXT    NOT NULL,
    content_type VARCHAR(20)   NOT NULL DEFAULT 'text',
    content_hash VARCHAR(64)   NOT NULL,
    tags         JSON,
    embedding    VECTOR(1024)  GENERATED ALWAYS AS (
                     EMBED_TEXT('tidbcloud_free/amazon/titan-embed-text-v2', content, '{"dimensions": 1024}')
                 ) STORED,
    state        VARCHAR(20)   NOT NULL DEFAULT 'active',
    created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX        idx_sess_session (session_id),
    INDEX        idx_sess_agent   (agent_id),
    INDEX        idx_sess_state   (state),
    INDEX        idx_sess_created (created_at),
    UNIQUE INDEX idx_sess_dedup   (session_id, content_hash)
);
ALTER TABLE sessions
    ADD VECTOR INDEX idx_sess_cosine ((VEC_COSINE_DISTANCE(embedding)))
    ADD_COLUMNAR_REPLICA_ON_DEMAND;
ALTER TABLE sessions
    ADD FULLTEXT INDEX idx_sess_fts (content)
    WITH PARSER MULTILINGUAL
    ADD_COLUMNAR_REPLICA_ON_DEMAND;
```

### Zero provisioner (self-hosted / dev)

No manual steps — `InitSchema` is updated to include sessions DDL.
No `schema_version` bump needed; `CREATE TABLE IF NOT EXISTS` is idempotent.

### Existing prod tenants

Background goroutine fires on first `resolveServices` call per tenant
(once per cold start). `CREATE TABLE IF NOT EXISTS sessions ...` is
idempotent — no manual DDL needed. Session writes are silently skipped
until the goroutine succeeds; smart ingest is never affected.

---

## Effort Estimate

| Area | Change | LoC |
|------|--------|-----|
| `domain/types.go` | `Session` struct, `TypeSession` constant | ~30 |
| `tenant/util.go` | New file: `IsIndexExistsError` (moved + exported from `zero.go`) | ~15 |
| `tenant/schema.go` | `BuildSessionsSchema()` — embedding col + FTS/vector ALTER pattern | ~50 |
| `tenant/zero.go` | Call `BuildSessionsSchema` + vector/FTS ALTERs; replace `isIndexExistsError` with `IsIndexExistsError` | ~20 |
| `service/tenant.go` | `EnsureSessionsTable(ctx, db)` — reads `autoModel`/`autoDims`/`ftsEnabled` from receiver | ~35 |
| `repository/repository.go` | `SessionRepo` interface (with `domain.MemoryFilter`) | ~15 |
| `repository/tidb/sessions.go` | New file: `BulkCreate` (MySQL 1146 swallow), `KeywordSearch`, `FTSSearch`, `AutoVectorSearch`, `VectorSearch`, tag/state filter, hash dedup | ~200 |
| `service/session.go` | New file: `SessionService.BulkCreate`, `Search` (full hybrid RRF pipeline, `domain.MemoryFilter`) | ~100 |
| `handler/handler.go` | `resolvedSvc`; `resolveServices` wiring; delegate to `s.tenant.EnsureSessionsTable(ctx, db)` | ~30 |
| `handler/memory.go` | Parallel goroutine; `memory_type=session` routing; append sessions in search | ~40 |
| `server/schema.sql` | Add sessions DDL (reference) | ~30 |

**Total: ~580 LoC**

---

## Decisions

1. **`schema_version` bump** — no tracking. `CREATE TABLE IF NOT EXISTS` is
   idempotent; running it on every cold start per tenant is safe and cheap.
   No version column update needed.

2. **Session search in list (no query)** — sessions are appended to results
   only when `q` is provided. Plain `GET /memories` (no query) returns
   memories only — pagination semantics unchanged.

3. **`content_type` auto-detection** — `json.Valid()` check only. Detected
   as `"json"` if valid JSON, otherwise `"text"`. No Markdown detection.

4. **Dedup strategy** — Option A (content hash + `INSERT IGNORE`). The table
   stores a deduplicated message set, not a verbatim log. Goal section updated
   to reflect this.

5. **`memory_type=session` routing** — `MemoryService.Search` is skipped
   entirely when `memory_type=session`; only `SessionService.Search` is called.

6. **`SessionRepo.VectorSearch` reachability** — only reachable in
   client-side embedding mode (`embedder != nil`, `autoModel == ""`). Dead code
   in the default Starter deployment. Kept for interface symmetry with
   `MemoryRepo`.

7. **Goroutine shutdown context** — `EnsureSessionsTable` runs with
   `context.Background()`. DDL statements are short-lived (seconds); graceful
   shutdown typically waits longer. No cancellation signal needed.

8. **`autoDims = 0` guard** — `BuildSessionsSchema` mirrors `BuildMemorySchema`
   exactly (`schema.go:92`): when `autoModel != ""`, `autoDims` is used directly
   in `VECTOR(%d)` with no guard (same as memories — misconfiguration is a
   deployment error, not a schema concern); when `autoModel == ""`, emit
   `VECTOR(1536) NULL` (nullable static column for client-side or no embedding).
   `1536` is the OpenAI `text-embedding-ada-002` dimension used as the static
   fallback, matching the existing pattern. No extra guard needed.

---

## Phase 2 addition — LLM-generated tags for sessions

### Background

The `sessions.tags` column is always written as `[]` today. The LLM never
sees session messages in the current write path (it only processes the
formatted conversation for fact extraction). This section documents the
design to populate `tags` via Phase 1 extraction.

Tags on `memories` rows are **not changed** — memories tags remain
empty by default (set only via explicit `memory_store` tool calls or file
import). This is an experiment scoped to sessions only.

### Design decisions

**D1 — LLM assigns tags, free-form vocabulary (experimental)**

The goal is to observe what the LLM naturally produces without constraining
it to a fixed taxonomy. Vocabulary inconsistency (`"golang"` vs `"go"`) is
accepted for this experiment. A controlled vocabulary can be introduced
later if the experiment shows value.

**D2 — Tags produced in Phase 1 (extraction), not a separate call**

Phase 1 already reads the full conversation to extract facts. Extending
its response to also return per-message tags adds zero extra LLM calls.
The same `CompleteJSON` call returns `facts[]` and `message_tags[][]`.

**D3 — Goroutine A: insert first, then LLM, then fan-out**

The write sequence inside goroutine A is:

```
goroutine A:
  Step 1: SessionService.BulkCreate(messages, tags=[])   ← 10-30ms, raw rows saved
  Step 2: IngestService.ExtractPhase1(messages)           ← 500ms-3s LLM call
  goroutine A1: SessionRepo.PatchTags(session_id, hash→tags)  ← UPDATE existing rows
  goroutine A2: IngestService.ReconcilePhase2(facts)          ← Phase 2 → memories
```

Sessions are written **before** the LLM call — raw data is preserved
even if Phase 1 fails. Tags are patched onto already-inserted rows
after Phase 1 completes.

This is strictly better than Phase1-first because:
- Sessions survive LLM failures unconditionally (not as a fallback case)
- BulkCreate (10-30ms) runs during the first ~30ms of the LLM's 500ms+ wait
- Failure isolation is clean: session storage never depends on LLM availability

**D4 — Services stay independent (no cross-service dependency)**

`IngestService` is not changed to depend on `SessionService`.
The fan-out coordination lives in the handler goroutine (Option 2).
This keeps both services independently testable.

**D5 — `message_tags` is a parallel array to `messages`**

The LLM returns one tag array per message, in the same order as the
input `messages` slice. Length mismatch (LLM returns fewer arrays than
messages) is handled defensively: missing entries default to `[]`.

**D6 — Tags patched via `(session_id, content_hash)` natural key**

After Phase 1, goroutine A1 updates already-inserted session rows using
the natural dedup key rather than UUIDs. `BulkCreate` returns no IDs;
the hash is recomputed deterministically from `session_id + role + content`
— the same function used during insert:

```go
for i, msg := range req.Messages {
    hash := sessionContentHash(req.SessionID, msg.Role, msg.Content)
    tags := tagsForIndex(phase1.MessageTags, i)
    // UPDATE sessions SET tags=? WHERE session_id=? AND content_hash=?
}
```

No signature change to `BulkCreate`. `UNIQUE INDEX idx_sessions_dedup
(session_id, content_hash)` serves as both dedup key and update key.

**D6 — Tags on sessions only; memories table untouched**

`ReconcilePhase2` (`addInsight`, `updateInsight`) signature is unchanged.
Tags from Phase 1 are never passed into the memories write path.

**D7 — Phase 1 still required for raw mode / no-LLM path**

If `mode == ModeRaw` or `s.llm == nil`, Phase 1 is skipped entirely.
Sessions are written with `tags: []` in this case — same as before.

### New Phase 1 extraction prompt

The existing `extractFacts` system prompt is extended with a new
`message_tags` section. Facts extraction rules are unchanged.

```
You are an information extraction engine. Your task is to identify distinct,
atomic facts from a conversation AND assign short descriptive tags to each
message.

## Rules — facts (unchanged)

1. Extract facts ONLY from the user's messages. Ignore assistant and system
   messages entirely.
2. Each fact must be a single, self-contained statement (one idea per fact).
3. Prefer specific details over vague summaries.
4. Preserve the user's original language.
5. Omit ephemeral information (greetings, filler, debugging chatter).
6. Omit information only relevant to the current task with no future reuse.
7. If no meaningful facts exist, return an empty facts array.

## Rules — message_tags

1. Assign 1-3 short lowercase tags to EVERY message (user, assistant, tool,
   system) — not just user messages.
2. Tags describe the message topic or type, e.g.:
   "tech", "work", "personal", "preference", "location", "question",
   "answer", "tool-call", "tool-result", "error", "code", "debug"
3. Use your own judgment — there is no fixed vocabulary.
4. Tags must be lowercase, no spaces (use hyphens for multi-word: "tool-call").
5. Return exactly one array entry per message, in the same order as the input.
   If a message has no meaningful tags, return an empty array [] for it.

## Output Format

Return ONLY valid JSON. No markdown fences, no explanation.

{
  "facts": ["fact one", "fact two", ...],
  "message_tags": [
    ["tag1", "tag2"],
    ["tag3"],
    [],
    ["tag4", "tag5", "tag6"]
  ]
}
```

### Example

Input conversation (3 messages):
```
User: I'm debugging a memory leak in our Go service.
Assistant: Let's look at the heap profile. Can you share the pprof output?
User: Here it is: [pprof data...]
```

Expected LLM response:
```json
{
  "facts": [
    "Debugging a memory leak in a Go service"
  ],
  "message_tags": [
    ["tech", "debug", "go"],
    ["tech", "question", "debug"],
    ["tech", "tool-result", "code"]
  ]
}
```

### Interface changes (delta from existing proposal)

**`service/ingest.go`**

Split `Ingest` smart path into two exported methods:

```go
type Phase1Result struct {
    Facts       []string   // extracted facts — feeds ReconcilePhase2
    MessageTags [][]string // per-message tags — feeds SessionRepo.PatchTags
                           // parallel to input messages; missing entries = []
}

// ExtractPhase1 runs fact extraction + message tagging in one LLM call.
// Returns Phase1Result. If LLM is nil or mode==ModeRaw, returns empty result.
func (s *IngestService) ExtractPhase1(ctx context.Context, messages []IngestMessage) (*Phase1Result, error)

// ReconcilePhase2 runs the reconciliation pipeline against existing memories.
// Equivalent to the existing reconcile() logic, now exported.
func (s *IngestService) ReconcilePhase2(ctx context.Context, agentName, agentID, sessionID string, facts []string) (*IngestResult, error)
```

**`repository/repository.go`**

New method on `SessionRepo`:

```go
// PatchTags updates tags on an already-inserted session row identified by
// (session_id, content_hash). Used by goroutine A1 after Phase 1 completes.
// Silently skips rows that no longer exist (INSERT IGNORE may have skipped them).
PatchTags(ctx context.Context, sessionID, contentHash string, tags []string) error
```

**`repository/tidb/sessions.go`**

Implement `PatchTags`:

```go
func (r *SessionRepo) PatchTags(ctx context.Context, sessionID, contentHash string, tags []string) error {
    tagsJSON := marshalTags(tags)
    _, err := r.db.ExecContext(ctx,
        `UPDATE sessions SET tags = ? WHERE session_id = ? AND content_hash = ?`,
        tagsJSON, sessionID, contentHash,
    )
    if err != nil && internaltenant.IsTableNotFoundError(err) {
        return nil
    }
    return err
}
```

**`handler/memory.go`** — `createMemory`, `hasMessages` branch:

```go
go func(agentName string, req service.IngestRequest) {
    // Step 1: store raw sessions immediately — survives LLM failure
    if err := svc.session.BulkCreate(context.Background(), agentName, req); err != nil {
        slog.Error("async session raw save failed",
            "cluster_id", auth.ClusterID, "session", req.SessionID, "err", err)
    }

    // Step 2: Phase 1 — shared LLM call (facts + message tags)
    phase1, err := svc.ingest.ExtractPhase1(context.Background(), req.Messages)
    if err != nil {
        slog.Error("phase1 extraction failed", "session", req.SessionID, "err", err)
        return // sessions already stored with tags=[]; memories not updated
    }

    // Step 3: fan out — patch session tags and reconcile memories in parallel
    go func() {
        for i, msg := range req.Messages {
            hash := sessionContentHash(req.SessionID, msg.Role, msg.Content)
            tags := tagsAtIndex(phase1.MessageTags, i)
            if err := svc.session.PatchTags(context.Background(), req.SessionID, hash, tags); err != nil {
                slog.Warn("session tag patch failed",
                    "cluster_id", auth.ClusterID, "session", req.SessionID, "err", err)
            }
        }
    }()

    go func() {
        result, err := svc.ingest.ReconcilePhase2(
            context.Background(), agentName, req.AgentID, req.SessionID, phase1.Facts)
        if err != nil {
            slog.Error("async memories reconcile failed", "session", req.SessionID, "err", err)
            return
        }
        slog.Info("async memories reconcile complete",
            "session", req.SessionID, "status", result.Status,
            "memories_changed", result.MemoriesChanged)
    }()
}(auth.AgentName, ingestReq)
```

`tagsAtIndex(tags [][]string, i int) []string` — safe index helper,
returns `[]string{}` if `i >= len(tags)` or `tags[i]` is nil.

`sessionContentHash` is the existing function in `service/session.go`,
called directly since handler and session service are in the same module.

### Effort estimate (delta)

| Area | Change | LoC |
|------|--------|-----|
| `service/ingest.go` | `ExtractPhase1` + `ReconcilePhase2` split; extended prompt + `Phase1Result` struct | ~55 |
| `repository/repository.go` | `PatchTags` on `SessionRepo` interface | ~5 |
| `repository/tidb/sessions.go` | `PatchTags` implementation | ~15 |
| `service/session.go` | No change (`BulkCreate` signature unchanged) | 0 |
| `handler/memory.go` | Revised goroutine A: insert → Phase1 → fan-out | ~30 |

**Total delta: ~105 LoC on top of the existing ~580 LoC.**
