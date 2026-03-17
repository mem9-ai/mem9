---
title: proposal — raw session storage
---

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

**Decision needed:** Option A is recommended. Confirm before implementation.

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
| `memory_type`  | `"session"` (new constant `TypeSession`) |
| `agent_id`     | `sessions.agent_id` |
| `session_id`   | `sessions.session_id` |
| `source`       | `sessions.source` |
| `tags`         | `sessions.tags` |
| `state`        | `sessions.state` |
| `created_at`   | `sessions.created_at` |
| `metadata`     | `{"role": "user", "seq": 3, "content_type": "text"}` |

`metadata` encodes session-specific fields (`role`, `seq`, `content_type`)
that have no counterpart in `Memory`. Callers can inspect them without a
separate API.

Filter `memory_type=session` to retrieve session rows only;
`memory_type=insight,pinned` retains existing behaviour.

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

---

## Interface Changes

### New repository interface

```go
// SessionRepo handles raw message storage and search.
// All four search methods return []domain.Memory (already projected),
// so rrfMerge/collectMems/sortByScore from service/memory.go are reused as-is.
type SessionRepo interface {
    BulkCreate(ctx context.Context, sessions []*domain.Session) error
    AutoVectorSearch(ctx context.Context, query string, agentID string, limit int) ([]domain.Memory, error)
    VectorSearch(ctx context.Context, queryVec []float32, agentID string, limit int) ([]domain.Memory, error)
    FTSSearch(ctx context.Context, query string, agentID string, limit int) ([]domain.Memory, error)
    KeywordSearch(ctx context.Context, query string, agentID string, limit int) ([]domain.Memory, error)
    FTSAvailable() bool
}
```

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
func (s *SessionService) Search(ctx context.Context, query, agentID string, limit int) ([]domain.Memory, error)
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
    if svc.session == nil {
        return
    }
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

`handler/memory.go` `listMemories`:

```go
// Append session results after memory results (only when q is provided).
if filter.Query != "" && svc.session != nil {
    sessionMems, _ := svc.session.Search(r.Context(), filter.Query, auth.AgentName, filter.Limit)
    memories = append(memories, sessionMems...)
    total += len(sessionMems)   // rough approximation — total counts memories + sessions
}
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
    autoDims    int       // new — needed by ensureSessionsTable for VECTOR(N) DDL
    ftsEnabled  bool
    ingestMode  service.IngestMode
    dbBackend   string
    logger      *slog.Logger
    svcCache    sync.Map
}
```

`NewServer` gains one extra parameter: `autoDims int`. Caller `main.go:118`
passes `cfg.EmbedAutoDims`.

`resolvedSvc`:

```go
type resolvedSvc struct {
    memory  *service.MemoryService
    ingest  *service.IngestService
    session *service.SessionService   // nil until ensureSessionsTable succeeds
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

go func() {
    if err := ensureSessionsTable(context.Background(), auth.TenantDB,
        s.autoModel, s.autoDims, s.ftsEnabled); err != nil {
        s.logger.Warn("sessions table migration failed — session writes skipped",
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
goroutine to ensure the sessions table exists:

```go
// In resolveServices, after caching the new svc:
go func() {
    if err := ensureSessionsTable(context.Background(), auth.TenantDB,
        s.autoModel, s.autoDims, s.ftsEnabled); err != nil {
        s.logger.Warn("sessions table migration failed — session writes skipped",
            "cluster_id", auth.ClusterID,
            "tenant", auth.TenantID, "err", err)
    }
}()
```

`ensureSessionsTable` is a new unexported function in `handler/handler.go`:

```go
func ensureSessionsTable(ctx context.Context, db *sql.DB,
    autoModel string, autoDims int, ftsEnabled bool) error {

    if _, err := db.ExecContext(ctx, tenant.BuildSessionsSchema(autoModel, autoDims)); err != nil {
        return fmt.Errorf("ensure sessions table: create: %w", err)
    }
    if autoModel != "" {
        _, err := db.ExecContext(ctx,
            `ALTER TABLE sessions ADD VECTOR INDEX idx_sess_cosine `+
            `((VEC_COSINE_DISTANCE(embedding))) ADD_COLUMNAR_REPLICA_ON_DEMAND`)
        if err != nil && !tenant.IsIndexExistsError(err) {
            return fmt.Errorf("ensure sessions table: vector index: %w", err)
        }
    }
    if ftsEnabled {
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

`tenant.IsIndexExistsError` is moved from the current unexported
`isIndexExistsError` in `tenant/zero.go` to a new shared file
`tenant/util.go`, exported for use by both `zero.go` and `handler.go`:

```go
// tenant/util.go
package tenant

import (
    "strings"
    "github.com/go-sql-driver/mysql"
)

// IsIndexExistsError reports whether err is a duplicate index error (MySQL 1061).
// Used by InitSchema and ensureSessionsTable to make index creation idempotent.
func IsIndexExistsError(err error) bool {
    var mysqlErr *mysql.MySQLError
    if errors.As(err, &mysqlErr) {
        return mysqlErr.Number == 1061
    }
    return strings.Contains(err.Error(), "already exists")
}
```

`zero.go` replaces its local `isIndexExistsError` calls with
`IsIndexExistsError` and removes the local definition.

**Fail-open behaviour:** If `ensureSessionsTable` fails (e.g. the cluster
is temporarily unavailable), session writes and searches are silently
skipped for that tenant — logged at WARN level. Smart ingest and all memory
operations are completely unaffected. The goroutine will retry on the next
cold start (i.e. next server restart or pool eviction).

---

## Deploy Notes

### TiDB Cloud Starter pool template

The Starter provisioner relies on a pre-created cluster pool managed via
TiDB Cloud. The pool cluster template must include the `sessions` DDL.

Update steps:
1. Add `sessions` table DDL (with embedding and FTS indexes) to the
   pool cluster template SQL script.
2. Recycle the pool (drain old clusters, let the provisioner claim fresh
   ones with the new schema).
3. Existing tenants already claimed from the pool are migrated via the
   lazy migration path (Option A above).

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
| `repository/repository.go` | `SessionRepo` interface | ~15 |
| `repository/tidb/sessions.go` | New file: `BulkCreate`, `KeywordSearch`, `FTSSearch`, `AutoVectorSearch`, tag filter, hash dedup | ~180 |
| `service/session.go` | New file: `SessionService.BulkCreate`, `Search` (full hybrid RRF pipeline) | ~100 |
| `handler/handler.go` | `autoDims` field + `NewServer` param; `resolvedSvc` + `resolveServices` wiring; `ensureSessionsTable` | ~50 |
| `handler/memory.go` | Parallel goroutine for raw save; append sessions in search path | ~30 |
| `server/schema.sql` | Add sessions DDL (reference) | ~30 |

**Total: ~520 LoC**

---

## Decisions

1. **`schema_version` bump** — no tracking. `CREATE TABLE IF NOT EXISTS` is
   idempotent; running it on every cold start per tenant is safe and cheap.
   No version column update needed.

2. **Session search in list (no query)** — sessions are appended to results
   only when `q` is provided. Plain `GET /memories` (no query) returns
   memories only; pagination semantics are unchanged.

3. **`content_type` auto-detection** — `json.Valid()` check only. Detected
   as `"json"` if valid JSON, otherwise `"text"`. No Markdown detection.
