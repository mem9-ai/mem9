---
title: "Proposal: Combine memory_session_links with Conditional Neighbor Expansion"
status: draft
created: 2026-04-09
last_updated: 2026-04-10
depends_on:
  - "PR #123 memory_session_links infrastructure"
  - "recall-conditional-neighbor-expansion-proposal.md"
---

# Proposal: Combine `memory_session_links` with Conditional Neighbor Expansion

## Summary

Combine two recall ideas into a two-layer search strategy:

- use `memory_session_links` for **coarse provenance routing** from top insight
  hits to a small set of candidate sessions,
- use conditional neighbor expansion on the `sessions` table for **local
  contextual completion** around strong session seed hits.

These two techniques do not conflict. They solve different subproblems:

- links answer: "which sessions are most likely relevant to this memory?"
- neighbor expansion answers: "once a promising session turn is found, which
  nearby turns should also be retrieved?"

This proposal explains how to combine them into one general recall path.

---

## Problem

The current system has two disconnected representations:

- **insight memories** in `memories`:
  - semantically compact,
  - good for vector/keyword recall,
  - but may omit the local conversational evidence needed for temporal or
    multi-hop answers.
- **session rows** in `sessions`:
  - contain raw local conversational context,
  - but are expensive to search broadly and easy to over-expand.

If neighbor expansion is applied globally across all sessions, it can add noise.
If only insight memories are searched, local evidence is often missing.

The missing bridge is:

> once an insight is retrieved, how do we identify the most promising sessions
> before doing local expansion?

`memory_session_links` provides that bridge at session granularity.

---

## Core Idea

Use a layered recall pipeline:

1. run normal primary search over `memories`,
2. select top insight hits,
3. use `SessionsByMemory(memory_id)` from `memory_session_links` to collect
   candidate session IDs,
4. run focused session search only within those linked sessions,
5. if the query profile and first-pass seed quality justify it, expand around
   top session seeds using `session_id + seq`,
6. merge and rerank the combined result set.

This yields:

- insight recall for semantic precision,
- provenance-guided session routing for scope reduction,
- neighbor expansion for local evidence completion.

---

## Why These Approaches Are Complementary

### `memory_session_links`

Strength:

- narrows recall from "all sessions" to "sessions plausibly related to the
  retrieved memory".

Limitation:

- direct-row, session-level only,
- no exact message provenance,
- no `seq`,
- no local context by itself.

### Neighbor Expansion

Strength:

- recovers nearby evidence once a promising session turn is known.

Limitation:

- needs a good session seed,
- too expensive/noisy if applied broadly.

### Combined

The link table supplies the session scope.
The session search supplies the seed hit.
Neighbor expansion supplies the missing local context.

This is exactly the right decomposition.

---

## Current Limitation of PR #123 Semantics

PR #123 uses direct-row provenance:

- a link `(memory_id, session_id)` means that session directly wrote that memory
  row,
- updates create a new memory row linked only to the updating session,
- earlier contributing sessions remain attached to archived ancestor rows.

This matters because the combined recall path will often start from an **active**
insight hit. For an actively updated memory, `SessionsByMemory(activeID)` may
only return the latest contributing session, not older sessions that still carry
important historical evidence.

Therefore the combined design has two possible versions.

---

## Option A — Direct-Row Routing Only

### Flow

1. Retrieve top active insight hits.
2. For each hit, call `SessionsByMemory(memory_id)`.
3. Union the returned session IDs.
4. Run focused session search within those sessions.
5. Apply conditional neighbor expansion to top session seeds.

### Pros

- minimal incremental work after PR #123,
- simplest path to production,
- useful for memories whose key evidence lives in the latest-writing session.

### Cons

- misses older shaping sessions for updated active memories,
- weaker for long-lived facts updated across many sessions,
- recall quality depends on how often the latest-writing session is the same
  session containing the needed evidence.

### Recommendation

Good as an initial version if the goal is to validate the combined architecture
quickly.

---

## Option B — Lineage-Aware Session Routing

### Flow

1. Retrieve top active insight hits.
2. For each hit, resolve archived ancestors by following reverse
   `superseded_by` edges from the active row, bounded by
   `maxAncestorDepth = 5` and `maxAncestorRows = 12`.
3. Call `SessionsByMemory(...)` for the active row plus ancestor rows.
4. Union all linked session IDs.
5. Run focused session search within those sessions.
6. Apply conditional neighbor expansion to top session seeds.

### Pros

- matches the intuitive query: "which sessions ever shaped this currently active
  memory?"
- much better fit for updated memories,
- more faithful to long-lived evolving facts.

### Cons

- requires new lineage lookup support,
- larger implementation surface,
- more expensive query path.

### Recommendation

This is the better medium-term design, but it should not block getting a direct
v1 working.

---

## Recommended Rollout: A then B

The safest plan is:

- **v1**: direct-row routing only,
- **v2**: lineage-aware routing for active memories that were updated.

Reason:

- PR #123 already gives the necessary primitive for v1,
- v1 validates the search architecture with minimal schema churn,
- v2 can be justified with measured recall gaps.

---

## Scope and Filter Semantics

This combined path is for the default mixed-recall search only.

- apply it only when `memory_type == ""` and `query != ""`,
- keep `memory_type=session` on the existing `SessionService.Search` path
  unchanged,
- keep explicit non-empty memory-only modes such as `memory_type=insight`
  outside this combined path unless a later proposal says otherwise.

This preserves the current asymmetry in handler behavior:

- primary memory recall keeps the existing `MemoryService.Search` semantics,
  which clear `session_id` and `source` to avoid over-narrowing insight recall,
- session-derived recall keeps the existing session-search semantics, which
  preserve caller filters meaningful to the `sessions` table.

Therefore the focused routed-session stage must treat routed session IDs as an
additional narrowing constraint, not as a filter bypass.

The effective session-search contract is:

- start from the routed session ID set produced by `SessionsByMemory(...)`,
- if the caller supplied `session_id`, intersect the routed set with that
  single requested session,
- continue to apply caller-provided `source`, `agent_id`, `tags`, `state`, and
  `min_score` in the focused session search exactly as the current
  `SessionService.Search` path does,
- if the effective routed set becomes empty after intersection, skip routed
  session search and fall back to the existing generic session-grounding
  behavior.

---

## Query-Time Architecture

### Stage 1 — Primary Memory Search

Run the current hybrid search over `memories` as usual.

Input:

- query text,
- existing memory-search filters.

Preserve the current mixed-recall behavior here:

- `agent_id`, `tags`, `state`, and other normal memory filters continue to
  apply,
- `session_id` and `source` remain cleared at the primary-memory stage, exactly
  as `MemoryService.Search` does today.

Output:

- top primary `Memory` hits.

### Stage 2 — Provenance Routing

From the top relevant `insight` hits:

- select top `M` insights for routing,
- resolve linked session IDs with `SessionsByMemory(memory_id)`,
- union and deduplicate the session set,
- if the request already contains `session_id`, intersect the routed set with
  that explicit session before Stage 3.

Recommended initial settings:

- `maxRoutingInsights = 3`
- `maxSessionsPerInsight = 3`
- `maxRoutedSessions = 6`

If no linked sessions are found:

- fall back to existing generic session-grounding behavior,
- do not fail the request.

### Stage 3 — Focused Session Search

Run a session search restricted to the routed session set.

The contract should be fixed now:

- keep `domain.MemoryFilter` unchanged,
- add a dedicated session-layer capability that applies existing session-search
  semantics plus an explicit routed session set.

Example shape:

```go
SearchInSessionSet(ctx context.Context, f domain.MemoryFilter, sessionIDs []string) ([]domain.Memory, error)
```

This search stage should return the same projected `domain.Memory` session rows
as the current session search path.

### Stage 4 — Conditional Neighbor Expansion

Apply the conditional expansion rules from the neighbor-expansion proposal, but
only over the focused session result set.

That means:

- classify the query,
- choose top session seeds,
- expand `±1` around those seeds via `(session_id, seq)`.

This is strictly better than global expansion because the search domain is now
much smaller and more relevant.

### Stage 5 — Merge and Rerank

Merge:

- primary insight results,
- focused session hits,
- expanded neighbors.

Final response budget remains exactly the caller's `limit`.

Use the current supplemental session policy as the v1 budget model:

- `sessionBudget = supplementalSessionLimit(limit)`,
- `primaryBudget = limit - sessionBudget`,
- focused session seeds and expanded neighbors must share the same
  `sessionBudget`,
- seeds rank ahead of neighbors inside that budget,
- neighbors only fill slots left after higher-ranked seeds,
- if the session-derived side under-fills its budget, unused slots go back to
  primary memory hits.

Then rerank with:

- direct-match hits above contextual support rows,
- seed session hits above expanded neighbors,
- existing score preserved where available,
- positional decay for neighbors.

---

## Repository and Service Additions

### Needed from PR #123

- `MemorySessionLinkRepo`
- `SessionsByMemory(memoryID, limit)`

### Additional New Capability

To support this combined design, add:

#### 1. Session-scoped routed search

Example shape:

```go
SearchInSessionSet(ctx context.Context, f domain.MemoryFilter, sessionIDs []string) ([]domain.Memory, error)
```

Reason:

- focused search over a routed session subset is the core value-add from the
  link table,
- keeping `MemoryFilter` unchanged preserves the current public filter contract
  while still allowing multi-session routing internally.

#### 2. Neighbor lookup

Example shape:

```go
ListNeighbors(ctx context.Context, sessionID string, seq int, before int, after int) ([]domain.Memory, error)
```

Reason:

- this is the actual expansion primitive.

#### 3. Optional lineage helper

Only needed for v2:

```go
AncestorMemoryIDs(ctx context.Context, memoryID string, depth int, maxRows int) ([]string, error)
```

Reason:

- lets active-memory routing recover older linked sessions while keeping reverse
  `superseded_by` traversal bounded.

---

## Triggering Rules

The combined path should remain conditional.

Neighbor expansion should not run for every query just because session links
exist. The recommended trigger remains:

```text
query profile indicates temporal or relational need
AND
focused session search has at least one strong seed
```

The presence of session links alone is not enough. Links are routing hints, not
proof that local expansion is beneficial.

---

## Failure and Fallback Semantics

This path must degrade safely.

Backend contract:

- TiDB implements the full routed-session and neighbor path,
- non-TiDB backends must preserve today's safe degradation behavior,
- if routed-session or neighbor capabilities are unimplemented outside TiDB,
  treat that as "skip this layer and keep primary recall", not as a user-visible
  hard failure.

### If link lookup fails

- log and fall back to existing session-grounding behavior.

### If link lookup returns empty

- keep normal primary search results,
- optionally fall back to generic session search if current policy allows it.

### If focused session search fails

- keep primary memory results,
- skip expansion.

This includes the case where the backend reports routed-session search as not
supported.

### If neighbor expansion fails

- keep focused session seeds only,
- do not fail the whole request.

This includes the case where the backend reports neighbor lookup as not
supported.

This matches the best-effort spirit of the current search path.

---

## Evaluation Plan

Measure each layer independently.

### Stage A — Links Only

Compare:

- primary search only
- primary search + provenance-routed session search

Goal:

- validate that links improve session scope targeting before expansion is added.

### Stage B — Add Expansion

Compare:

- routed session search without expansion
- routed session search with conditional `±1` expansion

Goal:

- validate that expansion adds useful local context rather than just more text.

### Metrics

- QA accuracy on temporal and multi-hop sets
- latency impact
- average number of routed sessions
- average number of expanded neighbors
- fallback rate when links are absent

---

## Risks

### Risk: routing bias

If the link table is too narrow, routed session search may miss relevant sessions
that were never linked to the current active memory row.

Mitigation:

- start with direct-row routing plus fallback,
- add lineage-aware routing later if needed.

### Risk: complexity layering

Links, focused session search, and expansion add multiple moving parts.

Mitigation:

- ship in layers,
- measure each layer independently,
- keep all fallbacks non-fatal.

### Risk: overfitting to benchmark patterns

The design could drift toward benchmark-specific behavior.

Mitigation:

- keep abstractions general:
  - provenance routing
  - focused session search
  - conditional local expansion

These map naturally to real agent-memory workloads.

---

## Recommendation

Use PR #123 as the coarse recall-routing layer, not as a replacement for neighbor
expansion.

Recommended sequence:

1. land and harden `memory_session_links`,
2. add focused session search using `SessionsByMemory(memory_id)` as routing
   input,
3. apply conditional neighbor expansion only inside the routed session subset,
4. later add lineage-aware routing if direct-row links are too narrow.

This gives a clean two-layer recall architecture:

- **provenance-guided routing** to find the right sessions,
- **neighbor expansion** to recover the right local evidence.
