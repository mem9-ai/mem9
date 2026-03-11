---
title: CRDT Vector Clock Logic
updated: 2026-03-02
watches:
  - server/internal/service/vclock.go
  - server/internal/repository/tidb/memory.go
  - server/internal/service/memory.go
---

## Summary

mnemos uses a custom vector clock CRDT (~70 LoC) for multi-agent conflict resolution. No external library — just three functions in `service/vclock.go`.

## Core Data Structure

Vector clock: `map[string]uint64` — keys are agent names, values are logical write counters. Stored as JSON column on each memory row.

```
{"agent-a": 3, "agent-b": 1}
```

## Three Operations

**Compare** (`service/vclock.go:CompareClocks`) — causal relationship between two clocks:
- Dominates: `forall k: a[k] >= b[k] AND exists k: a[k] > b[k]`
- Dominated: reverse
- Concurrent: neither dominates
- Equal: all entries identical

**Merge** (`service/vclock.go:MergeVectorClocks`) — element-wise max:
- `forall k: merged[k] = max(a[k], b[k])`

**TieBreak** (`service/vclock.go:TieBreak`) — deterministic winner for concurrent writes:
- Compare `origin_agent` lexicographically, lower wins
- If equal, compare `id` lexicographically, lower wins
- No physical time involved

## Write Flow (4 Paths)

| Incoming vs existing | Action | HTTP |
|---|---|---|
| No existing row | INSERT with incoming clock | 201 |
| Incoming dominates | UPDATE content + merge clocks | 201 |
| Existing dominates | No-op, return existing | 200 + `X-Mnemo-Dominated: true` |
| Concurrent | TieBreak winner's content wins, clocks merge | 201 or 200 |

No clock field at all -> LWW fast path (unconditional overwrite, backward-compatible).

## Delete Flow

Soft delete: `tombstone=1`, increment deleting agent's clock. Tombstoned rows participate in clock comparison — revival only if incoming clock dominates tombstone's clock.

## Idempotency

Optional `write_id` (UUID). Server stores `last_write_id` + response snapshot on the row. Retry with same `write_id` returns cached result.

## Retry

`SELECT ... FOR UPDATE` in transaction. Deadlock (MySQL 1213/1205) -> retry 3x with 50ms/100ms backoff. Exhaustion -> HTTP 503.

## Code Locations

- Clock compare/merge/tiebreak: `server/internal/service/vclock.go`
- CRDT upsert (transactional): `server/internal/repository/tidb/memory.go:CRDTUpsert`
- Service branching (LWW vs CRDT): `server/internal/service/memory.go:Create`
- Handler (clock validation, response headers): `server/internal/handler/memory.go:createMemory`
- Soft delete with clock increment: `server/internal/repository/tidb/memory.go:SoftDelete`

## Why No Library

The vector clock model is simple: `map[string]uint64` comparisons + element-wise max. Libraries like `go-crdt` target complex types (G-Counters, OR-Sets). We only need server-authoritative LWW-Register with concurrency detection — three small functions.
