---
title: "Entity Store Implementation Plan"
status: implemented-with-known-limits
created: 2026-05-10
last_updated: 2026-05-10
---

> **STATUS: IMPLEMENTED WITH KNOWN LIMITS**
>
> This plan narrows the gap between mem9's previous `memory_entities` link index
> and mem0-style Entity Store behavior. The implementation now includes entity
> embeddings, canonical entity records, alias links, relationship edges,
> backfill hooks, vector indexes, cleanup, and local reranking.

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

## 3. Implemented

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

The schema also includes:

- `canonical_memory_entities`: one row per canonical entity key per agent
- `memory_entity_aliases`: alias key to canonical entity key mapping
- `memory_relationships`: relationship edges between canonical entities, linked
  to the memory that produced the signal

### Write Path

When memory entity links are replaced:

1. extract entities from content
2. add fact-profile metadata entities
3. expand aliases
4. dedupe
5. embed entity text when client-side embedding is configured
6. persist entity rows with embeddings and `canonical_entity_key`
7. upsert canonical entity rows and alias mappings
8. persist relationship edges for relationship facts with two or more entities

When auto-embedding is configured, repositories omit the `embedding` column and
the database generated column computes it from `entity_text`.

### Retrieval Path

Entity recall now combines:

- exact `entity_key` match boosts
- alias/canonical entity key matching
- entity-vector boosts from `memory_entities.embedding`

The vector boost is best-effort. If entity query embedding or vector search
fails, recall falls back to the exact entity boost instead of failing the full
request.

The mem0-style ranking path uses the combined entity signal alongside semantic
and keyword scoring.

### Maintenance

The repository layer exposes maintenance hooks for:

- listing entity mention rows that need embeddings
- updating entity and canonical entity embeddings
- ensuring backend-specific entity vector indexes
- cleaning dangling entity/alias/relationship rows
- rebuilding canonical entity counts from existing memory links

### Local Reranking

Recall candidates pass through a deterministic local rerank step after fact
profile scoring. The rerank keeps RRF as the base score and adds small,
explainable boosts for entity matches, vector similarity, and keyword hits.

## 4. Remaining Limits

The large architecture gaps are now implemented at a pragmatic level, but these
quality limits remain:

- Canonicalization is deterministic and alias-based, not a full entity
  resolution model. Ambiguous people or projects can still split into multiple
  canonical keys.
- Relationship edges are derived from relationship facts and entity pairs; there
  is no relation-label extraction beyond the current coarse `related` type.
- Backfill hooks exist in service/repository code, but there is not yet a
  scheduled worker or admin endpoint that repeatedly drains all historical rows.
- Vector indexes are ensured best-effort; production rollout should still check
  query plans and write cost per backend.
- Reranking is local and deterministic. There is no external cross-encoder or
  LLM reranker stage.
- Evaluation still needs a fresh LoCoMo/mem0-style benchmark run with this
  implementation enabled.

## 5. Rollout Plan

1. Let request-time schema ensure add the entity columns and support tables for
   active tenants.
2. New writes populate entity embeddings, canonical rows, aliases, and
   relationship edges automatically.
3. Run `BackfillEntityEmbeddings` in batches for client-embedding tenants with
   historical rows.
4. Let the async index ensure create entity vector indexes where supported.
5. Run fresh LoCoMo/mem0-style benchmark with new ingest.
6. Use benchmark misses to decide whether to add stronger entity resolution or a
   learned reranker.

## 6. Risk Controls

- Entity vector scoring is additive and best-effort.
- Existing exact entity boost remains unchanged.
- Existing memory vector and keyword search paths remain primary retrieval
  inputs.
- Generated columns are used only in auto-embedding modes, matching the memory
  table embedding pattern.
- Client-side entity embeddings are skipped when no embedder is configured.
- Cleanup and backfill are exposed as maintenance operations rather than hidden
  destructive behavior in normal recall.
