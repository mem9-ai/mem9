---
title: CRDT Memory with Vector Clocks
status: rejected
created: 2026-03-02
last_updated: 2026-03-25
open_questions: 0
blocked_by: ""
---

> **STATUS: REJECTED — NOT IMPLEMENTED**
> This proposal was superseded by the smart-memory-pipeline-proposal, which
> replaced tombstones with a `state` column and uses vector-search + LLM
> reconciliation instead of vector-clock CRDT. No CRDT columns (`vector_clock`,
> `origin_agent`, `last_write_id`, `last_write_snapshot`, `last_write_status`)
> were ever added to the schema. The roadmap note in README.md confirms:
> "Vector Clock CRDT was deferred and removed from the roadmap."

## Summary

Upgrade mnemos from naive LWW (integer `version++`) to vector-clock-based CRDT conflict resolution with tombstone deletion. This enables true multi-agent concurrency detection: the server can distinguish "A happened before B" from "A and B are concurrent" and resolve conflicts deterministically.

## Context

**Why CRDT now, not later:** Multi-agent concurrent access is the primary design intent of mnemos — not a speculative future use case. The architecture explicitly provisions multiple agents per space (`POST /api/spaces/:id/tokens`), and the v2 memo (`claw-memory-v2-memo.md §1`) names silent concurrent overwrite as a *fundamental problem*, not an edge case. CRDT is the correct tool for the stated problem: detecting and resolving concurrent writes without real-time coordination. Deferring it would mean shipping a multi-agent system with known silent data-loss semantics.

The current mnemos server (Phase 1) works for single-agent or low-contention multi-agent use. But when multiple agents write the same key concurrently, the server blindly overwrites with the latest request (physical clock ordering from MySQL `ON UPDATE CURRENT_TIMESTAMP`). There is no way to:

- Detect that two writes were truly concurrent (neither agent saw the other's write)
- Preserve a causal history of who wrote what
- Soft-delete records without ghost resurrections from agents that haven't seen the delete

The original claw-memory v2 memo (`docs/design/claw-memory-v2-memo.md`) proposes vector clocks, tombstones, and a bootstrap endpoint. This proposal adapts those ideas to the existing Go server codebase.

## Scope

In scope:
- Server-side vector clock merge logic (Go)
- 3 new DB columns + migration SQL
- Tombstone (soft) deletion replacing hard delete
- Bootstrap endpoint (`GET /api/memories/bootstrap`)
- Update OpenClaw plugin API client to send/receive clocks
- Update claude-plugin hooks to pass agent identity

Out of scope:
- Client-side vector clock state persistence (can be added later; the server is authoritative)
- API path migration from `/api/` to `/v1/` (separate concern)
- LLM merge (remains a future enhancement on top of CRDT)
- CRDT in direct-mode plugin (`DirectBackend` does raw SQL to TiDB Serverless without mnemo-server; CRDT logic lives in the server only. Direct-mode continues with simple LWW.)

## Design

### Vector Clock Model

A vector clock is a `map[string]uint64` where keys are agent names and values are logical counters. Every write from an agent increments its own counter. The server stores the merged clock alongside each memory.

```
Clock: {"agent-a": 3, "agent-b": 1}
Means: agent-a has made 3 writes to this memory, agent-b has made 1.
```

**Dominance rules:**

```
Ci dominates Ce  iff  forall k: Ci[k] >= Ce[k]  AND  exists k: Ci[k] > Ce[k]
Concurrent          iff  neither dominates the other
```

**Merge:**
```
For each agent k:  merged[k] = max(Ci[k], Ce[k])
```

### Write (Upsert) Flow

On `POST /api/memories` with a `clock` field:

1. Begin transaction. Acquire row lock with `SELECT ... FOR UPDATE` on `(space_id, key_name)`.
2. **No existing record** (including tombstoned record — see revival below): INSERT with provided clock (or `{agent_name: 1}` if no clock sent).
3. **Existing live record found** — compare incoming clock `Ci` vs existing clock `Ce`:
   - `Ci` dominates `Ce` -> incoming is strictly newer. UPDATE content + merge clocks.
   - `Ce` dominates `Ci` -> existing is strictly newer. Discard incoming, return existing (no write).
   - Concurrent -> tie-break deterministically: `origin_agent` (lexicographic ascending), then `id` (lexicographic ascending). No physical time. Winner's content wins; clocks merge regardless.
4. Commit. Return the resulting memory.

**Tombstone revival:** If the existing record is tombstoned (`tombstone = TRUE`) and the incoming write wins (or there is no other live record), set `tombstone = FALSE` in the same UPDATE. This covers both delete→recreate and concurrent delete/write:

```sql
-- Revival case: incoming write wins over a tombstone
UPDATE memories
SET content     = ?,
    vector_clock = ?,
    tombstone   = FALSE,
    origin_agent = ?,
    updated_at  = NOW()
WHERE space_id = ? AND key_name = ?;
```

A tombstoned record is treated as a regular record for clock comparison. If the incoming write is dominated by the tombstone's clock, the tombstone wins and the record stays deleted (returns 404).

**Test matrix for tombstone correctness:**

| Scenario | Result |
|----------|--------|
| delete then recreate (sequential) | New write wins (higher clock), tombstone=FALSE |
| concurrent delete and write (new clock) | Tie-break decides; winner clock state survives |
| incoming clock dominated by tombstone clock | Tombstone wins; record stays deleted |
| incoming clock dominates tombstone clock | Revival: tombstone=FALSE, new content wins |

**Retry semantics:** The upsert service method uses `SELECT ... FOR UPDATE` inside a transaction. On deadlock (MySQL error 1213) or serialization failure, the caller retries up to 3 times with exponential backoff (50ms, 100ms, 200ms). The write is idempotent when the same `write_id` is provided (see Fault Tolerance section).

**Backward compatibility — LWW fast path:** If the client sends no `clock` field, the server takes a separate fast path: overwrite unconditionally (same as current Phase 1 `ON DUPLICATE KEY UPDATE`). The merge/compare logic is skipped entirely. This guarantees no behavioral regression for legacy clients and avoids the trap where a stale `{agent_name: 1}` clock appears dominated by a clock-aware write. Legacy writes and clock-aware writes targeting the same key can race; the last physical write wins for legacy clients, which is the current contract.

**LWW tombstone revival is intentional.** A clock-less write that targets a tombstoned key revives it (`tombstone = FALSE`). This is the correct semantic: a client that writes new content to a key is expressing intent to create — not checking whether a previous deletion exists. Requiring `revive=true` would silently fail legacy clients writing to deleted keys. The clock-aware path handles the nuance: a dominated clock-aware write does *not* revive a tombstone (the existing tombstone clock wins).

### Delete (Tombstone) Flow

On `DELETE /api/memories/:id`:

1. Begin transaction. Acquire row lock with `SELECT ... FOR UPDATE` on the record.
2. If record does not exist or is already tombstoned: return HTTP 204 (idempotent — repeated deletes are safe).
3. Set `tombstone = TRUE`, increment deleting agent's clock entry. The JSON path is constructed safely in Go (not interpolated into SQL) using `json.Marshal(agentName)` to produce the quoted key, then passed as a parameter — see `agentName` safety note in the Repository section. Do not hard-delete.
4. Commit. Return HTTP 204.
5. All read queries (`List`, `Search`, `GetByID`, `Bootstrap`) filter `tombstone = FALSE`.
6. `GetByID` with a tombstoned record returns 404 (same external behavior as hard delete).

**Retry on deadlock:** Same policy as write: up to 3 attempts, backoff 50ms/100ms, then HTTP 503 `{"error": "write conflict, retry"}`.

**Repeated delete behavior:** Calling `DELETE /api/memories/:id` on an already-tombstoned record returns 204. This is idempotent. The clock is not incremented again on a no-op tombstone.

Tombstone revival on concurrent write: if a write races with a delete and the write's clock wins, the write handler sets `tombstone = FALSE` as part of the same UPDATE (described in Write Flow above). The `SELECT ... FOR UPDATE` serializes both paths — no split-brain state is possible.

Tombstoned records can be garbage-collected periodically (e.g. records tombstoned >30 days ago). This is a future operational concern, not part of this proposal.

### Bootstrap Endpoint

```
GET /api/memories/bootstrap?limit=20
```

Returns the top-N memories for a space, ordered by recency (`updated_at DESC`), filtered by `tombstone = FALSE`. No new selection intelligence yet -- pure recency. The `limit` parameter defaults to 20, max 100.

This is a thin convenience endpoint. The claude-plugin `session-start.sh` already does `GET /api/memories?limit=20` -- the bootstrap endpoint formalizes this with a stable contract for future selection strategies (relevance scoring, pinned memories, etc).

### Endpoint Behavior Matrix

| Endpoint | Key present | Record state | Result |
|----------|-------------|--------------|--------|
| `POST` (no clock) | any | live | LWW overwrite → 201 |
| `POST` (no clock) | any | tombstoned | LWW overwrite, tombstone=FALSE → 201 |
| `POST` (no clock) | any | not found | INSERT → 201 |
| `POST` (with clock) | any | live, incoming dominates | UPDATE → 201 + `X-Mnemo-Winner` |
| `POST` (with clock) | any | live, incoming dominated | no-op → 200 + `X-Mnemo-Dominated: true` |
| `POST` (with clock) | any | live, concurrent | TieBreak → 201 or 200 depending on winner |
| `POST` (with clock) | any | tombstoned, incoming wins | revival + UPDATE → 201 |
| `POST` (with clock) | any | tombstoned, tombstone wins | no-op → 200 + `X-Mnemo-Dominated: true` |
| `POST` (with clock) | any | not found | INSERT → 201 |
| `PUT` | any | live | LWW overwrite (integer version check unchanged) → 200 |
| `PUT` | any | tombstoned | 404 (tombstoned = not found) |
| `DELETE` | — | live | tombstone=TRUE → 204 |
| `DELETE` | — | tombstoned | no-op → 204 (idempotent) |
| `DELETE` | — | not found | 404 |
| `POST /bulk` | any | any | delegates to Create per item; same rules as `POST` no-clock path |

**PUT and vector clocks in MVP:** `PUT /api/memories/:id` does NOT participate in vector clock logic in this proposal. It uses the existing integer `If-Match` version check. The `vector_clock` and `origin_agent` columns are NOT updated by PUT. This means a PUT after a POST-with-clock will leave `vector_clock` stale. This is acceptable for MVP because PUT is used for direct updates with version pinning, not for concurrent multi-agent writes. Future work: extend PUT to merge clocks (noted in Future Work section).

### Fault Tolerance and Idempotency

**Idempotent write IDs — precise semantics:** `POST /api/memories` accepts an optional `write_id` (UUID) in the request body. The server stores `write_id` in a new `last_write_id` column alongside a `last_write_snapshot JSON` column containing the serialized `Memory` at the time of that write.

**`write_id` scope is per-row.** A `write_id` identifies one specific write attempt to one specific memory row. It is NOT unique across the space — two different rows may share the same `write_id` value without conflict. Deduplication is enforced via the `SELECT ... FOR UPDATE` check during the transaction: if the row's `last_write_id` matches the incoming `write_id`, return the cached snapshot. No separate unique index is needed (and a space-scoped unique index would incorrectly reject valid retries to different keys).

For keyless memories (no `key_name`), each POST creates a new row — there is no existing row to check `last_write_id` against, so `write_id` has no idempotency effect on keyless writes. Clients requiring idempotent keyless writes should use a `key`.

On retry with the same `write_id`:
- If `last_write_id` matches on the current row: return `last_write_snapshot` deserialized, with the same HTTP status as the original response (201 for a winning write, 200 for a dominated write, stored in a `last_write_status TINYINT` column).
- If the row has since been modified by a later write (i.e., `last_write_id` no longer matches): the idempotency window has expired. Return the current row state with HTTP 200 and `X-Mnemo-Idempotency-Expired: true`. Clients MUST NOT assume the original write result is recoverable after the idempotency window expires.
- If the row does not exist yet and `write_id` is provided: proceed normally (INSERT path); store snapshot after commit.

```sql
ALTER TABLE memories
  ADD COLUMN last_write_id     VARCHAR(36),
  ADD COLUMN last_write_snapshot JSON,
  ADD COLUMN last_write_status TINYINT;  -- HTTP status of original response (200 or 201)

-- No unique index on last_write_id: deduplication is per-row via SELECT ... FOR UPDATE.
-- A space-scoped unique index would incorrectly reject valid retries to different keys.
```

> **Why not a separate idempotency table?** The write_id check is per-row — one active row, one active write_id. A separate table would require a JOIN on every write. Storing on the row is simpler and consistent with the single-row-lock pattern.

**Retry policy (service layer):** The `Create` service method wraps the `SELECT ... FOR UPDATE` + UPDATE in a transaction with up to 3 retries on deadlock (MySQL 1213) or lock timeout (MySQL 1205):

```
attempt 1: immediate
attempt 2: after 50ms
attempt 3: after 100ms
fail: return ErrWriteConflict to handler → HTTP 503 (Service Unavailable)
```

HTTP 503 is chosen over 409 because the condition is transient resource contention (lock deadlock), not a semantic conflict between the write's intent and the resource state. Clients should retry with backoff. The response body is `{"error": "write conflict, retry"}`.

**Clock validation (handler, before service call):** Reject with HTTP 400 `{"error": "invalid clock: <reason>"}` if:
- `clock` is not a JSON object
- Any key is not a non-empty string
- Any value is not a non-negative integer (uint64 range)

This matches the existing error envelope `{"error": "..."}` used throughout `handler/handler.go`.

**Timeout:** Each DB transaction uses a context with a 5s deadline. The handler's request context inherits the server's global timeout (currently unset; this proposal sets it to 10s via middleware).

**No watchdog defined for MVP:** A persistent watchdog or reconciliation job for incomplete transitions is out of scope for MVP. The `SELECT ... FOR UPDATE` pattern means writes either commit fully or roll back — there is no partial-write state. If the server process crashes mid-transaction, MySQL rolls back automatically. Future work: if async background GC is added (tombstone cleanup), it will need a distributed lock or idempotent reconciliation job.

## Changes by Layer

### Database

Migration SQL (additive, non-breaking):

```sql
ALTER TABLE memories
  ADD COLUMN vector_clock        JSON         NOT NULL DEFAULT (JSON_OBJECT()),
  ADD COLUMN origin_agent        VARCHAR(64),
  ADD COLUMN tombstone           TINYINT(1)   NOT NULL DEFAULT 0,
  ADD COLUMN last_write_id       VARCHAR(36),
  ADD COLUMN last_write_snapshot JSON,
  ADD COLUMN last_write_status   TINYINT;

CREATE INDEX idx_tombstone ON memories(space_id, tombstone);
-- No unique index on last_write_id: deduplication is per-row via SELECT ... FOR UPDATE (see Fault Tolerance).
```

**DDL notes for TiDB/MySQL compatibility:**
- `JSON NOT NULL DEFAULT (JSON_OBJECT())` uses an expression default, which requires MySQL 8.0.13+ or TiDB 5.3+. Verify target version before applying. Fallback if unsupported: `DEFAULT '{}'` (string default, valid for JSON columns in older MySQL).
- `TINYINT(1)` is used instead of `BOOLEAN` for portability across TiDB versions where `BOOLEAN` is an alias but display behavior varies.
- `CREATE UNIQUE INDEX` on a nullable column (`last_write_id`): NULLs are not considered equal in MySQL/TiDB unique indexes, so multiple NULL rows are allowed. This is the desired behavior — only non-NULL `write_id` values are deduplicated.
- Validate on staging before applying to production. Rollback script: `ALTER TABLE memories DROP COLUMN vector_clock, DROP COLUMN origin_agent, DROP COLUMN tombstone, DROP COLUMN last_write_id, DROP COLUMN last_write_snapshot, DROP COLUMN last_write_status; DROP INDEX idx_tombstone ON memories;`

Existing rows get all new columns as NULL/default. All valid — existing data continues to work.

The existing `UNIQUE (space_id, key_name)` constraint is preserved. Tombstone revival is an UPDATE, not an INSERT, so it does not conflict with this constraint.

### Domain Types (`server/internal/domain/types.go`)

The `Memory` struct currently has these fields (post dual-mode PR): `ID`, `SpaceID`, `Content`, `KeyName`, `Source`, `Tags`, `Metadata` (`json.RawMessage`), `Embedding` (`[]float32`), `Version`, `UpdatedBy`, `CreatedAt`, `UpdatedAt`, `Score` (`*float64`). All existing fields remain unchanged.

```go
// Add to Memory struct (additive only — existing fields unchanged):
VectorClock map[string]uint64 `json:"clock,omitempty"`
OriginAgent string            `json:"origin_agent,omitempty"`
Tombstone   bool              `json:"tombstone"`
```

Existing fields `Version`, `Source`, `UpdatedBy` remain unchanged and are always present in responses.

`WriteResult` is used **internally** (service → handler) only. It is never serialized to the response body:

```go
type WriteResult struct {
    Memory    *Memory
    Dominated bool   // true when incoming write lost to existing
    Winner    string // origin_agent of the winning record
}
```

**Response contract for `POST /api/memories` (frozen — flat `Memory`, no nesting):**

```json
{
  "id": "uuid",
  "key": "cleo-naming",
  "content": "...",
  "source": "agent-a",
  "version": 4,
  "updated_by": "agent-a",
  "clock": {"agent-a": 3, "agent-b": 1},
  "origin_agent": "agent-a",
  "tombstone": false,
  "created_at": "...",
  "updated_at": "..."
}
```

Merge metadata is conveyed via response headers (not body), keeping the body shape identical to the existing `Memory` contract:

```
X-Mnemo-Winner:    agent-a        (origin_agent of the winner; present when merge occurred)
X-Mnemo-Dominated: true           (present and "true" when the incoming write was discarded)
```

This is backward-compatible: existing clients that call `POST /api/memories` and decode the body as `Memory` continue to work unchanged. New clients that want merge metadata read the headers.

> **Why headers, not body?** Wrapping in `{"memory": {...}, "merged": true}` breaks every existing client that decodes the body as `Memory` — including `MnemoClient.store()` in the OpenClaw plugin and the claude-plugin curl calls. Headers add metadata without touching the body schema.

**`origin_agent` vs `source` vs `updated_by`:**
- `source`: the agent name extracted from the Bearer token. Set by the server on every write. Reflects who authenticated.
- `updated_by`: same value as `source` for Phase 1 writes. Unchanged by this proposal.
- `origin_agent`: the agent name of the write that **won** the last merge. On a dominated write, `origin_agent` retains the previous winner's name. On a fresh write or dominating write, `origin_agent = source`. This is the only new field that can differ from `source`/`updated_by`.

Setting rules by path:
- Dominating write: `origin_agent = incoming source`
- Dominated write (existing wins): `origin_agent` unchanged (retains previous value)
- Concurrent tie-break winner: `origin_agent = winning source`
- LWW fast path (no clock): `origin_agent = source` (same as current behavior)

### Repository Interface (`server/internal/repository/repository.go`)

The existing `Delete(ctx, spaceID, id string) error` method is **replaced** (not supplemented) by:

```go
// SoftDelete replaces Delete. agentName is needed to increment the deleting agent's clock.
SoftDelete(ctx context.Context, spaceID, id, agentName string) error
```

`Delete` is removed from the interface. All callers (service layer and any future callers) use `SoftDelete`. The repository implementation changes from `DELETE FROM memories WHERE ...` to a transactional `SELECT ... FOR UPDATE` + `UPDATE ... SET tombstone = TRUE, vector_clock = JSON_SET(...)`.

New method:
```go
ListBootstrap(ctx context.Context, spaceID string, limit int) ([]Memory, error)
```

Existing methods `List`, `GetByID`, `GetByKey` gain a `tombstone = FALSE` filter in their SQL. Additionally, `VectorSearch` and `KeywordSearch` (added in the dual-mode PR for hybrid search) must also filter `tombstone = FALSE` to prevent tombstoned records from appearing in search results.

**`agentName` propagation for delete:** The delete clock-increment requires `agentName` to flow from handler → service → repository. Current path:

```
handler.deleteMemory  →  service.Delete(ctx, spaceID, id)
```

Updated path:

```
handler.deleteMemory  →  service.Delete(ctx, spaceID, id, agentName)
                                               ↑ from authInfo(r).AgentName
service.Delete        →  repo.SoftDelete(ctx, spaceID, id, agentName)
```

`authInfo(r).AgentName` is already available in the handler (populated by the auth middleware from the Bearer token). No middleware changes are needed.

**`agentName` JSON path safety:** `agentName` is used as a JSON object key in `vector_clock`. Using it directly in a SQL JSON path expression (e.g. `'$.<agentName>'`) is unsafe if `agentName` contains `.`, `[`, `]`, or `"`. The safe approach is to construct the clock update entirely in Go:

```go
// In repo.SoftDelete — safe clock increment in Go, not SQL string interpolation:
// 1. Read current vector_clock JSON from the locked row.
// 2. Unmarshal into map[string]uint64.
// 3. Increment map[agentName] (any string key is valid in a Go map).
// 4. Marshal back to JSON.
// 5. UPDATE memories SET tombstone = TRUE, vector_clock = ? WHERE id = ? AND space_id = ?
```

This avoids all JSON path injection. The `agentName` value is used only as a Go map key, never interpolated into SQL. At token creation time (`service/space.go:validateSpaceInput`), add a character set constraint to agentName: `[a-zA-Z0-9_.-]` max 100 chars (already length-validated; add pattern check). This defense-in-depth prevents unexpected keys in the clock map.

### Service Layer (`server/internal/service/memory.go`)

New function: `MergeVectorClocks(existing, incoming map[string]uint64) map[string]uint64`

New function: `CompareClocks(a, b map[string]uint64) ClockRelation` returning `Dominates`, `Dominated`, or `Concurrent`.

New function: `TieBreak(a, b *Memory) *Memory` — deterministic comparison: `origin_agent` (lexicographic ascending), then `id` (lexicographic ascending). No physical time. See Technical Approach concern for rationale.

`Create` method signature updated:
```go
// Returns WriteResult (internal type — not serialized to response body).
// metadata and embedding generation are preserved from current implementation.
func (s *MemoryService) Create(ctx context.Context, spaceID, agentName, content, key string, tags []string, metadata json.RawMessage, clock map[string]uint64, writeID string) (*WriteResult, error)
```
- If `clock == nil`: LWW fast path — overwrite unconditionally (current behavior: generate embedding if embedder configured, then upsert), return `WriteResult{Memory: m, Dominated: false}`.
- If `clock != nil`: transactional `SELECT ... FOR UPDATE`, compare, `TieBreak` for concurrent case, set `tombstone = FALSE` if reviving, re-generate embedding on winning writes when content changes, commit with retry.
- Idempotency: if `write_id` matches stored `last_write_id`, return cached `*Memory` wrapped in `WriteResult` (see Fault Tolerance for exact semantics).

`Delete` method signature updated:
```go
func (s *MemoryService) Delete(ctx context.Context, spaceID, id, agentName string) error
```
- Delegates to `repo.SoftDelete(ctx, spaceID, id, agentName)`.

New `Bootstrap` method:
- Delegates to `repo.ListBootstrap` repository method.

### Handler Layer (`server/internal/handler/memory.go`)

`createMemoryRequest` gains optional `clock` and `write_id` fields (additive — existing `metadata` field preserved):

```go
type createMemoryRequest struct {
    Content  string            `json:"content"`
    Key      string            `json:"key,omitempty"`
    Tags     []string          `json:"tags,omitempty"`
    Metadata json.RawMessage   `json:"metadata,omitempty"`
    Clock    map[string]uint64 `json:"clock,omitempty"`
    WriteID  string            `json:"write_id,omitempty"` // idempotency key
}
```

The handler validates `clock` values before calling the service (all keys must be strings, all values non-negative integers; reject with HTTP 400 `{"error": "invalid clock: <reason>"}` on failure).

Response logic:
- Clock-aware write, incoming wins (new or dominating): HTTP 201, body = flat `Memory`, set `X-Mnemo-Winner: <origin_agent>`.
- Clock-aware write, dominated (existing wins): HTTP 200, body = existing flat `Memory`, set `X-Mnemo-Winner: <origin_agent>`, `X-Mnemo-Dominated: true`.
- LWW fast path (no clock): HTTP 201, body = flat `Memory`. No merge headers.

The handler calls `respond(w, statusCode, writeResult.Memory)` — not `WriteResult`. Headers are set before calling `respond`.

New route: `GET /api/memories/bootstrap` (authenticated).

### OpenClaw Plugin (`openclaw-plugin/`)

The plugin now has a dual-mode architecture: `DirectBackend` (raw SQL to TiDB Serverless) and `ServerBackend` (HTTP to mnemo-server), abstracted behind the `MemoryBackend` interface.

**Server mode (`ServerBackend`):** `CreateMemoryInput` in `types.ts` gains optional `clock` and `write_id` fields. `Memory` type gains `clock`, `origin_agent`, `tombstone` fields (additive — existing `metadata`, `score`, `version`, `source`, `updated_by` unchanged).

`ServerBackend.store()` behavior:
- Sends `clock` and `write_id` in the POST body.
- Receives a flat `Memory` body (unchanged shape). **No unwrapping needed.** External signature `Promise<Memory>` unchanged.
- Optionally reads `X-Mnemo-Dominated: true` header if the caller needs to know whether the write was discarded.

**Direct mode (`DirectBackend`):** No CRDT changes. Direct mode continues with simple LWW via `INSERT ... ON DUPLICATE KEY UPDATE`. It does not send/receive vector clocks. This is explicitly out of scope — CRDT logic lives in the server only. The `DirectBackend` will gain tombstone column awareness in its schema init (`schema.ts`) so the DDL is consistent, but no merge logic.

The plugin does NOT maintain a local clock in this phase. The server handles all clock logic. Clock-less writes (`clock` omitted) take the LWW fast path on the server.

### claude-plugin (`claude-plugin/`)

`stop.sh` -- no change needed. It already posts memories without a clock, which will work with the backward-compatible server.

`session-start.sh` -- can optionally switch to `/api/memories/bootstrap` endpoint for cleaner semantics. Not required for correctness.

## Implementation Phases

Phase order chosen to minimize risk — each phase is independently deployable and backward-compatible. **Gating:** Phase D (bootstrap) and Phase E (plugins) MUST NOT ship before Phase C is in production and validated. They can be developed in parallel but deployed sequentially.

### Phase A: Database + Domain Types (~50 LoC)
- Add migration SQL (6 new columns + 2 indexes)
- Update `Memory` struct with new fields
- Update scan functions in `repository/tidb/memory.go`
- Migration dry-run on staging: verify existing rows unaffected, check JSON default compatibility with target TiDB version
- **Dependencies:** None. Gate for Phase B.

### Phase B: Tombstone Deletion (~70 LoC)
- Replace `Delete` with `SoftDelete(ctx, spaceID, id, agentName string)` in repo + service + handler
- Propagate `agentName` through handler → service → repo (see Repository section)
- Add `tombstone = FALSE` filter to all read queries: `List`, `GetByID`, `GetByKey`, `VectorSearch`, `KeywordSearch`, `Count`
- Retry on deadlock (same 3-attempt policy as Phase C)
- No client changes needed — same 204 response
- Integration tests: delete→read=404, repeated-delete=204, delete→list excludes tombstoned, delete→vector-search excludes tombstoned, agentName clock increment verified in DB
- **Dependencies:** Phase A.

### Phase C: Vector Clock Merge (~220 LoC)
- Implement `MergeVectorClocks`, `CompareClocks`, `TieBreak` in service layer
- Update `Create`: LWW fast path (no clock, preserves current embedding generation) + transactional CRDT path (with clock)
- CRDT path: `SELECT ... FOR UPDATE`, clock compare, tombstone revival, `TieBreak` for concurrent case, re-generate embedding via `s.embedder.Embed()` when content changes on a winning write
- Clock validation in handler (400 on malformed input)
- Idempotency: `write_id` check, store snapshot + status in `last_write_snapshot`/`last_write_status`
- Retry loop (3 attempts, exponential backoff); retry exhaustion → 503
- Return flat `Memory` from handler; set `X-Mnemo-Winner`/`X-Mnemo-Dominated` headers
- Integration tests: dominate (201), dominated (200 + header), concurrent each tie-break dimension, tombstone revival, write_id idempotency, write_id expiry (row later modified), LWW fast path unaffected, malformed clock (400), retry exhaustion (503)
- **Dependencies:** Phase B.

### Phase D: Bootstrap Endpoint (~40 LoC)
- Add `ListBootstrap` to repository
- Add `Bootstrap` method to service
- Register `GET /api/memories/bootstrap` route
- Update claude-plugin `session-start.sh` to use bootstrap endpoint (optional)
- **Dependencies:** Phase A. Gate: deploy after Phase C is validated in production.

### Phase E: Plugin Updates (~50 LoC TypeScript)
- Update OpenClaw `Memory` type in `types.ts` (additive fields: `clock`, `origin_agent`, `tombstone`)
- Update `CreateMemoryInput` with optional `clock` and `write_id`
- `ServerBackend.store()` reads flat `Memory` response — no unwrapping needed
- Optionally surface `X-Mnemo-Dominated` header in store result
- Update `DirectBackend` schema init (`schema.ts`) to include new columns in DDL for consistency (no merge logic)
- Unit tests: additive fields decode correctly, no-clock path unchanged, dominated write header detected
- **Dependencies:** Phase C deployed and validated. Gate: coordinate rollout with server Phase C.

### Additional Effort
- Migration rollback script: ~15 LoC SQL (6 DROP COLUMN + 2 DROP INDEX)
- Transactional refactor effort (service layer redesign): ~30 LoC overhead beyond raw feature code
- Integration test matrix (Phases B + C): ~15 test cases, ~120 LoC Go test
- Compatibility regression tests (existing `version`/`source`/`updated_by` still present): ~20 LoC
- Request timeout middleware: ~15 LoC Go
- Migration validation/dry-run procedure: ~1 day manual effort (not LoC)
- Coordinated plugin rollout: Phase E must ship with backward-compat check against old server

**Total production code: ~380-420 LoC Go + ~50 LoC TypeScript**
**Total test/migration/tooling: ~150-170 LoC additional**

## Alternatives Considered

- **Keep integer version only, skip vector clocks:** Simpler, but cannot detect true concurrency. Two agents that never saw each other's writes look identical to two sequential writes. The memo explicitly chose vector clocks for this reason.
- **Full client-side clock persistence (state.json):** The memo proposes plugins maintain local clocks in `state.json`. This proposal defers that -- the server is authoritative and can assign clocks server-side. Client clocks add value when agents operate offline/disconnected, which is not our current use case.
- **Lamport timestamps instead of vector clocks:** Cheaper (single counter) but cannot distinguish concurrent from sequential writes. Vector clocks are only marginally more complex for our use case (small number of agents per space).

## Risks

- **Clock bloat:** If many unique agents write to the same key, the `vector_clock` JSON grows linearly with agent count. For our expected scale (2-10 agents per space), this is negligible. No pruning in MVP — pruning vector clocks breaks causality guarantees unless a correctness-preserving compaction model (e.g. dotted version vectors) is defined and tested. Revisit only if real scale data shows a problem.
- **Tombstone accumulation:** Soft-deleted records accumulate forever without GC. Mitigation: add a background job or manual API to purge tombstones older than N days. Not required for launch.
- **Backward compatibility:** Existing clients sending no `clock` field take the LWW fast path (unconditional overwrite). They never enter the merge/compare flow and cannot be accidentally dominated by a clock-aware write. A legacy write racing with a clock-aware write on the same key will win by last-write-wins, which is the current contract.
- **Known limitation — no client-side clock persistence in MVP:** Agents that restart lose their clock state and fall back to the LWW fast path (no clock sent). This means intra-session causality is tracked, but cross-session causality is not. The CRDT still provides value for: (1) two simultaneously active agents writing concurrently within the same session, and (2) any future agent that persists its clock. This limitation is intentional for MVP — it reduces client complexity while delivering server-side correctness infrastructure. Client clock persistence is tracked in Future Work.
- **Scope:** This proposal covers server CRDT correctness (Phases A-C), a new convenience endpoint (Phase D), and client contract updates (Phase E). Phases D and E are gated on Phase C being in production (see Implementation Phases). If scope must shrink further, drop Phase D and E entirely — Phase A-C is the correctness core; client plugin updates can be a follow-on proposal.

## Future Work

- **Vector clock on Update (PUT):** The current `If-Match` integer version stays for MVP. Revisit once CRDT upsert is proven in production -- the PUT path may benefit from clock comparison too.
- **Tombstone GC:** Not required for launch. Records live directly in TiDB -- storage is cheap and tombstones are small. Revisit if storage becomes a concern at scale.
- **Bootstrap selection strategy:** Ships as recency-only. Agents search memories at runtime via `memory_search` tool and the `memory-recall` skill, so bootstrap only seeds initial context. Future options: relevance scoring, pinned/starred memories, tag-based filtering.

## Open Questions

~~These must be resolved before starting implementation.~~ **Resolved below.**

1. **Legacy clock-less write behavior** — **Decision: legacy writes always use the LWW fast path.**
   A clock-less write bypasses vector clock comparison entirely and overwrites unconditionally, identical to current Phase 1 behavior. The server does not assign `{agent_name: 1}` and enter the merge path. This avoids the domination trap where a legacy write appears stale. The tradeoff is that a legacy write racing with a clock-aware write will always win regardless of causality; this is acceptable because legacy clients opted out of CRDT semantics. Affected section: Write (Upsert) Flow backward compatibility note — updated below.

2. **Malformed clock error contract** — **Decision: HTTP 400, body `{"error": "invalid clock: <reason>"}`.** This matches the existing error format used by all other validation errors in `handler/handler.go` (`{"error": "..."}`). Validation rejects: non-object JSON, keys that are not strings, values that are not non-negative integers. This is enforced in the handler before the service layer is called.

3. **Winner value on dominated write** — **Decision: dominated write returns HTTP 200 (not 201), body is the existing winning `Memory` (flat, same shape as GET).** HTTP 201 means "resource created or updated". HTTP 200 means "request processed, here is the current state". Callers that check status can distinguish; callers that ignore status get the current content either way — no silent data loss. The `X-Mnemo-Dominated: true` response header signals the no-op without changing the body shape.

## Next Steps

1. Create implementation plan in `.sisyphus/plans/`
2. Implement Phase A-E incrementally, respecting the gating rules in each phase

## Changelog

| Date | Change |
|------|--------|
| 2026-03-02 | Initial draft based on claw-memory v2 memo + codebase analysis |
| 2026-03-02 | Resolved all 3 open questions: PUT clock deferred to post-MVP, no GC needed, bootstrap ships recency-only (agents search at runtime) |
| 2026-03-02 | Revised per second reviewer pass: resolved all 3 open questions (LWW fast path, 400 clock validation, 200 dominated write + header); flattened POST response back to Memory (headers carry merge metadata); reconciled Delete→SoftDelete with agentName propagation; precise write_id idempotency with snapshot column; 503 for retry exhaustion; dropped updated_at from tie-break (pure logical chain); added endpoint behavior matrix with PUT/bulk/tombstone states; added delete retry + idempotent repeated-delete; TiDB/MySQL DDL compatibility notes; gated phase rollout; revised LoC estimates |
| 2026-03-02 | Updated for dual-mode architecture PR: acknowledged existing Metadata/Embedding/Score fields in domain types; added tombstone filter to VectorSearch and KeywordSearch; updated Create signature to include metadata + embedding re-generation; documented DirectBackend as out-of-scope for CRDT (LWW only); removed stale "embedding/vector search" from out-of-scope; updated handler request struct to preserve metadata field; added DirectBackend schema.ts update to Phase E |
| 2026-03-02 | Responded to standalone agent review: (1) added design rationale — concurrency is by design not speculative; (2) fixed write_id scope to per-row, removed incorrect space-scoped unique index from DDL; (3) clarified LWW tombstone revival is intentional, clock-aware path handles the nuance; (4) added known limitation — no client clock persistence in MVP, cross-session causality not tracked; (5) replaced unsafe JSON path string interpolation with Go-side map construction + agentName character set constraint |
