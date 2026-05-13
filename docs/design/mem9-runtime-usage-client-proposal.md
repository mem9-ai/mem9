---
title: mem9-server Runtime Usage Client Proposal
status: draft
created: 2026-05-13
last_updated: 2026-05-13
sources:
  - https://github.com/mem9-ai/mem9-console-server/issues/13
  - https://github.com/mem9-ai/mem9-console-server/issues/16
---

## Summary

Add a billing-grade runtime quota client plus console-shaped async metering
writer support to mem9-server so commercial SaaS mode can call the
console-server internal runtime APIs defined in issues #13 and #16.

The client should:

1. Reserve quota before recall and memory create operations.
2. Commit or release reservations after operation completion.
3. Apply quota adjustments after successful delete, merge, or cleanup operations.
4. Hand metering events to the existing `server/internal/metering.Writer` after
   quota commit or adjustment.
5. Retry quota finalization with the same `operationId` until console accepts the
   operation or the work is durably queued locally.

This must stay generic. mem9-server should know only runtime facts, operation
types, meters, units, and API endpoints. Console-server continues to own org,
plan, quota bucket, billing period, S3, Stripe, and rollup logic.

## Background

Issue #13 defines the synchronous quota gate:

1. `PUT /api/internal/quota/reservations/{operationId}`
2. `PATCH /api/internal/quota/reservations/{operationId}`
3. `PUT /api/internal/quota/adjustments/{operationId}`

Issue #16 defines the service boundary and metering ledger:

1. `PUT /api/internal/metering/events/{operationId}`
2. `Authorization: Bearer <internalSecret>` identifies mem9-server.
3. `X-API-Key: <apiKey>` identifies the quota subject.
4. `operationId` links quota and metering for one billable or quota-affecting
   operation.

This proposal includes an inline contract appendix because the console-server
issues are private to some reviewers. The appendix is copied from issues #13 and
#16 as read on 2026-05-13 and should be treated as the implementation contract
until `docs/api/openapi-internal-v1.yaml` is available in console-server.

Contract precedence for A1:

1. If `docs/api/openapi-internal-v1.yaml` exists in console-server, implement the
   OpenAPI contract.
2. Until OpenAPI exists, use issue #16's explicit runtime flow for successful
   usage: mem9-server calls `PATCH /api/internal/quota/reservations/{operationId}`
   with `status: "committed"` after the mem9 operation succeeds, then submits
   `PUT /api/internal/metering/events/{operationId}`.
3. Treat issue #13's state-machine sentence that says metering acceptance
   performs `reserved -> committed` as stale relative to issue #16. Console
   should resolve this in OpenAPI before implementation begins.
4. Use issue #13's quota error name `reservation_conflict`. Do not introduce
   `operation_conflict` unless OpenAPI explicitly adds it.

Current mem9-server already has an optional metering writer. The `Writer`
interface is the right async sidecar shape for metering, but the HTTP/webhook
implementation is not the right API shape or reliability level for
console-server yet. It currently posts a generic webhook event with a generated
event ID, while console-server requires
`PUT /api/internal/metering/events/{operationId}` using the same `operationId`
as quota. For commercial runtime usage, the HTTP writer must become
outbox-backed so successful usage is retried until console accepts or the work
is in a manual-reconciliation terminal state.

Relevant current code:

1. `server/internal/handler/memory.go:297` runs recall/search in
   `listMemories`, and records recall metering only after success at
   `server/internal/handler/memory.go:360`.
2. `server/internal/handler/memory.go:43` handles memory creation. Sync creates
   return after writes at `server/internal/handler/memory.go:150` and
   `server/internal/handler/memory.go:163`; async creates run in goroutines at
   `server/internal/handler/memory.go:106` and
   `server/internal/handler/memory.go:173`.
3. `server/internal/handler/memory.go:496` handles single delete, and
   `server/internal/handler/memory.go:514` handles batch delete.
4. `server/internal/handler/metering.go:26` and
   `server/internal/handler/metering.go:41` send the current optional metering
   events.
5. `server/internal/metering/writer.go:31` defines `Writer.Record` as
   non-blocking, and `server/internal/metering/transport_writer.go:289` drops a
   failed S3 batch after logging.
6. `server/internal/metering/webhook_writer.go:241` builds a generic webhook
   event with a generated `evt_...` ID instead of using the console
   `operationId`.

## Goals

1. Add a generic runtime usage quota client for console-server internal quota
   APIs.
2. Reuse the existing `server/internal/metering.Writer` interface for async
   console metering.
3. Gate recall and memory create before execution in commercial mode.
4. Use quota adjustments after successful memory deletion and reconciliation
   cleanup.
5. Durably enqueue metering events only after quota commit or adjustment
   succeeds, then deliver them through the existing metering writer surface.
6. Keep raw API keys out of logs and public responses.
7. Support disabled mode for OSS and self-hosted deployments.

## Non-Goals

1. Do not implement console billing, plan, bucket, S3, Stripe, or rollup logic in
   mem9-server.
2. Do not replace public mem9 API authentication.
3. Do not make console-server a hard dependency for OSS mode.
4. Do not add a second metering-specific interface when the existing
   `metering.Writer` interface can carry console events.
5. Do not use the async metering writer for quota reservations, quota commits,
   releases, or adjustments.
6. Do not solve public request idempotency from agents to mem9-server in this
   proposal.

## Proposed Architecture

Add a new package:

```text
server/internal/runtimeusage/
```

Core interfaces:

```go
type QuotaClient interface {
    Reserve(ctx context.Context, subject Subject, op Operation) (*Reservation, error)
    FinalizeReservation(ctx context.Context, subject Subject, operationID string, status ReservationFinalStatus, reason string) error
    ApplyAdjustment(ctx context.Context, subject Subject, op Adjustment) error
}

type Manager interface {
    BeforeRecall(ctx context.Context, subject Subject) (*OperationLease, error)
    AfterRecallSuccess(ctx context.Context, lease *OperationLease, result RecallResult) error
    AfterRecallFailure(ctx context.Context, lease *OperationLease, cause error)
    BeforeMemoryCreate(ctx context.Context, subject Subject, units int64) (*OperationLease, error)
    AfterMemoryCreateSuccess(ctx context.Context, lease *OperationLease, result MemoryCreateResult) error
    AfterMemoryCreateFailure(ctx context.Context, lease *OperationLease, cause error)
    BeforeMemoryDelete(ctx context.Context, subject Subject, target MemoryDeleteTarget) (*OperationLease, error)
    AfterMemoryDeleteSuccess(ctx context.Context, lease *OperationLease, result MemoryDeleteResult) error
    AfterMemoryDeleteFailure(ctx context.Context, lease *OperationLease, cause error)
}
```

`QuotaClient` is a thin HTTP API client for quota reservations, reservation
finalization, and adjustments. `Manager` owns operation generation, reservation
sequencing, durable quota retry handoff, disabled-mode no-op behavior, durable
metering enqueue after quota finalization, and the handoff to `metering.Writer`.
For deletes, `BeforeMemoryDelete` creates `adjustment_intent` before the mem9
delete executes so a crash cannot erase the operation boundary. Handlers should
depend on `Manager`, not raw HTTP calls.

`operationId` uses `github.com/google/uuid.NewV7`. The server already pins
`github.com/google/uuid v1.6.0`, which includes UUIDv7 support.

Console metering stays in the existing package:

```text
server/internal/metering/
```

Do not add a new metering interface. Keep the current interface:

```go
type Writer interface {
    Record(evt Event)
    Close(ctx context.Context) error
}
```

Extend `metering.Event` with console fields:

```go
type Event struct {
    Category string
    TenantID string
    ClusterID string
    AgentID string
    Data map[string]any

    OperationID string
    APIKeySubject string
    EventType string
    Meter string
    Units int64
    OccurredAt time.Time
    MemoryIDs []string
}
```

The quota manager generates `OperationID` and passes it into
`metering.Event`. The writer must not generate console operation IDs because
issues #13 and #16 require the same `operationId` across quota and metering for
the same operation.

## Configuration

Add config fields:

| Env var | Meaning |
| --- | --- |
| `MNEMO_RUNTIME_USAGE_ENABLED` | Enables commercial runtime usage integration: synchronous quota gate plus console billing metering. Default `false`. |
| `MNEMO_RUNTIME_USAGE_BASE_URL` | Console-server base URL for internal quota and metering APIs. Required when enabled. |
| `MNEMO_RUNTIME_USAGE_INTERNAL_SECRET` | Bearer secret for internal APIs. Required when enabled. |
| `MNEMO_RUNTIME_USAGE_TIMEOUT` | Per-request timeout for synchronous quota APIs. Default `3s`. |
| `MNEMO_RUNTIME_USAGE_METERING_TIMEOUT` | Per-request timeout for async console metering API delivery. Default `5s`. |
| `MNEMO_RUNTIME_USAGE_RESERVATION_TTL` | Fallback reservation TTL for local watchdogs when console response does not include `expiresAt`. Default `30m`. |
| `MNEMO_RUNTIME_USAGE_OPERATION_TTL` | Fallback TTL for adjustment-backed operations that have no console reservation expiry. Default `30m`. |
| `MNEMO_RUNTIME_USAGE_FAIL_OPEN` | Development-only override. Default `false`. Production should fail closed. |
| `MNEMO_RUNTIME_USAGE_OUTBOX_ENABLED` | Enables local durable retry outbox. Default follows runtime usage enabled. |
| `MNEMO_METERING_ENABLED` | Enables optional legacy/export metering writer. Not required for console billing metering. Default `false`. |
| `MNEMO_METERING_URL` | Optional legacy/export metering destination, such as `s3://`, `http://`, or `https://`. Not used to build console billing metering URLs. |
| `MNEMO_METERING_FLUSH_INTERVAL` | Existing legacy/export metering flush interval. Not used by console billing metering. |

Validation should redact the base URL and never log the secret.

Commercial runtime usage should be legible from configuration alone:
`MNEMO_RUNTIME_USAGE_ENABLED=true` means mem9-server will perform quota gating
and console billing metering against `MNEMO_RUNTIME_USAGE_BASE_URL`.
`MNEMO_METERING_ENABLED` remains an independent optional export feature and must
not be required for console billing correctness.

When runtime usage is enabled, console metering sends to
`{MNEMO_RUNTIME_USAGE_BASE_URL}/api/internal/metering/events/{operationId}` and
uses `MNEMO_RUNTIME_USAGE_INTERNAL_SECRET` for
`Authorization: Bearer <internalSecret>`. `MNEMO_METERING_URL` must not override
or shadow this console URL. If legacy/export metering is also enabled, it runs as
a separate sidecar destination.

## Subject Identity

Console-server requires `X-API-Key` as the quota subject. Current v1alpha2 auth
resolves this header in `server/internal/middleware/auth.go:215`, but
`domain.AuthInfo` currently stores only tenant and cluster identity at
`server/internal/domain/types.go:58`.

Add an in-memory field:

```go
type AuthInfo struct {
    AgentName string
    TenantID string
    TenantDB *sql.DB
    ClusterID string
    APIKeySubject string
}
```

Rules:

1. v1alpha2 routes set `APIKeySubject` from the trimmed `X-API-Key`.
2. v1alpha1 path-token routes set `APIKeySubject` to the tenant ID only if
   runtime usage is enabled for that route. Otherwise leave it empty.
3. Do not log `APIKeySubject`.
4. Durable retry storage should not store raw API keys in A1. Because the current
   API key subject is the tenant ID, store `tenant_id` plus
   `subject_version = "tenant_id_v1"` in the outbox. If API keys later diverge
   from tenant IDs, add an encrypted subject column in that migration.
5. A1 runtime usage requires the current invariant that API key subject equals
   tenant ID. If API key semantics change before encrypted subject storage is
   implemented, operators must drain or migrate `runtime_usage_outbox` before
   enabling the new key model.

## Internal API Contract

All calls use:

```http
Authorization: Bearer <internalSecret>
X-API-Key: <apiKey>
```

`operationId` is a UUIDv7 generated by mem9-server. Network retries reuse the
same `operationId` and the same canonical payload.

### Reserve Quota

```http
PUT /api/internal/quota/reservations/{operationId}
```

Request:

```json
{"meter":"recalls","units":1}
```

For memory-slot creates, use `{"meter":"memory_slots","units":<positive-int>}`.

Success response:

```json
{
  "operationId": "018f7f3a-7b8c-7c2d-9a5b-6d7e8f901234",
  "meter": "recalls",
  "units": 1,
  "status": "reserved",
  "expiresAt": "2026-04-28T12:00:00Z",
  "remainingIncludedUnits": 999,
  "reservedUnits": 1,
  "overageAllowed": false
}
```

Quota denial uses `402`:

```json
{
  "code": "quota_exhausted",
  "message": "Included recall quota is exhausted.",
  "meter": "recalls",
  "limitType": "includedQuota",
  "retryable": false,
  "upgradeAction": "upgradePlan"
}
```

Known quota error codes from issue #13 are `quota_exhausted`,
`spending_limit_exceeded`, `api_key_unbound`, `reservation_conflict`, and
`meter_not_supported`.

### Commit Or Release Reservation

```http
PATCH /api/internal/quota/reservations/{operationId}
```

Commit request:

```json
{"status":"committed","reason":"operationSucceeded"}
```

Release request:

```json
{"status":"released","reason":"operationFailed"}
```

The response echoes `operationId`, `meter`, `units`, final `status`,
`expiresAt`, `remainingIncludedUnits`, `reservedUnits`, and `overageAllowed`.

### Apply Quota Adjustment

```http
PUT /api/internal/quota/adjustments/{operationId}
```

Request:

```json
{"meter":"memory_slots","delta":-3,"reason":"memoryDeleted"}
```

Response:

```json
{
  "operationId": "018f7f3a-7b8c-7c2d-9a5b-6d7e8f901234",
  "meter": "memory_slots",
  "delta": -3,
  "reason": "memoryDeleted",
  "status": "applied",
  "remainingIncludedUnits": 4662
}
```

### Submit Metering Event

```http
PUT /api/internal/metering/events/{operationId}
```

Request:

```json
{
  "eventType": "recall",
  "meter": "recalls",
  "units": 1,
  "occurredAt": "2026-04-28T12:00:00Z",
  "agentName": "Codex",
  "memoryIds": ["mem_123", "mem_456"]
}
```

Response:

```json
{"operationId":"018f7f3a-7b8c-7c2d-9a5b-6d7e8f901234","status":"accepted","deduped":false}
```

Metering is accepted only after the matching reservation is committed or the
matching adjustment is applied. Same `operationId` plus same canonical payload is
idempotent; same `operationId` with a different payload returns `409`.

## Operation Flows

### Recall

Only query-based search is billable. Plain list requests with no `q` should not
reserve recall quota. A query recall is billed once it executes, even if it
returns zero memories, because the server still performs embedding/vector/keyword
work. This is an explicit product choice for A1 and should be mirrored in console
usage copy.

Flow:

1. Handler detects `filter.Query != ""`.
2. Manager generates UUIDv7 `operationId` with `uuid.NewV7`.
3. Manager calls:

```http
PUT /api/internal/quota/reservations/{operationId}
Authorization: Bearer <internalSecret>
X-API-Key: <apiKey>

{"meter":"recalls","units":1}
```

4. On `402`, return a stable 402 response to the caller without executing
   recall.
5. On transient failure, fail closed with `503` unless development fail-open is
   explicitly enabled.
6. Execute existing recall.
7. On success, persist `commit_pending` with the metering payload, then commit
   reservation.
8. Only after console returns committed or idempotent committed, persist
   `metering_pending` and call `metering.Writer.Record` with a console-shaped
   metering event:

```json
{
  "operationId": "018f7f3a-7b8c-7c2d-9a5b-6d7e8f901234",
  "apiKeySubject": "<apiKey>",
  "eventType": "recall",
  "meter": "recalls",
  "units": 1,
  "occurredAt": "2026-05-13T00:00:00Z",
  "agentName": "Codex",
  "memoryIds": ["..."]
}
```

9. If commit has a retryable or ambiguous failure after recall succeeded,
   persist `commit_pending` and return success. The worker retries the commit
   first and does not call `Record` until console ACKs the commit.
10. If post-execution durable enqueue also fails, do not convert the already
    completed recall into a client-visible `503`. Return the successful recall
    response, emit an ERROR log with `operationId`, tenant ID, cluster ID, step,
    and payload hash, and increment a `manual_reconciliation_required` metric.
    Fail-closed responses apply only before the mem9 operation starts.
11. If async metering delivery fails after `Record`, the console writer retries
    `submit_metering_event` with the same `operationId` until console accepts or
    the row reaches `terminal_failed`.

Handler shape:

```go
if filter.Query != "" {
    lease, err := s.runtimeUsage.BeforeRecall(r.Context(), subjectFromAuth(auth))
    if err != nil {
        s.handleRuntimeUsageError(r.Context(), w, err)
        return
    }
    finalized := false
    defer func() {
        if !finalized {
            s.runtimeUsage.AfterRecallFailure(context.Background(), lease, context.Canceled)
        }
    }()

    memories, total, err = executeRecallSearch(r.Context(), auth, svc, filter)
    if err != nil {
        s.runtimeUsage.AfterRecallFailure(context.Background(), lease, err)
        finalized = true
        s.handleError(r.Context(), w, err)
        return
    }
    if err := s.runtimeUsage.AfterRecallSuccess(r.Context(), lease, runtimeusage.RecallResult{
        MemoryIDs: memoryIDs(memories),
        AgentName: auth.AgentName,
    }); err != nil {
        s.logger.Error("runtime usage post-recall finalization failed",
            "operation_id", lease.OperationID,
            "tenant_id", auth.TenantID,
            "cluster_id", auth.ClusterID,
            "err", err)
    }
    finalized = true
}
```

### Memory Create

Memory create is harder than recall because the current smart ingest path can
change an unknown number of active memories.

Before handler integration, refactor the known-unit service write methods to
return an explicit `UsageDelta`. This is required for A1 create/delete quota
correctness, but the smart-ingest-specific `UsageDelta` plumbing is deferred to
A2 because A1 blocks those request shapes in runtime-usage mode.

Known-unit paths:

1. Explicit pinned create reserves `memory_slots` units `1`.
2. Bulk create reserves `memory_slots` units `len(input.memories)`. The current
   `MemoryService.BulkCreate` returns only `([]domain.Memory, error)`, so A1 must
   refactor it to return `UsageDelta` before wiring quota.
3. Batch import of a known memory file can reserve the number of valid memory
   records before writing.

Unknown-unit paths:

1. Smart content ingest and message ingest can ADD, UPDATE, and DELETE insights.
2. `service.IngestResult` reports `MemoriesChanged` at
   `server/internal/service/ingest.go:56`, but the field counts ADD and UPDATE,
   not net active memory-slot delta.
3. Reconciliation deletes insights at `server/internal/service/ingest.go:1266`,
   but deleted IDs are not returned to the handler.

Recommended A1 behavior:

1. Add a production `UsageDelta` result from service operations:

```go
type UsageDelta struct {
    MemorySlotsDelta int64
    CreatedMemoryIDs []string
    DeletedMemoryIDs []string
    UpdatedMemoryIDs []string
}
```

2. For known-unit creates, reserve before execution using the known positive
   `MemorySlotsDelta`.
3. For smart ingest, do not reserve a guessed `1` unit. A1 will block
   unknown-delta smart ingest in runtime-usage mode and ship recall plus
   known-unit memory CRUD first. Plan/apply smart ingest is deferred to A2.
4. Durably enqueue and record the actual usage delta with `metering.Writer` only
   after commit or adjustment is accepted or idempotently deduped by console.

This keeps quota gating in front of memory creation while avoiding silent
under-counting for multi-insight ingest. Commercial SaaS returns a deterministic
`409` for smart ingest paths instead of accepting ungated async writes.

Blocked A1 request shapes when `MNEMO_RUNTIME_USAGE_ENABLED=true`:

1. `POST /memories` with `messages` non-empty, sync or async.
2. `POST /memories` with `content` and no explicit
   `memory_type: "pinned"`, sync or async.
3. Any async content/message create path that would return `202` before quota
   reservation and metering state are durable.

Response:

```json
{
  "code": "runtime_usage_requires_known_memory_delta",
  "message": "runtime usage mode requires a known memory_slots delta; use pinned memory create or disable runtime usage for smart ingest",
  "retryable": false
}
```

### Memory Delete And Batch Delete

Delete operations create a durable adjustment intent first, execute mem9 work,
then apply adjustment only if the returned `UsageDelta` shows active memory
slots decreased.

Single delete flow:

1. Call `BeforeMemoryDelete` to persist `adjustment_intent` with the target
   memory ID before executing `svc.memory.Delete`.
2. Execute `svc.memory.Delete`.
3. Use the returned `UsageDelta.MemorySlotsDelta`.
4. If `MemorySlotsDelta == 0`, transition `adjustment_intent -> done` and skip
   quota adjustment and metering. This handles idempotent deletes where the row
   is already deleted; current repositories can return nil for already-deleted
   rows.
5. If `MemorySlotsDelta < 0`, transition `adjustment_intent ->
   adjustment_pending` and call:

```json
{"meter":"memory_slots","delta":-1,"reason":"memoryDeleted"}
```

6. After console accepts or dedupes the adjustment, transition to
   `metering_pending` and record a metering event with `eventType:
   "memoryDeleted"`, `meter: "memory_slots"`, `units: -1`, and the memory ID.
7. If the delete returns an error and the service cannot prove that no active
   slot changed, mark the operation `unknown_after_crash` and emit
   `manual_reconciliation_required`; do not infer a quota adjustment.

Batch delete flow:

1. Call the batch equivalent of `BeforeMemoryDelete` to persist
   `adjustment_intent` with the requested IDs before executing
   `svc.memory.BulkDelete`.
2. Execute `svc.memory.BulkDelete`.
3. Use the returned `deleted` count from `server/internal/handler/memory.go:523`.
4. If `deleted == 0`, transition `adjustment_intent -> done` and skip quota and
   metering.
5. Otherwise transition `adjustment_intent -> adjustment_pending`, adjust
   `delta = -deleted`, and record one metering event after console ACKs the
   adjustment with the deleted IDs available from the request.
6. If batch delete returns an ambiguous error without a trustworthy delta, mark
   the operation `unknown_after_crash` and require operator reconciliation.

### Merge And Cleanup

Reconciliation currently performs update as archive-and-create and can delete
insights. These are quota-affecting but not exposed as top-level handler
results.

A1 should refactor service result types to return `UsageDelta` from the
known-unit paths that remain enabled in runtime-usage mode:

1. `MemoryService.CreatePinned`
2. `MemoryService.BulkCreate`
3. `MemoryService.Delete`
4. `MemoryService.BulkDelete`

A2 should add `UsageDelta` to the smart ingest internals before unblocking those
request shapes:

1. `MemoryService.Create`
2. `IngestService.ReconcileContent`
3. `IngestService.ReconcilePhase2`

For each enabled path, the handler sends one quota/metering operation for the
aggregate delta of the public mem9 operation.

`BulkCreate` needs special handling because it currently returns a memory slice
but no operation metadata. The refactor should return both the created memories
and `UsageDelta`, with `MemorySlotsDelta = int64(len(created))` and
`CreatedMemoryIDs` populated from the successful insert set.

## Error Mapping

Runtime usage errors should not leak internal console details.

| Console/runtime result | mem9-server response |
| --- | --- |
| Reservation `402 quota_exhausted` | `402` with stable code and upgrade action. |
| Reservation `402 spending_limit_exceeded` | `402` with stable code and upgrade action. |
| `api_key_unbound` | Preserve console's returned status and body; issue #13 examples use the quota denial family, so prefer `402` unless OpenAPI says otherwise. |
| `reservation_conflict` before execution | `502`, because generated operation IDs should not conflict. |
| Runtime API network or 5xx before execution | `503 runtime usage unavailable` in fail-closed mode. |
| Commit retryable failure after execution | Enqueue durable quota retry, then return operation success. |
| Commit non-retryable conflict after execution | Return operation success if the mem9 response is otherwise valid; log `manual_reconciliation_required` with request ID plus operation ID. |
| Async metering delivery failure | Keep the mem9 response successful only if the metering event is already durably queued; otherwise log `manual_reconciliation_required`. |
| Post-execution outbox enqueue failure | Return operation success; log `manual_reconciliation_required` with operation ID, step, tenant ID, cluster ID, and payload hash. |
| Release failure after execution failure | Enqueue release retry; otherwise rely on console reservation expiry and local watchdog metrics. |

For quota-denied `402` responses, preserve the console response body rather than
collapsing it to `{"error":"..."}`. If the body is valid JSON, pass it through
and add `mem9_code: "runtime_quota_denied"` only when that field is absent. This
keeps `code`, `limitType`, `retryable`, and `upgradeAction` available to clients.

## Metering Writer Refactoring

Refactor `server/internal/metering` instead of adding a new metering package or
interface.

Required changes:

1. Keep `metering.Writer` unchanged:

```go
type Writer interface {
    Record(evt Event)
    Close(ctx context.Context) error
}
```

2. Extend `metering.Event` with optional console fields:
   `OperationID`, `APIKeySubject`, `EventType`, `Meter`, `Units`, `OccurredAt`,
   and `MemoryIDs`.
3. Keep legacy/export writer behavior unchanged for `MNEMO_METERING_URL`
   destinations.
4. Add an outbox-aware console HTTP writer in `server/internal/metering`, but do
   not select it from `MNEMO_METERING_URL`. Runtime usage constructs this writer
   from `MNEMO_RUNTIME_USAGE_BASE_URL` and
   `MNEMO_RUNTIME_USAGE_INTERNAL_SECRET`.
5. The console HTTP writer validates required console fields before delivery.
   Invalid console events are marked terminal failed with a
   `manual_reconciliation_required` log and metric; they are not silently
   dropped.
6. Make the console HTTP writer outbox-aware by injecting the runtime usage
   outbox repository and logger when runtime usage is enabled. This keeps
   `metering.Writer` unchanged while giving the writer ownership of console
   metering ACK handling.
7. `Record(evt)` validates required console fields, upserts the
   `submit_metering_event` payload only when the existing row is absent or has
   the same canonical payload hash, queues the operation in memory, and returns
   without waiting for console.
8. The writer background worker sends:

```http
PUT {MNEMO_RUNTIME_USAGE_BASE_URL}/api/internal/metering/events/{operationId}
Authorization: Bearer <internalSecret>
X-API-Key: <apiKeySubject>
Content-Type: application/json
```

Request body:

```json
{
  "eventType": "recall",
  "meter": "recalls",
  "units": 1,
  "occurredAt": "2026-04-28T12:00:00Z",
  "agentName": "Codex",
  "memoryIds": ["mem_123", "mem_456"]
}
```

The console writer uses `Event.OperationID` in the URL. It must not generate a
new operation ID because issue #13 and issue #16 require quota and metering to
share one `operationId`.

For A1, console metering follows the existing writer's async sidecar call-site
semantics: `Record` does not wait for console to accept the event. Unlike the
legacy/export writer, console delivery must be durable and is part of runtime
usage even when `MNEMO_METERING_ENABLED=false`. Runtime usage code transitions
the outbox row to `metering_pending` only after quota commit or adjustment is
accepted or deduped by console. The console HTTP writer owns the ACK path for
`submit_metering_event`: accepted or same-payload deduped responses move
`metering_pending -> done`, different-payload `409` or invalid payloads move
`metering_pending -> terminal_failed`, and retryable failures keep the row
pending with backoff. The runtime usage worker must not call `Record` while an
operation is still `commit_pending` or `adjustment_pending`.

## Durable Retry Outbox

Issue #16 requires quota commit and metering retry until acked or durably
queued. Add a local runtime usage outbox in the control-plane DB:

```sql
CREATE TABLE IF NOT EXISTS runtime_usage_outbox (
  operation_id      VARCHAR(36) PRIMARY KEY,
  tenant_id         VARCHAR(36) NOT NULL,
  subject_version   VARCHAR(32) NOT NULL DEFAULT 'tenant_id_v1',
  step              VARCHAR(32) NOT NULL,
  phase             VARCHAR(32) NOT NULL,
  payload_json      JSON        NOT NULL,
  payload_hash      VARCHAR(64) NOT NULL,
  expires_at        TIMESTAMP   NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempt_count     INT         NOT NULL DEFAULT 0,
  next_attempt_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error        TEXT        NULL,
  created_at        TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP   DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_runtime_usage_outbox_poll (status, next_attempt_at)
);
```

Outbox steps:

1. `commit_reservation`
2. `release_reservation`
3. `apply_adjustment`
4. `submit_metering_event`

Operation phases:

1. `reserved_active`: reservation exists and mem9 work may be running.
2. `commit_pending`: mem9 work succeeded and reservation commit must be retried.
3. `release_pending`: mem9 work failed or was abandoned and reservation release
   must be retried.
4. `adjustment_intent`: adjustment-backed operation has started and has an
   `expires_at` based on `MNEMO_RUNTIME_USAGE_OPERATION_TTL`, but mem9 work has
   not been confirmed successful yet.
5. `adjustment_pending`: mem9 work succeeded and quota adjustment must be
   retried.
6. `metering_pending`: quota commit or adjustment is accepted and console
   metering must be retried.
7. `done`: all required quota and metering work is accepted or deduped.
8. `unknown_after_crash`: watchdog cannot infer whether the mem9 write succeeded;
   operators must reconcile using mem9 data and console operation state.
9. `terminal_failed`: non-retryable conflict or invalid payload requires
   operator repair.

Worker behavior:

1. Poll pending rows with exponential backoff.
2. Use the same `operationId`.
3. Treat console idempotent quota and metering success as done.
4. Treat same-payload duplicates as done.
5. Treat different-payload `409` as terminal failed and log for operator repair.
6. Limit each poll batch per tenant so one tenant with many pending rows cannot
   starve others.
7. Never log raw API key values.
8. If the outbox row includes a post-success metering event payload, call
   `metering.Writer.Record` only after the queued quota commit or adjustment is
   accepted or deduped by console.
9. For `submit_metering_event`, the console HTTP writer observes the console
   response and updates the outbox row. The generic runtime usage worker only
   requeues stale `metering_pending` rows back into `metering.Writer.Record`.

Crash and primary-writer-unavailable handling:

1. `BeforeRecall` and known-unit `BeforeMemoryCreate` insert `reserved_active`
   after console returns `reserved` and before mem9 work starts.
2. On mem9 success, the manager updates the row to `commit_pending` with the
   metering payload before attempting the synchronous commit.
3. On mem9 failure, the manager updates the row to `release_pending` before
   attempting release.
4. If the process crashes while a row is still `reserved_active`, the watchdog
   waits until `expiresAt + 2m`, marks the row `unknown_after_crash`, and emits
   `manual_reconciliation_required`. The worker must not guess commit or release
   without a persisted operation result.
5. For adjustment-backed deletes and cleanup, the manager writes
   `adjustment_intent` before execution with the target operation metadata and
   `expires_at = now() + MNEMO_RUNTIME_USAGE_OPERATION_TTL`. After success with
   `UsageDelta.MemorySlotsDelta == 0`, it moves the row directly to `done`.
   After success with a negative delta, it updates the row to
   `adjustment_pending` with the actual `UsageDelta`. If the process crashes
   before either transition, the watchdog marks the row `unknown_after_crash`
   after `expires_at` instead of applying an inferred delta.
6. If an adjustment-backed mem9 operation fails before changing data, the
   manager moves `adjustment_intent -> done` with a failure reason and does not
   call console adjustment or metering. If the failure is ambiguous and no
   trustworthy `UsageDelta` exists, the manager marks the row
   `unknown_after_crash` and emits `manual_reconciliation_required`.
7. After quota commit or adjustment is accepted, the row moves to
   `metering_pending`. Only after console metering returns accepted or deduped
   does the row move to `done`.

The worker reconstructs `X-API-Key` from `tenant_id` only for
`subject_version = "tenant_id_v1"`. A future API-key model where subject differs
from tenant ID must add an encrypted subject column and a new subject version.

## Reservation Cleanup

Reservation leak prevention uses three layers:

1. Handler-level `defer` release for normal failure paths after a reservation is
   acquired but before success finalization.
2. Local outbox rows for active reservations before executing mem9 work. Startup
   resumes pending `release_reservation`, `commit_reservation`,
   `apply_adjustment`, and `submit_metering_event` rows.
3. Console-server `expiresAt` auto-expiry as the final authority for process
   crashes before mem9-server can persist a local outbox row.

The reservation response includes `expiresAt`. mem9-server stores it in the
outbox payload and uses it as the retry deadline for release and commit work. If
console omits `expiresAt`, use `MNEMO_RUNTIME_USAGE_RESERVATION_TTL` as the local
deadline. The default is `30m`; production should set it to match console's quota
reservation TTL.

`BeforeRecall` and `BeforeMemoryCreate` must durably insert the active
reservation outbox row after console returns `reserved` and before executing the
mem9 operation. If this insert fails before execution, release the console
reservation best-effort and return `503`; this is a true fail-closed path because
the mem9 operation has not started.

The outbox worker should mark unresolved `reserved_active` work
`unknown_after_crash` after `expiresAt + 2m` and emit
`runtime_usage_reservation_unknown_total`. Retrying a commit after expiry without
a persisted success result is noise; at that point operators should reconcile
from the console quota operation state and mem9 logs.

## Finalization Ordering

Metering must never be recorded before quota is finalized.

1. Reservation-backed operations use this strict order:
   `reserve -> execute mem9 work -> persist commit_pending + metering payload ->
   commit reservation accepted/deduped -> persist metering_pending -> record
   metering`.
2. Adjustment-backed operations use this strict order:
   `persist adjustment_intent -> execute mem9 work -> persist adjustment_pending
   + metering payload -> apply adjustment accepted/deduped -> persist
   metering_pending -> record metering`.
3. If commit succeeds, durably move the row to `metering_pending`, then call
   `metering.Writer.Record` with the same `operationId`. Delivery and ACK
   observation happen asynchronously inside the console writer, but retry state
   is durable.
4. If commit response is ambiguous because of timeout or network partition,
   enqueue `commit_reservation`; the worker retries commit first, then records
   metering only after console returns committed or idempotent committed.
5. If adjustment response is ambiguous, enqueue `apply_adjustment`; the worker
   records metering only after console returns applied or idempotent applied.
6. If post-execution enqueue fails after mem9 work has already succeeded, return
   the successful mem9 response and log `manual_reconciliation_required`.

## Handler Integration

Add `runtimeUsage runtimeusage.Manager` to `handler.Server`.

Candidate call sites:

1. Recall: wrap the `filter.Query != ""` branches in `listMemories`.
2. Explicit pinned create: reserve before `svc.memory.CreatePinned`.
3. Smart content and message ingest: when runtime usage is enabled, return
   `409 runtime_usage_requires_known_memory_delta` for the blocked A1 request
   shapes listed in `Memory Create`.
4. Async content/message ingest: when runtime usage is enabled, do not accept
   unknown-delta async creates or return `202` before quota reservation and
   outbox state are durable.
5. Single delete and batch delete: persist `adjustment_intent` before delete,
   then apply quota adjustment and metering only after the returned delta proves
   active memory slots decreased.

Async create decision for A1: block content/message creates that cannot be fully
reserved before returning. Returning `202` before quota reservation is not
allowed in commercial runtime usage because a later quota denial cannot be
surfaced cleanly to the caller.

## Existing Metering Writer Compatibility

Keep `MNEMO_METERING_ENABLED` and `MNEMO_METERING_URL` as the optional
legacy/export metering surface. They are no longer the console billing metering
gate.

Compatibility rules:

1. Keep `metering.Writer` unchanged.
2. Runtime usage may reuse `metering.Writer` internally for console billing
   metering, but it is enabled by `MNEMO_RUNTIME_USAGE_ENABLED`, not by
   `MNEMO_METERING_ENABLED`.
3. Keep `s3://`, `http://`, and `https://` `MNEMO_METERING_URL` destinations as
   optional legacy/export infrastructure.
4. Do not derive the console metering endpoint from `MNEMO_METERING_URL`; derive
   it from `MNEMO_RUNTIME_USAGE_BASE_URL`.
5. Do not use `metering.Writer` for quota reservations, commits, releases, or
   adjustments; those remain synchronous runtime usage quota operations.
6. Do not add a second metering interface unless future strict durability
   requirements cannot be met behind the existing `Writer` interface.

## Local Contract Additions

These values are mem9-server local additions unless future console OpenAPI
promotes them into the internal API contract:

| Value | Kind | Scope |
| --- | --- | --- |
| `runtime_usage_requires_known_memory_delta` | HTTP response code | Returned by mem9-server with `409` when runtime usage is enabled and a create path cannot compute memory-slot delta before writes. |
| `mem9_code = "runtime_quota_denied"` | Optional response field value | Added by mem9-server to pass-through quota-denied JSON only when console did not already include `mem9_code`. |
| `manual_reconciliation_required` | Log/metric reason | Emitted when post-success quota or metering state cannot be durably persisted or replayed safely. |
| `runtime_usage_reservation_unknown_total` | Metric | Counts reservations whose success/failure cannot be inferred after `expiresAt + 2m`. |
| `runtime_usage_metering_delivery_failed_total` | Metric | Counts console metering events that reach terminal failed state after retry or invalid payload. |

## Rollout Plan

1. A1a: Add config, no-op runtime usage manager, quota HTTP client, and
   `AuthInfo.APIKeySubject` without changing public API behavior.
2. A1a: Add durable runtime usage outbox schema, repository, watchdog, and
   worker in no-op mode.
3. A1b: Extend `metering.Event` and add an outbox-aware console writer that is
   constructed from runtime usage config and calls
   `PUT /api/internal/metering/events/{operationId}`.
4. A1b: Add recall reservation, release, commit, durable metering handoff, and
   post-execution manual reconciliation logging.
5. A1c: Refactor known-unit memory CRUD services to return `UsageDelta`.
6. A1c: Add explicit create reservation, delete adjustment, and batch-delete
   adjustment.
7. A1c: Block smart ingest in runtime-usage mode with
   `409 runtime_usage_requires_known_memory_delta`.
8. A2: Refactor smart ingest internals to return net `UsageDelta`, then unblock
   runtime-usage smart ingest with correct quota and metering semantics.
9. Enable in staging with fail-closed disabled only for pre-execution burn-in.
10. Switch production commercial SaaS to fail-closed for pre-execution quota
    failures.

## Test Plan

1. Config validation tests for enabled/disabled runtime usage.
2. Config tests cover console metering being enabled by
   `MNEMO_RUNTIME_USAGE_ENABLED` without requiring `MNEMO_METERING_ENABLED`.
3. Config tests cover `MNEMO_METERING_URL` not overriding the console metering
   endpoint derived from `MNEMO_RUNTIME_USAGE_BASE_URL`.
4. Quota HTTP client tests for auth headers, `X-API-Key`, request bodies, idempotent
   retries, and error parsing.
5. Metering HTTP writer tests cover console URL shape, bearer auth,
   `X-API-Key`, body fields, and use of caller-provided `operationId`.
6. Metering HTTP writer tests cover invalid console events being marked terminal
   failed with `manual_reconciliation_required`.
7. Existing legacy/export metering writer tests remain unchanged.
8. Handler tests cover recall reservation before search.
9. Handler tests cover `402` quota denial without executing search.
10. Handler tests cover recall commit before metering handoff.
11. Handler tests cover reservation release after search failure.
12. Handler tests cover zero-result recall still committing quota and recording
    metering.
13. Handler tests cover explicit create reserving `memory_slots`.
14. Handler tests cover reservation release after create failure.
15. Handler tests cover delete adjustment after success.
16. Handler tests cover batch delete skipping adjustment for `deleted == 0`.
17. Handler tests cover runtime usage forcing or rejecting async smart ingest.
18. Outbox tests cover active reservation row creation before mem9 work starts.
19. Outbox tests cover retryable commit failure enqueueing work.
20. Outbox tests cover pre-execution outbox failure returning `503`.
21. Outbox tests cover post-execution outbox failure returning operation success
    and logging `manual_reconciliation_required`.
22. Outbox tests cover same-payload duplicates being marked done.
23. Outbox tests cover different-payload conflict as terminal failed.
24. Outbox tests cover `reserved_active` expiry at `expiresAt + 2m` becoming
    `unknown_after_crash`.
25. Outbox tests cover `adjustment_intent -> done` for zero-delta delete.
26. Outbox tests cover `adjustment_intent -> unknown_after_crash` after
    `MNEMO_RUNTIME_USAGE_OPERATION_TTL`.
27. Outbox tests cover `metering_pending -> done` after console accepted or
    same-payload deduped response.
28. Outbox tests cover no metering call while an operation remains
    `commit_pending` or `adjustment_pending`.
29. Restart tests cover crash after reserve before mem9 work result is
    persisted.
30. Restart tests cover crash after mem9 write before commit transition.
31. Restart tests cover crash after delete before adjustment transition.
32. Restart tests cover crash after quota commit before metering is accepted.

Run:

```bash
make test
make vet
```

## Effort Estimate

950-1350 LoC production code:

1. A1a runtime usage quota types, HTTP client, config, startup wiring, and
   subject identity: ~280 LoC
2. A1a durable runtime usage outbox schema, repository, watchdog, and generic
   worker: ~350 LoC
3. A1b metering event fields and outbox-aware console HTTP writer refactor:
   ~190 LoC
4. A1b recall handler integration, reservation finalization, and manual
   reconciliation logging: ~230 LoC
5. A1c known-unit `UsageDelta` plumbing through memory services: ~180 LoC
6. A1c explicit create reservation, delete adjustment, and batch-delete
   adjustment handler integration: ~180 LoC
7. Error mapping, passthrough 402 responses, and logging helpers: ~100 LoC
8. Smart-ingest blocking path: ~60 LoC

A2 smart-ingest `UsageDelta` support is excluded from A1 and should be estimated
separately after the reconcile result contract is designed.

## Open Questions

1. Should console-server expose a reservation lookup or reconciliation endpoint
   for operator repair, or is `operationId` plus console DB access enough for A1?
2. What metric names should production dashboards use for
   `manual_reconciliation_required`, `runtime_usage_reservation_unknown_total`,
   and terminal metering failures?
3. Should `operation_id` remain `VARCHAR(36)` because issue #13 requires UUIDv7,
   or use `VARCHAR(255)` defensively for future non-UUID operation IDs?

## Acceptance Criteria

1. Runtime usage integration is disabled by default.
2. Enabled mode requires base URL and internal bearer secret.
3. Recall calls console quota reservation before executing search.
4. Recall commits quota and records metering with the same `operationId`.
5. Zero-result query recalls are explicitly billed.
6. Memory create reserves `memory_slots` before known-unit writes.
7. Smart ingest is blocked in runtime-usage mode with
   `409 runtime_usage_requires_known_memory_delta`.
8. Memory delete and batch delete apply `memory_slots` adjustments only when
   `UsageDelta.MemorySlotsDelta < 0`.
9. Memory delete and batch delete persist `adjustment_intent` before executing
   mem9 deletes and close zero-delta intents as `done`.
10. Metering events are durably queued and handed to `metering.Writer` only after
    quota commit or adjustment is accepted or idempotently deduped.
11. Quota retries reuse the same UUIDv7 `operationId`.
12. Active reservation outbox rows are created before mem9 work starts.
13. Retryable post-success quota finalization and metering delivery failures are
    durably queued before returning success when possible.
14. Post-success quota or metering enqueue failures return operation success and emit
    manual reconciliation logs and metrics.
15. Raw API keys are not logged or stored raw in the outbox.
16. mem9-server does not embed org, plan, bucket, Stripe, S3, or rollup logic.
17. Existing legacy/export metering remains available through
    `MNEMO_METERING_ENABLED` and `MNEMO_METERING_URL`.
18. Console metering sends API requests to `MNEMO_RUNTIME_USAGE_BASE_URL` using
    the caller-provided `OperationID`, not a writer-generated event ID.
19. Console billing metering does not require `MNEMO_METERING_ENABLED` and is
    not routed by `MNEMO_METERING_URL`.
20. The console HTTP writer owns `metering_pending -> done|terminal_failed`
    transitions after observing console responses.
21. `reserved_active`, `adjustment_intent`, and `metering_pending` states have
    restart/watchdog behavior for process crash and network partition cases.
