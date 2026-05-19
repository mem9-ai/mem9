---
title: mem9-server Runtime Usage Client Proposal
status: draft
created: 2026-05-13
last_updated: 2026-05-19
---

## Summary

Add a billing-grade runtime usage client to mem9-server so commercial SaaS mode
can enforce runtime usage service quotas and submit reliable metering events.
The current implementation follows the inline runtime usage service contract
snapshot below so public readers can audit the endpoint, meter, event, retry,
and conflict semantics from this repository.

Runtime usage is request-count based:

1. Recall operations reserve and meter `memory_recall_requests` with `units: 1`.
2. Memory write operations reserve and meter `memory_write_requests` with
   `units: 1`.
3. Affected object count is diagnostic metadata, not quota units.
4. The caller's `X-API-Key` remains the runtime usage quota subject.

## Runtime Usage Service Contract

mem9-server uses these runtime usage service internal endpoints:

1. `PUT /api/internal/quota/reservations/{operationId}`
2. `PATCH /api/internal/quota/reservations/{operationId}`
3. `PUT /api/internal/metering/events/{operationId}`

There is no quota adjustment endpoint in the current contract. Deletes and
batch deletes are treated as normal write requests and emit `memoryDeleted`
metering events after successful deletion.

Reservation requests use one of two meters:

```json
{"meter":"memory_recall_requests","units":1}
```

```json
{"meter":"memory_write_requests","units":1}
```

Reservation finalization uses only runtime usage service supported reasons:

1. Commit success: `operationSucceeded`
2. Release failure: `operationFailed`
3. Release abandoned work: `operationAbandoned`
4. Release caller cancellation: `clientCancelled`
5. Release timeout: `timeout`

## Metering Events

Recall events use:

```json
{
  "eventType": "memoryRecall",
  "meter": "memory_recall_requests",
  "units": 1,
  "occurredAt": "2026-05-11T12:00:00Z"
}
```

Write events use:

```json
{
  "eventType": "memoryCreated",
  "meter": "memory_write_requests",
  "units": 1,
  "occurredAt": "2026-05-11T12:01:00Z",
  "metadata": {
    "objectsAffected": 3
  }
}
```

Supported write event types are `memoryCreated`, `memoryUpdated`,
`memoryDeleted`, `memoryMerged`, and `memoryCleanup`. This PR emits
`memoryCreated` for create, bulk-create, content ingest, and message ingest
paths, `memoryUpdated` for update paths, and `memoryDeleted` for delete and
batch-delete paths.

`occurredAt` is truncated to whole-second RFC3339 before payload construction
because it is part of the canonical metering payload. Optional `agentName` is
omitted unless it matches runtime usage service validation:
`^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$`.

Metering metadata is intentionally narrow. It should contain only stable,
non-sensitive diagnostic fields such as `objectsAffected`. It must not contain
prompts, memory content, raw API keys, bearer tokens, cookies, DSNs, or auth
material. `memoryIds` are capped at 200 IDs to stay inside runtime usage
service validation.

## Request Flow

For recall:

1. Reserve one `memory_recall_requests` unit before running search.
2. On recall success, persist `commit_pending` if an outbox is configured.
3. Commit the reservation.
4. Submit a `memoryRecall` metering event.
5. On recall failure, release the reservation with a mapped runtime usage
   service reason.

For memory writes:

1. Reserve one `memory_write_requests` unit before executing the write.
2. Execute the mem9 write path.
3. On success, persist `commit_pending` if an outbox is configured.
4. Commit the reservation.
5. Submit a write metering event with safe metadata.
6. On failure before the write succeeds, release the reservation.

The SQL outbox is intentionally not used for pre-success reservation state in
the normal path. It is limited to post-success commit and metering retry state,
because the runtime usage service owns reliable metering ingress behind
`PUT /api/internal/metering/events/{operationId}`.

## Covered Operations

Runtime usage currently covers:

1. Recall queries.
2. Explicit pinned create.
3. Smart content create.
4. Message ingest.
5. Bulk create.
6. Update.
7. Delete.
8. Batch delete.
9. Chain update, delete, and batch-delete against the resolved node subject.

Async create and ingest paths reserve before returning `202 Accepted`; the
background worker commits or releases the reservation after the operation
finishes.

## Failure Semantics

Quota denial returns `402`. Transient runtime usage service failures return
`503` unless fail-open mode is configured for reservation failures.

After a mem9 operation succeeds, mem9-server must not release the reservation.
It either commits synchronously, durably queues commit/metering retry, or marks
the operation for manual reconciliation. If no durable retry path exists and the
commit cannot be acknowledged, the handler fails closed for synchronous paths.

Metering retries are idempotent by `operationId` and canonical payload hash.
`200` with `deduped: true` is success. `409 operation_conflict` is terminal and
requires reconciliation.
