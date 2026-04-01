---
title: "Recall Improvements: #3 Near-dup Detection, #7 Session Recall Filter, #9 Query-intent Policy"
issue: 149
status: draft-v5
updated: 2026-04-01
---

## Scope

| # | Name | Priority |
|---|------|----------|
| 3 | Semantic near-dup detection (Layer 2 only) | Critical |
| 7 | Session recall filter | High |
| 9 | Query-intent extraction policy | Critical |

Rollout order: #9 -> #7 -> #3.

---

## #9 — Query-intent extraction policy

### Problem

The LLM extraction prompt has no rule distinguishing query intent ("user asked how
to configure X") from stated fact ("user uses X as their default tool"). Both produce
`ADD` facts. This is the root cause of the "鲁迅案例" and "蛋糕案例" patterns: a
one-off lookup becomes a stored preference.

### Root cause

Three callers of extraction functions in `ingest.go`, none with a query-intent rule:

| Function | Called by | Leads to reconcile? |
|---|---|---|
| `extractFacts` (line 419) | `extractAndReconcile` | Yes — directly |
| `extractFacts` (line 232) | `ReconcileContent` | Yes — after gathering facts |
| `extractFactsAndTags` (line 165) | `ExtractPhase1` / `Ingest` direct path | Yes — downstream |

Both extraction functions have independent system prompts with identical rules text.
The fix must update both prompts. The `dropQueryIntentFacts` post-parse step is shared
logic called inside each extraction function after `normalizeParsedFacts`.

### Fix

**Step 1 — Add rule 6 to both `extractFacts` and `extractFactsAndTags` system
prompts** (identical text):

```
6. Do NOT extract search queries or lookup questions as facts.
   If the user is asking the assistant to find, explain, or look something up
   ("who is X", "how do I Y", "what does Z mean"), classify it as query_intent.
   Only store what the user STATED about themselves, their work, or their world.
   Heuristic: if the fact can only be known because the user asked, it is query_intent.
   If it reveals something stable about the user independently, it is a fact.
   Examples to skip (query_intent):
     - "User asked about the history of the Ming dynasty"
     - "User searched for how to configure nginx"
   Examples to keep (fact):
     - "Uses nginx as the production reverse proxy"
     - "Working on a project that requires SQL window functions"
```

**Step 2 — Extend `ExtractedFact`** with optional `FactType`:

```go
type ExtractedFact struct {
    Text     string   `json:"text"`
    Tags     []string `json:"tags,omitempty"`
    FactType string   `json:"fact_type,omitempty"` // "fact" | "query_intent"; omitted = "fact"
}
```

Update the output format block in both prompts to include `fact_type` in the JSON
example.

**Step 3 — Add `dropQueryIntentFacts`** — called after `normalizeParsedFacts` in
both `extractFacts` and `extractFactsAndTags`:

```go
func dropQueryIntentFacts(facts []ExtractedFact) []ExtractedFact {
    out := facts[:0]
    for _, f := range facts {
        if strings.EqualFold(f.FactType, "query_intent") {
            slog.Info("dropping query_intent fact", "len", len(f.Text))
            continue
        }
        out = append(out, f)
    }
    return out
}
```

Log at `Info` level, length only — no raw text to avoid user-query exposure in
production logs. Omitted `fact_type` defaults to keep — safe on LLM non-compliance.

### Scope

Universal: applies to all three extraction paths. Query-intent suppression is a data
quality invariant, not path-specific. Facts are hard-dropped before `reconcile()` —
no LLM override, as there is no scenario where a query-intent fact should be stored.

### Estimated change

~45 LoC: prompt rule text (15 lines × 2 prompts), struct field (2 lines),
`dropQueryIntentFacts` (12 lines), 2 call sites (2 lines), unit test (~15 lines).

---

## #3 — Semantic near-dup detection (shadow mode)

### Problem

`reconcile()` relies entirely on LLM NOOP judgment. Near-duplicates with different
surface wording ("Uses Go for backend" vs "Writes backend services in Go") both
survive as distinct rows, polluting the recall pool with paraphrased redundancy.

### Root cause

`gatherExistingMemories` truncates content to 150 chars and caps at 60 memories.
The reconciliation LLM may not even see the semantic duplicate.

### Approach: shadow mode first

Before enabling suppression, we need to understand the score distribution of
near-dup candidates in the real corpus. The initial implementation runs
`NearDupSearch` on every extracted fact, records the cosine similarity as a
Prometheus metric, but never suppresses — facts always pass through to `reconcile()`
unchanged. Suppression is a follow-up task once the threshold is validated.

### `NearDupSearch` — new method on `MemoryRepo` interface

Near-dup SQL belongs in the repository layer. Add to `server/internal/repository/repository.go`:

```go
// NearDupSearch finds the nearest active memory to queryText across the tenant.
// Returns ("", 0, nil) when no vector index is available.
// Postgres returns ("", 0, nil) — it does not support auto-embedding.
// DB9 implements real auto-vector search when autoModel is configured; returns
// ("", 0, nil) otherwise.
NearDupSearch(ctx context.Context, queryText string) (id string, score float64, err error)
```

**TiDB implementation** (auto-embedding path, prod config):

```go
func (r *MemoryRepo) NearDupSearch(ctx context.Context, queryText string) (string, float64, error) {
    if r.autoModel == "" {
        return "", 0, nil
    }
    var id string
    var dist float64
    err := r.db.QueryRowContext(ctx,
        `SELECT id, VEC_EMBED_COSINE_DISTANCE(embedding, ?) AS dist
         FROM memories
         WHERE state = 'active'
           AND memory_type IN ('insight', 'pinned')
           AND embedding IS NOT NULL
         ORDER BY dist ASC
         LIMIT 1`,
        queryText,
    ).Scan(&id, &dist)
    if err == sql.ErrNoRows {
        return "", 0, nil
    }
    if err != nil {
        return "", 0, fmt.Errorf("near dup search: %w", err)
    }
    return id, 1 - dist, nil // cosine similarity = 1 - distance
}
```

Scope is **tenant-wide** — no `agent_id` filter. The tenant memory pool is shared;
identical facts from different agents are redundant regardless of origin.

**DB9 implementation** — DB9 has real `AutoVectorSearch` capability when `autoModel`
is configured. `NearDupSearch` follows the same pattern:

```go
func (r *DB9MemoryRepo) NearDupSearch(ctx context.Context, queryText string) (string, float64, error) {
    if r.autoModel == "" {
        return "", 0, nil
    }
    // Same SQL as TiDB using VEC_EMBED_COSINE_DISTANCE
    ...
}
```

**Postgres no-op stub** — Postgres `AutoVectorSearch` returns an error by design
("not supported; use VectorSearch with pre-computed embeddings"). `NearDupSearch`
degrades gracefully:

```go
func (r *MemoryRepo) NearDupSearch(_ context.Context, _ string) (string, float64, error) {
    return "", 0, nil // auto-embedding not supported on Postgres
}
```

### Prometheus metric

Add to `server/internal/metrics/metrics.go`:

```go
// NearDupCosineScore observes the cosine similarity of the nearest existing memory
// to each extracted fact. Used to calibrate the near-dup suppression threshold.
// Shadow mode only — facts always pass through to reconcile unchanged.
NearDupCosineScore = promauto.NewHistogram(
    prometheus.HistogramOpts{
        Namespace: "mnemo",
        Name:      "near_dup_cosine_score",
        Help:      "Cosine similarity of nearest memory to each extracted fact (shadow mode).",
        Buckets:   []float64{0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.92, 0.95, 0.97, 0.99},
    },
)
```

### Service layer usage — hook inside `reconcile()`

All three ingest paths converge at `reconcile()`:
- `ingestMessages` → `ExtractPhase1` → `ReconcilePhase2` → `reconcile()` (main handler path)
- `Ingest` → `extractAndReconcile` → `reconcile()`
- `ReconcileContent` → `extractFacts` → `reconcile()`

The hook belongs inside `reconcile()` itself, before the facts are sent to the LLM.
This covers all three paths with a single change:

```go
func (s *IngestService) reconcile(ctx context.Context, agentName, agentID, sessionID string, facts []ExtractedFact) ([]string, int, error) {
    // Shadow mode: measure near-dup cosine scores for threshold calibration.
    // Suppression is intentionally disabled until the score distribution is
    // analyzed against the prod corpus. Once a threshold is validated, add:
    //   if score >= threshold { /* annotate fact or drop */ }
    for i := range facts {
        id, score, err := s.memories.NearDupSearch(ctx, facts[i].Text)
        if err == nil && id != "" {
            metrics.NearDupCosineScore.Observe(score)
        }
    }
    // ... existing reconcile logic
```

### What is NOT in scope

- Exact content-hash dedup (Layer 1) — dropped; marginal recall quality benefit.
- Near-dup suppression — deferred until threshold validated from prod metrics.
- Retroactive dedup of existing rows — separate task.

### Estimated change

~65 LoC:
- `NearDupSearch` on `MemoryRepo` interface + TiDB impl + DB9 impl + Postgres stub: ~45 lines.
- `NearDupCosineScore` Prometheus histogram: ~10 lines.
- Shadow call inside `reconcile()`: ~10 lines.

---

## #7 — Session recall filter

### Problem

The `/memories` search handler appends session search results to memory results by
default when `memory_type` is not specified (handler `memory.go:232`). Session
memories are verbatim conversation excerpts — they match broadly on vocabulary
overlap and add noise without distilled signal.

### Root cause

Handler logic (`memory.go:232`):

```go
if filter.Query != "" && (onlySession || filter.MemoryType == "") {
    sessionMems, _ := svc.session.Search(r.Context(), filter)
    memories = append(memories, sessionMems...)  // unconditional append
}
```

`memory_type == ""` (the default for all plugin injection calls) triggers session
search and appends up to 10 session rows to every recall response, without score
merging against the memory results.

### Fix: skip session query entirely for default recall

`SessionService.Search` in prod (`autoModel != ""`) calls `AutoVectorSearch` →
`VEC_EMBED_COSINE_DISTANCE(embedding, ?)`, which triggers TiDB Serverless's
`EMBED_TEXT` API on every recall request. Running this query just to discard the
results would consume embedding API quota for zero user benefit.

The correct fix is to skip the session table query entirely when results won't
be returned.

**Handler change** (`server/internal/handler/memory.go`):

```go
// Before: session search runs whenever memory_type is empty
if filter.Query != "" && (onlySession || filter.MemoryType == "") {
    sessionMems, sessErr := svc.session.Search(r.Context(), filter)
    if sessErr != nil {
        slog.Warn("session search failed", "cluster_id", auth.ClusterID, "err", sessErr)
    } else {
        memories = append(memories, sessionMems...)
        total += len(sessionMems)
    }
}

// After: session search only runs when explicitly requested
if filter.Query != "" && onlySession {
    sessionMems, sessErr := svc.session.Search(r.Context(), filter)
    if sessErr != nil {
        slog.Warn("session search failed", "cluster_id", auth.ClusterID, "err", sessErr)
    } else {
        memories = append(memories, sessionMems...)
        total += len(sessionMems)
    }
}
```

- `memory_type=""` (default recall) → session query **skipped entirely**; no
  embedding API call consumed.
- `memory_type="session"` → session query runs and results returned normally.
- `memory_type="insight,pinned"` → session query skipped (not `onlySession`).

### Plugin-side additions (`memory_type` filter support)

The server-side change makes plugin injection filter redundant for session exclusion.
`memory_type` is still useful for the `memory_search` tool so agents can explicitly
filter by type. This requires additions at three levels in each plugin:

**1. `SearchInput` type** — `openclaw-plugin/types.ts` and `opencode-plugin/src/types.ts`:
```typescript
memory_type?: string;
```

**2. Backend query builder** — `openclaw-plugin/server-backend.ts` and
`opencode-plugin/src/server-backend.ts`, inside `search()` after existing
`params.set` calls:
```typescript
if (input.memory_type) params.set("memory_type", input.memory_type);
```

**3. Tool schema** — `openclaw-plugin/index.ts` `memory_search` parameters and
`opencode-plugin/src/tools.ts` `memory_search` args, add alongside `offset`:

`openclaw-plugin/index.ts`:
```typescript
memory_type: {
    type: "string",
    description: "Comma-separated memory types to filter by (e.g. insight,pinned)",
},
```

`opencode-plugin/src/tools.ts`:
```typescript
memory_type: tool.schema
    .string()
    .optional()
    .describe("Comma-separated memory types to filter by (e.g. insight,pinned)"),
```

And wire it through in opencode's `execute`:
```typescript
const input: SearchInput = {
    q: args.q,
    tags: args.tags,
    source: args.source,
    limit: args.limit,
    offset: args.offset,
    memory_type: args.memory_type,  // NEW
};
```

`listRecent` in opencode-plugin stays unchanged — no prompt text available in
`system.transform` (`input` only has `{ sessionID?, model }`), so recency-ordered
retrieval is the correct approach.

### Why skip entirely instead of shadow mode

The session search in prod uses `VEC_EMBED_COSINE_DISTANCE` which calls TiDB
Serverless's `EMBED_TEXT` API — subject to rate limits. Running the query on every
recall request just to record a metric would consume embedding quota for zero recall
benefit. Hard removal is correct here.

### Estimated change

~25 LoC (server) + ~20 LoC (plugins):
- Handler condition change: `(onlySession || filter.MemoryType == "")` → `onlySession` (~3 lines).
- 2 × `SearchInput.memory_type` field: ~4 lines.
- 2 × backend query builder forwarding: ~2 lines.
- 2 × tool schema additions + opencode execute wiring: ~10 lines.

---

## Cross-cutting decisions

| Decision | Choice | Rationale |
|---|---|---|
| #9 scope | Universal — both `extractFacts` and `extractFactsAndTags` | Quality invariant, not path-specific |
| #9 action on query_intent | Hard drop before `reconcile()` | No scenario where query-intent should be stored |
| #9 log level | `Info`, length only | Prod-visible count signal; no raw text avoids user-query exposure. Tradeoff: one `Info` log per dropped fact — acceptable given low drop rate expected |
| #3 Layer 1 | Dropped | Marginal recall benefit; LLM NOOP handles common case |
| #3 Layer 2 hook placement | Inside `reconcile()` | Single convergence point for all 3 ingest paths |
| #3 Layer 2 scope | Tenant-wide (no `agent_id` filter) | Shared pool; cross-agent identical facts are redundant |
| #3 Layer 2 mode | Shadow only — metric, no suppression | Threshold must be validated from prod data first |
| #3 TiDB `NearDupSearch` | Real implementation via `VEC_EMBED_COSINE_DISTANCE` | Prod backend; auto-embedding always available |
| #3 DB9 `NearDupSearch` | Real implementation when `autoModel` configured; no-op otherwise | DB9 has `AutoVectorSearch` — same SQL pattern as TiDB |
| #3 Postgres `NearDupSearch` | No-op stub returning `("", 0, nil)` | Postgres does not support auto-embedding |
| #7 session exclusion | Skip session query entirely for default recall | Embedding API rate limit; no benefit running query whose results are discarded |
| #7 opencode retrieval | Keep `listRecent` semantics | `system.transform` has no prompt text in API |
| #7 `memory_type` in plugins | Add to `SearchInput` + backend + **tool schemas** (both plugins) | Agents can explicitly filter by type via `memory_search` tool |

## Open questions

1. **#3 — threshold calibration**: Run shadow mode for at least 2 weeks on prod
   corpus. Analyze `near_dup_cosine_score` histogram. Look for a natural gap
   between "clearly different" and "clearly duplicate" fact pairs before hardening.

2. **#9 — model compliance**: `gemini-2.5-flash-lite` may omit `fact_type`.
   Monitor drop count via `dropping query_intent fact` log in dev for the first
   week to measure classification accuracy before relying on the filter in prod.
