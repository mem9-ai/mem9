---
title: "Entity Store Implementation Plan"
status: partially-implemented
created: 2026-05-10
last_updated: 2026-05-10
---

> **STATUS: PARTIALLY IMPLEMENTED**
>
> This plan narrows the gap between mem9's existing `memory_entities` link index
> and mem0-style Entity Store behavior. The first implementation pass keeps the
> current table shape and adds entity embeddings plus entity-vector recall,
> without introducing a separate canonical entity graph.

# Entity Store Implementation Plan

## 1. Background

mem9 previously had a lightweight entity-memory link index:

- `memory_entities(agent_id, entity_key, entity_text, entity_type, memory_id, created_at)`
- rule-based entity extraction from memory content and fact metadata
- exact `entity_key` lookup used as a recall boost

mem0-style Entity Store adds a stronger retrieval signal by storing entities
with embeddings and linked memory IDs, then using entity search as one branch of
memory retrieval.

## 2. Goal

Close the highest-impact gap while preserving mem9's current architecture:

- keep `handler -> service -> repository`
- keep plugins calling only the HTTP API
- keep existing `memory_entities` rows as per-memory entity links
- add entity embeddings and vector lookup as an additive retrieval signal
- avoid a large canonical graph migration in the first pass

## 3. Implemented First Pass

### Schema

`memory_entities` now includes an `embedding` column:

- TiDB client-embedding mode: `VECTOR(<clientDims>) NULL`
- TiDB auto-embedding mode: generated `EMBED_TEXT(..., entity_text, ...)`
- PostgreSQL client-embedding mode: `vector(<clientDims>) NULL`
- db9 auto-embedding mode: generated `EMBED_TEXT(..., entity_text, ...)`

Schema builders and runtime ensure paths create or backfill the column for:

- tenant provisioning
- additive schema ensure
- upload worker schema ensure
- zero provisioner setup
- static schema files

### Write Path

When memory entity links are replaced:

1. extract entities from content
2. add fact-profile metadata entities
3. expand aliases
4. dedupe
5. embed entity text when client-side embedding is configured
6. persist entity rows with embeddings

When auto-embedding is configured, repositories omit the `embedding` column and
the database generated column computes it from `entity_text`.

### Retrieval Path

Entity recall now combines:

- exact `entity_key` match boosts
- entity-vector boosts from `memory_entities.embedding`

The vector boost is best-effort. If entity query embedding or vector search
fails, recall falls back to the exact entity boost instead of failing the full
request.

The mem0-style ranking path uses the combined entity signal alongside semantic
and keyword scoring.

## 4. Remaining Gaps

This first pass is intentionally not a full canonical entity graph. Remaining
work:

- Canonical entity records: one row per resolved entity, separate from per-memory
  mentions.
- Alias resolution: merge names like `Jon`, `Jonathan`, and related surface
  forms without relying only on simple alias expansion.
- Entity-level linked memory aggregation: expose linked memory IDs from canonical
  entities rather than deriving links only through per-memory rows.
- Backfill job: populate embeddings for existing `memory_entities` rows at
  scale, with progress and retry behavior.
- Entity vector indexes: add backend-specific vector indexes after validating
  production query plans and write cost.
- Evaluation: run LoCoMo/mem0-style benchmark before and after enabling entity
  vector scoring in production.

## 5. Rollout Plan

1. Land additive schema and repository support.
2. Let request-time schema ensure add `memory_entities.embedding` for active
   tenants.
3. New writes populate entity embeddings automatically.
4. Run benchmark with fresh ingest to measure the new entity-vector branch.
5. Add a backfill worker for old rows if benchmark results justify enabling the
   branch for historical tenants.
6. Decide whether canonical entity records are needed based on observed entity
   noise and alias misses.

## 6. Risk Controls

- Entity vector scoring is additive and best-effort.
- Existing exact entity boost remains unchanged.
- Existing memory vector and keyword search paths remain primary retrieval
  inputs.
- Generated columns are used only in auto-embedding modes, matching the memory
  table embedding pattern.
- Client-side entity embeddings are skipped when no embedder is configured.

