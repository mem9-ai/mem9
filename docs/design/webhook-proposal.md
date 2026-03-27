---
title: "Proposal: Webhook Management & Event Delivery (Issues #139, #140)"
---

## Summary

Add an outbound webhook system to mem9: management CRUD first (#139), then
signed event fan-out (#140). External systems register URLs per space and
receive signed HTTP POSTs after successful memory actions.

Two issues, delivered sequentially:

- **#139** — Webhook management CRUD (register, list, delete)
- **#140** — Signed event fan-out (delivery on business actions)

---

## Background

mem9 exposes a `v1alpha2` API authenticated via `X-API-Key`. The `X-API-Key`
value is used directly as the `TenantID` — resolved in `ResolveApiKey`
middleware (`middleware/auth.go:96`). There is no separate "space" concept;
tenant and space are the same thing. All internal identifiers use `tenantID`
to stay consistent with the existing codebase convention.

Today there is no push mechanism. Consumers must poll, which is inefficient
and couples them to mem9 internals.

---

## Design

### Part 1 — Webhook Management API (#139)

Three new endpoints inside the existing `r.Route("/v1alpha2/mem9s", ...)`
block in `handler/handler.go`. All scoped to the tenant resolved from
`X-API-Key` — no `tenantId` in request body.

| Method | Path | Status | Purpose |
|--------|------|--------|---------|
| `POST` | `/v1alpha2/mem9s/webhooks` | 201 | Register a webhook |
| `GET` | `/v1alpha2/mem9s/webhooks` | 200 | List webhooks for the tenant |
| `DELETE` | `/v1alpha2/mem9s/webhooks/{webhookId}` | 204 | Remove a webhook |

**Rules (from issue #139):**

- One tenant can have multiple webhooks
- `secret` is required on create and is write-only — never returned in any response
- `event_types` defaults to all v1 types if omitted; response returns the resolved list
- `url` must be absolute `http://` or `https://`
- `event_types` must be a subset of the three v1 types
- No update endpoint in v1; delete + recreate is the upgrade path
- List returns a plain JSON array (no pagination wrapper)

**Note on casing:** webhook CRUD request/response fields use **snake_case**
(`event_types`, `created_at`, `updated_at`) consistent with the existing
`/v1alpha2` API convention (`memory_type`, `agent_id`, `created_at`). The
external webhook event envelope uses camelCase per issue #140 spec — that
split is intentional and matches the issue examples.

**Security posture — SSRF:**

`url` validation checks scheme only (http/https). Private-address and internal
DNS blocking is intentionally deferred to the operator's egress policy (e.g.,
network ACLs, security groups). v1 does not implement an allowlist or
private-IP blocking in the server. This is an explicit non-goal; the deployment
guide will document the operator responsibility. If the deployment is
multi-tenant SaaS with untrusted URL input, the operator MUST enforce egress
controls before enabling webhooks.

**Status codes:**

- Invalid `url` or invalid `eventTypes` -> `400 Bad Request`
- Deleting unknown `webhookId` -> `404 Not Found`

**Create request:**

```json
{
  "url": "https://example.com/webhooks/mem9",
  "secret": "whsec_xxx",
  "event_types": ["memory.ingest.completed", "memory.recall.performed"]
}
```

**Create / list item response (secret excluded):**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "url": "https://example.com/webhooks/mem9",
  "event_types": ["memory.ingest.completed", "memory.recall.performed"],
  "created_at": "2026-03-24T10:00:00Z",
  "updated_at": "2026-03-24T10:00:00Z"
}
```

---

### Part 2 — Event Delivery (#140)

After each supported business action succeeds, mem9 fans out one signed HTTP
POST per matching webhook in the tenant. All delivery work is **fully
detached** from the request goroutine — the `Deliver` call spawns a single
goroutine that performs `ListByTenant` and all fan-out sends, so zero
control-plane DB latency lands on the request path.

**v1 event types — full emission matrix:**

One canonical emit point is defined per business action. The table covers every
entrypoint that writes or reads memories.

| Entrypoint | Code path | Emit? | Event | Condition |
|-----------|-----------|-------|-------|-----------|
| `POST /memories` with `messages` | `handler/memory.go` async goroutine → `IngestService.ReconcilePhase2` | Yes | `memory.ingest.completed` | `MemoriesChanged >= 1`; emitted after `ReconcilePhase2` returns inside the goroutine at `handler/memory.go:88-99` |
| `POST /memories` with `content`, LLM configured | `handler/memory.go` async goroutine → `MemoryService.Create` → `IngestService.ReconcileContent` | Yes | `memory.ingest.completed` | `MemoriesChanged >= 1`; emitted after `svc.memory.Create` returns inside the goroutine; `Create` now returns `(*domain.Memory, *IngestResult, error)` — goroutine uses the returned `IngestResult` directly |
| `POST /memories` with `content`, no LLM | `handler/memory.go` async goroutine → `MemoryService.Create` → raw `memories.Create` | Yes | `memory.ingest.completed` | Single memory written (`MemoriesChanged = 1`); same emit point as above; `Create` returns a synthesised `IngestResult{MemoriesChanged:1, InsightIDs:[mem.ID]}` |
| Upload worker (`POST /imports`) — smart mode | `service/upload.go` → `IngestService.Ingest` (LLM path → `extractAndReconcile`) | Yes | `memory.ingest.completed` | `MemoriesChanged >= 1`; emitted after `Ingest` returns in the upload worker loop |
| Upload worker — raw mode / no LLM | `service/upload.go` → `IngestService.Ingest` → `ingestRaw` | Yes | `memory.ingest.completed` | Same; `MemoriesChanged = 1` always when `ingestRaw` succeeds |
| `PUT /memories/{id}` | `MemoryService.Update` succeeds | Yes | `memory.lifecycle.changed` | Only on actual state transition (`UpdateOptimistic` rows affected >= 1); `transition = "update"` |
| `DELETE /memories/{id}` | `MemoryService.Delete` → `SoftDelete` transitions row from non-deleted to `deleted` | Yes | `memory.lifecycle.changed` | Only when `SoftDelete` performs the state transition; NOT when the row is already deleted (idempotent no-op path returns `nil` at `tidb/memory.go:126`). See delete idempotency note below. |
| `GET /memories?q=...` | `handler/memory.go` after `MemoryService.Search` | Yes | `memory.recall.performed` | `q != ""` AND `auth.AgentName != "dashboard"` AND `len(memories) > 0` (memory rows only, session rows excluded) |

**Delete idempotency and lifecycle emission:**

`SoftDelete` already checks the pre-existing `state` column inside a `FOR UPDATE`
transaction before writing. It returns `nil` without touching the row when
`state` is already `'deleted'` (`tidb/memory.go:125-127`). However, `GetByID`
filters `state = 'active'` — probing via `GetByID` before `SoftDelete` would
return `ErrNotFound` for an already-deleted row, breaking the current idempotent
behavior.

The correct fix is to change `SoftDelete` to return `(bool, error)` where the
bool reports whether a real transition was performed. The service layer uses that
signal to decide whether to emit:

```go
// repository interface change
SoftDelete(ctx context.Context, id, agentName string) (changed bool, err error)

// tidb/memory.go: return true when UPDATE executes, false on no-op path
if state.String == string(domain.StateDeleted) {
    return false, nil   // already deleted — idempotent no-op
}
// ... UPDATE ...
return true, tx.Commit()

// service/memory.go
func (s *MemoryService) Delete(ctx context.Context, id, agentName string) error {
    changed, err := s.memories.SoftDelete(ctx, id, agentName)
    if err != nil {
        return err
    }
    if changed {
        s.webhookSvc.Deliver(/* ... */)
    }
    return nil
}
```

This keeps lifecycle emission strictly tied to an observed state transition,
avoids a second DB round-trip, and preserves the existing idempotent-delete
contract exactly.

**`memory.ingest.completed` for `MemoryService.Create` paths:**

`MemoryService.Create` currently returns `(*domain.Memory, error)`. After `Create`
returns in the handler goroutine, the caller has only the final `*domain.Memory`
— it does not have `result.MemoriesChanged` or `result.InsightIDs` from
`ReconcileContent`, so it cannot populate `memoryIds` / `subject.ids` for the
LLM branch.

The fix is to change `MemoryService.Create` to return
`(*domain.Memory, *IngestResult, error)`:

- No-LLM branch: return the created `mem` plus a synthesised
  `&IngestResult{Status: "complete", MemoriesChanged: 1, InsightIDs: []string{mem.ID}}`.
- LLM branch: return the last memory plus the `result` from `ReconcileContent` as-is.

The goroutine in `handler/memory.go:119` then has the full `IngestResult` and can
build the event payload without an additional DB call. `ReconcileContent` itself
must NOT emit to avoid double-send — emission stays at this single point in the
handler goroutine.

**Delivery rules:**

- Fully detached from request path — zero control-plane DB latency on caller
- Best-effort; webhook failure MUST NOT fail the originating API request
- No retry in v1
- Outbound HTTP timeout: 10 seconds per delivery
- Fan-out: one goroutine per matching webhook
- Same `eventId` (UUID) reused across all fan-out deliveries for the same business event
- Both `v1alpha1` and `v1alpha2` paths produce the same external event contract
- **v1 tradeoff — crash-loss is an explicit non-goal:** in-flight deliveries are
  silently dropped on process crash — no persistence, outbox, or watchdog. This
  differs from the upload-task watchdog pattern (`ResetProcessing` on startup),
  which is intentionally absent here. Crash-loss is acceptable only under the
  constraint that downstream consumers treat webhook delivery as a hint and
  must tolerate gaps (e.g., by polling on missed events). At-least-once delivery
  requires an outbox design and is deferred to a future iteration. Any
  acceptance criteria referencing delivery completeness implicitly scope to
  "no crash during delivery"; crash-loss is not a defect in v1.

**Signed request headers:**

```
Content-Type: application/json
X-Mem9-Timestamp: <unix seconds as decimal string>
X-Mem9-Signature-256: sha256=<hex_digest>
```

**Signature algorithm:**

```
HMAC-SHA256(secret, timestamp + "." + rawBody)
```

**Event envelope (camelCase JSON):**

```json
{
  "schemaVersion": "v1",
  "eventId": "...",
  "eventType": "memory.ingest.completed",
  "occurredAt": "2026-03-24T10:00:00Z",
  "spaceId": "<tenantID>",
  "sourceApp": "mem9",
  "agentId": "...",
  "sessionId": "...",
  "subject": {
    "kind": "memory",
    "ids": ["m1", "m2"],
    "primaryId": null
  },
  "data": { ... }
}
```

Note: `spaceId` in the external envelope is the product-facing term; internally
it maps to `auth.TenantID`.

**Envelope field mapping — server inputs to event fields:**

| Envelope field | Source | Notes |
|---------------|--------|-------|
| `spaceId` | `auth.TenantID` | Resolved by middleware from `X-API-Key` or URL `{tenantID}` |
| `agentId` | Per-event sourcing rules below | Meaning varies by emitter — see table |
| `sessionId` | Request body `session_id` field; `""` when absent | Only populated for `messages` ingest paths |
| `sourceApp` | Fixed string `"mem9"` | Not derived from any request field; identifies the emitting system, not the caller |

**`agentId` sourcing rules per emitter:**

The `agentId` field carries different semantics depending on the emit site. It
identifies the agent most directly responsible for the change, which is the
memory-owner on write paths and the searching actor on recall paths:

| Emitter | `agentId` source | Semantics |
|---------|-----------------|-----------|
| `POST /memories` with `messages` | Request body `agent_id` field; falls back to `auth.AgentName` | Memory-owner agent (the entity whose memories are being ingested) |
| `POST /memories` with `content` | Request body `agent_id` field; falls back to `auth.AgentName` | Memory-owner agent |
| Upload worker (`POST /imports`) | `IngestRequest.AgentID` | Memory-owner agent set by the upload task |
| `PUT /memories/{id}` | `auth.AgentName` (`X-Mnemo-Agent-Id` header) | Calling actor performing the update |
| `DELETE /memories/{id}` | `auth.AgentName` | Calling actor performing the delete |
| `GET /memories?q=...` | `auth.AgentName` | Searching actor |

No field renaming (`actorAgentId`) is introduced in v1. The per-event sourcing
rules above fully specify which value to use at each emit point; implementors
must follow this table rather than applying a single fallback.

**`sourceApp` rule:** fixed `"mem9"` always. Not derived from any header.

**`subject.kind` rule:** fixed `"memory"` for all v1 event types (spec-mandated).

**`subject.primaryId` rule:** if exactly one ID affected, set to that ID; if
multiple, set to `null`.

**Event-specific `data`:**

`memory.ingest.completed`:
- `status`, `memoriesChanged`, `memoryIds`, `memorySummaries` (omit when
  absent — LLM path only), `warnings`
- Each `memorySummaries[]` entry: `memoryId`, `tags` (optional)
- Full memory content NOT included

`memory.recall.performed`:
- `hitCount` — count of memory-only hits (session rows excluded)
- `queryHash` — SHA-256 of raw `q` param
- `intent` — fixed string `"recall"`
- `results[]` — memory-only rows; each entry: `memoryId`, `rank` (1-based),
  `score` (nullable — present on hybrid/FTS/auto paths; `null` on
  keyword-only fallback path per `keywordOnlySearch`)
- Session rows are excluded from the recall event entirely
- If zero memory rows in the result (all hits were session rows), event does NOT fire
- `subject.kind` is `"memory"` (fixed in v1 per spec)
- `subject.ids` populated from memory-only result IDs
- Full content and per-result tags NOT included

`memory.lifecycle.changed`:
- `transition` (`update` | `delete`), `memoryId`,
  `oldMemoryId` (optional), `supersededBy` (optional)

---

## Implementation Plan

### New files

| File | Contents |
|------|----------|
| `server/internal/domain/webhook.go` | `Webhook`, `WebhookEvent`, `WebhookSubject` structs; `EventType` constants |
| `server/internal/repository/tidb/webhook.go` | TiDB SQL impl of `WebhookRepo` |
| `server/internal/repository/db9/webhook.go` | Full SQL impl of `WebhookRepo` for db9 backend |
| `server/internal/repository/postgres/webhook.go` | Full SQL impl of `WebhookRepo` for postgres backend |
| `server/internal/service/webhook.go` | `WebhookService`: Create / List / Delete + `Deliver` |
| `server/internal/handler/webhook.go` | Three HTTP handlers |

### Modified files

| File | Change |
|------|--------|
| `server/internal/domain/types.go` | No change needed — `Intent` field removed from scope |
| `server/internal/repository/repository.go` | Update `MemoryRepo.SoftDelete` interface signature to `(bool, error)`; add `WebhookRepo` interface |
| `server/internal/repository/tidb/memory.go` | Change `SoftDelete` to return `(bool, error)`; return `true` when the UPDATE executes, `false` on the already-deleted no-op path |
| `server/internal/repository/postgres/memory.go` | Change `SoftDelete` to return `(bool, error)` — ripple from interface change (line 85) |
| `server/internal/repository/db9/memory.go` | Change `SoftDelete` to return `(bool, error)` — delegates to embedded postgres repo; ripple from interface change (line 49) |
| `server/internal/repository/tidb/memory_integration_test.go` | Update all 7 `SoftDelete` call sites to handle `(bool, error)` return |
| `server/internal/service/ingest_test.go` | Update `memoryRepoMock.SoftDelete` at line 72 to return `(bool, error)` |
| `server/internal/repository/factory.go` | Add `NewWebhookRepo(backend, db)` dispatching to all three backends |
| `server/internal/handler/handler.go` | Add `webhookSvc *service.WebhookService` to `Server`; three new routes in `v1alpha2` block; update `NewServer` |
| `server/internal/handler/memory.go` | After memory search (before session append), if `filter.Query != ""` and `auth.AgentName != "dashboard"` and `len(memories) > 0`, call `webhookSvc.Deliver` for recall; in the content-mode create goroutine, call `webhookSvc.Deliver` for `ingest.completed` using the `*IngestResult` returned by the updated `MemoryService.Create`; update call at line 120 to handle new `(*domain.Memory, *IngestResult, error)` return |
| `server/internal/service/ingest.go` | Add `webhookSvc *WebhookService` field; call `Deliver` at success returns |
| `server/internal/service/memory.go` | Add `webhookSvc *WebhookService` field; call `Deliver` at Update success; change `Create` signature to `(*domain.Memory, *IngestResult, error)`; change `Delete` to use `SoftDelete` `(bool, error)` return and emit `lifecycle.changed` only when `changed == true` |
| `server/internal/service/upload.go` | Pass `webhookSvc` when constructing `IngestService` at L187 |
| `server/schema.sql` | Add `webhooks` DDL (TiDB/MySQL syntax) |
| `server/schema_pg.sql` | Add `webhooks` DDL (postgres syntax) |
| `server/schema_db9.sql` | Add `webhooks` DDL (postgres syntax) |
| `server/cmd/mnemo-server/main.go` | Wire `NewWebhookRepo` + `NewWebhookService`; pass to handler and all service constructors |

### `WebhookRepo` interface

```go
// repository/repository.go
type WebhookRepo interface {
    Create(ctx context.Context, w *domain.Webhook) error
    ListByTenant(ctx context.Context, tenantID string) ([]*domain.Webhook, error)
    GetByID(ctx context.Context, id string) (*domain.Webhook, error)
    Delete(ctx context.Context, id, tenantID string) error
}
```

### `WebhookService` — full constructor and struct

```go
// service/webhook.go
type WebhookService struct {
    repo       repository.WebhookRepo
    encryptor  encrypt.Encryptor
    httpClient *http.Client       // shared, 10s timeout
    logger     *slog.Logger
}

func NewWebhookService(
    repo repository.WebhookRepo,
    encryptor encrypt.Encryptor,
    logger *slog.Logger,
) *WebhookService {
    return &WebhookService{
        repo:       repo,
        encryptor:  encryptor,
        httpClient: &http.Client{Timeout: 10 * time.Second},
        logger:     logger,
    }
}
```

`Create` encrypts the caller-supplied secret via `encryptor.Encrypt` before
storing. `deliver` (private) decrypts via `encryptor.Decrypt` before computing
the HMAC.

### `Deliver` — fully detached

```go
// Deliver is fully detached: spawns one goroutine that performs ListByTenant
// and all fan-out sends. Zero control-plane DB latency on the caller.
func (s *WebhookService) Deliver(tenantID string, event *domain.WebhookEvent) {
    go func() {
        ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
        defer cancel()
        hooks, err := s.repo.ListByTenant(ctx, tenantID)
        if err != nil {
            s.logger.Warn("webhook deliver: list failed", "tenant", tenantID, "err", err)
            return
        }
        for _, h := range hooks {
            if !h.Subscribes(event.EventType) {
                continue
            }
            hook := h
            go func() {
                if err := s.deliver(hook, event); err != nil {
                    s.logger.Warn("webhook deliver: send failed",
                        "webhook_id", hook.ID, "err", err)
                }
            }()
        }
    }()
}
```

### `IngestService` constructor sites — all three must be updated

| File | Line | Notes |
|------|------|-------|
| `handler/handler.go` | ~85 | `resolveServices` branch where `auth.TenantID == ""` |
| `handler/handler.go` | ~108 | `resolveServices` branch where `auth.TenantID != ""` |
| `upload.go` | 187 | Upload worker — constructs its own `IngestService` per task |

Both `resolveServices` branches cover all request paths; the split is solely on
whether `auth.TenantID` is populated at the time `resolveServices` runs.
Both branches receive `webhookSvc` as a new parameter. `MemoryService` is
constructed at the same two sites and also receives `webhookSvc`.

### Recall hook — correct injection point

The hook fires **after `MemoryService.Search` returns** (`handler/memory.go`
after L184), before session append. Only memory rows count — session rows are
excluded from the recall event. If `auth.AgentName == "dashboard"`, skip.

```go
// after L184 (MemoryService.Search success), before session append
if filter.Query != "" && auth.AgentName != "dashboard" && len(memories) > 0 {
    eventID := uuid.New().String()
    s.webhookSvc.Deliver(auth.TenantID, buildRecallEvent(eventID, auth, filter.Query, memories))
}
```

### DB schema

Three schema files need the `webhooks` table. Column naming uses `tenant_id`
consistent with all existing control-plane tables.

**TiDB (`schema.sql`):**

```sql
CREATE TABLE IF NOT EXISTS webhooks (
  id           VARCHAR(36)   NOT NULL PRIMARY KEY,
  tenant_id    VARCHAR(36)   NOT NULL,
  url          TEXT          NOT NULL,
  secret       TEXT          NOT NULL,
  event_types  JSON          NOT NULL,
  created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_webhooks_tenant (tenant_id)
);
```

**PostgreSQL / db9 (`schema_pg.sql`, `schema_db9.sql`):**

The same `webhooks` table is added in standard postgres syntax (no `ON UPDATE`
trigger — use a separate `BEFORE UPDATE` trigger or application-level update if
`updated_at` tracking is needed). The column structure is identical to the TiDB
schema.

### Secret storage

`secret` column stores the value passed through the existing
`encrypt.Encryptor`. Identical pattern to tenant DB password storage
(`service/tenant.go:82`). No new env vars or infrastructure required.

### ID generation

Use `uuid.New().String()` (already imported everywhere) for webhook IDs and
`eventId`. No ULID library exists in the codebase.

---

## Open Questions

The following questions block implementation and must be resolved before coding
begins. Current resolution status is noted for each.

| # | Question | Resolution |
|---|----------|------------|
| 1 | Should a repeated `DELETE /memories/{id}` (row already deleted) emit `memory.lifecycle.changed`? | **No.** Emission is tied to an observed state transition (pre-state != `deleted`). Idempotent no-ops are silent. See delete idempotency note above. |
| 2 | Should `POST /memories` with `content` (no LLM) emit `memory.ingest.completed`? | **Yes.** Single raw write emits `MemoriesChanged = 1`. Emit point is the goroutine in `handler/memory.go` after `Create` returns. |
| 3 | What exactly are `agentId` and `sourceApp`? | **`agentId`**: request body `agent_id` field, falls back to `auth.AgentName`. **`sourceApp`**: fixed `"mem9"`. See envelope field mapping table above. |
| 4 | Is crash-loss acceptable with no outbox? | **Yes, explicitly, for v1.** Consumers must tolerate gaps. At-least-once delivery is a future iteration. See v1 tradeoff note above. |
| 5 | Should postgres/db9 backends implement webhook repos or return 501? | **Implement all three.** The webhook SQL is standard `database/sql` with no TiDB-specific syntax; the same repo compiles cleanly for postgres and db9. Stubs returning `ErrNotSupported` leave webhook management permanently broken on those backends for no code-saving benefit. **Decision: implement `repository/tidb/webhook.go`, `repository/db9/webhook.go`, and `repository/postgres/webhook.go` with full SQL; remove 501 stub paths. `schema_pg.sql` and `schema_db9.sql` receive the `webhooks` DDL in postgres syntax.** |

---

## Acceptance Criteria

- [ ] Tenant can create, list, and delete webhooks via `v1alpha2`
- [ ] `secret` is never returned in any response
- [ ] Events fan out to all matching webhooks in the current tenant
- [ ] `Deliver` is fully detached — zero control-plane DB latency on request path
- [ ] Outbound HTTP timeout is 10 seconds per delivery
- [ ] Webhook failure does not fail the originating API request
- [ ] `memory.recall.performed` emitted when `q != ""` and `X-Mnemo-Agent-Id != "dashboard"` and >= 1 memory hit; not emitted when `q` empty, caller is dashboard, or zero memory hits
- [ ] `memory.ingest.completed` emitted only when `MemoriesChanged >= 1`
- [ ] Both `v1alpha1` and `v1alpha2` paths produce the same event contract
- [ ] Webhook CRUD wire fields use snake_case (`event_types`, `created_at`, `updated_at`); event envelope uses camelCase per issue #140 spec
- [ ] HMAC-SHA256 signature verifiable by consumers
- [ ] `eventId` is stable across all fan-out deliveries for the same business event
- [ ] Upload worker `IngestService` also emits ingest events
- [ ] `WebhookRepo` implemented for TiDB, postgres, and db9 backends
- [ ] `memory.lifecycle.changed` emitted on delete only when a real state transition occurred (pre-state != `deleted`); repeated deletes of an already-deleted row do NOT emit
- [ ] Silent drop on process crash is an explicit non-goal; consumers must tolerate delivery gaps
- [ ] `memory.ingest.completed` emitted for all `POST /memories` content-mode creates (both no-LLM raw write and LLM ReconcileContent path), when `MemoriesChanged >= 1`

---

## Test Scope

| Area | File | Status |
|------|------|--------|
| `WebhookService` CRUD, URL/secret/eventType validation | `service/webhook_test.go` | ✅ implemented |
| HMAC signature correctness (known secret + body) | `service/webhook_test.go` | ✅ implemented |
| `Deliver` is non-blocking | `service/webhook_test.go` | ✅ implemented |
| `BuildIngestEvent` primaryId contract (single vs multi IDs) | `service/webhook_test.go` | ✅ implemented |
| `MemoryService.Delete` emits `lifecycle.changed` | `service/webhook_test.go` | ✅ implemented |
| `MemoryService.Update` emits `lifecycle.changed` | `service/webhook_test.go` | ✅ implemented |
| POST/GET/DELETE HTTP status codes; secret never returned | `handler/webhook_test.go` | ✅ implemented |
| TiDB repo CRUD: CreateIfBelowLimit, List, GetByID, Delete, Count, timestamps, limit enforcement | `repository/tidb/webhook_integration_test.go` (`-tags=integration`) | ✅ implemented |
| Postgres repo CRUD: same coverage as TiDB | `repository/postgres/webhook_integration_test.go` (`-tags=integration`, requires `MNEMO_PG_TEST_DSN`) | ✅ implemented |
| db9 repo construction and embedding delegation | `repository/db9/webhook_test.go` | ✅ implemented (unit only; db9 embeds postgres, full CRUD covered by postgres tests) |
| `IngestService` emission after smart/raw ingest | — | ⚠️ not tested — ingest delivery fires in the handler goroutine after `ReconcilePhase2`; covered by architecture but no dedicated unit test |
| Recall hook: fires on `q + non-dashboard`; suppressed on empty `q` or `AgentName=dashboard` | — | ⚠️ not tested — recall hook fires inside `listMemories` handler which requires full service stack; covered by architecture but no dedicated integration test |

---

## Effort Estimate

| Area | Net LoC |
|------|---------|
| `domain/webhook.go` | ~60 |
| `repository/tidb/webhook.go` | ~100 |
| `repository/db9/webhook.go` + `repository/postgres/webhook.go` (full SQL impl) | ~80 |
| `service/webhook.go` (CRUD + Deliver + HMAC) | ~150 |
| `handler/webhook.go` (3 handlers + validation) | ~120 |
| Hook injections (ingest x3, memory x2, handler recall) + `SoftDelete`/`Create` interface changes | ~60 |
| `domain/types.go` (no change) + removed `MemoryFilter.Intent` | ~0 |
| Wiring: repository.go, factory.go, handler.go, upload.go, main.go | ~50 |
| Schema DDL (TiDB + postgres/db9) | ~20 |
| Tests | ~130 |
| **Total** | **~800 LoC** |

---

*References: [#139](https://github.com/mem9-ai/mem9/issues/139) |
[#140](https://github.com/mem9-ai/mem9/issues/140)*
