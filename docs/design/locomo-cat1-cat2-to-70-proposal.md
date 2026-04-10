---
title: "Proposal: LoCoMo Cat1/Cat2 Push Toward 70% LLM"
status: draft
created: 2026-04-10
last_updated: 2026-04-10
depends_on:
  - "recall-session-links-plus-neighbor-expansion-proposal.md"
  - "locomo-cat1-cat2-recall-investigation.md"
---

# Proposal: LoCoMo Cat1/Cat2 Push Toward 70% LLM

## Summary

The current server-side recall changes improved LoCoMo Cat1 slightly but regressed
Cat2:

- Cat1 LLM rose from `43.62%` to `46.10%`
- Cat2 LLM fell from `66.36%` to `63.55%`

The immediate goal is to recover Cat2 and create a credible path for both Cat1
and Cat2 to approach `70%` LLM.

This proposal recommends a two-track plan:

- **track A: explicit-session retrieval optimization** for Cat2 and part of Cat1,
- **track B: content-mode smart-ingest fact quality improvements** for Cat1.

The key conclusion is:

> Cat2 is currently harmed mostly by the retrieval path.
> Cat1 is currently limited mostly by the information shape produced by the
> benchmark-facing content-mode smart-ingest path.

That means retrieval-only tuning is necessary but not sufficient for the full
`70%` target.

---

## Problem

The recent provenance-routed recall experiments exposed a poor fit between the
server's mixed-recall assumptions and the LoCoMo benchmark workload.

### Workload facts

From the benchmark harness:

- the harness supports both `raw` and `messages` ingest modes,
- the benchmark-facing retrieval-oriented ingest surface is the per-turn
  `createMemory(...)` path,
- in that path, every turn is written with `session_id = sample_id`,
- retrieval also always queries with that explicit `session_id`.

For avoidance of doubt, the content-mode benchmark ingest surface is:

1. benchmark harness calls `createMemory(...)` per turn,
2. server enters `MemoryService.CreateWithSession(...)`,
3. with LLM enabled, that path calls `ReconcileContent(...)`,
4. `ReconcileContent(...)` ultimately uses `extractFacts(...)`.

That is the exact path Track C must target if the proposal is meant to improve
benchmark scores.

Historical note:

- some recent manual benchmark runs used `--ingest-mode messages`,
- those runs were useful to diagnose session-link and neighbor-expansion
  behavior,
- but Track C in this proposal is intentionally scoped to the content-mode
  `createMemory` benchmark surface above so implementation lands on the code
  path that directly affects the benchmark harness's retrieval-focused mode.

This creates two issues:

1. `memory_session_links` routing has almost no narrowing power because the
   request is already pinned to one session.
2. neighbor expansion by `(session_id, seq)` is unstable because `seq` restarts
   within each ingest batch while `session_id` stays constant for the whole
   sample.

The observed server logs match this failure mode:

- routed search often shows `sessions:1`,
- first-pass routed seed count is tiny (`results:3`),
- neighbor expansion explodes to large counts such as `74`, `108`, `152`,
  `184`, which is impossible for a true local `±1` expansion.

This is retrieval noise, and Cat2 single-hop exact-answer questions are the most
fragile to that noise.

Current-baseline note:

- the server now already skips routed neighbor expansion when `session_id` is
  explicit,
- therefore the large historical expansion counts should be read as the reason
  that safeguard was necessary,
- not as a claim about the current post-fix baseline.

### Why Cat1 and Cat2 behave differently

#### Cat2

Cat2 is mostly:

- exact entity lookup,
- exact time lookup,
- short factual answer extraction.

It benefits from:

- the best direct raw turn being ranked highly,
- a larger direct evidence pool,
- less contextual noise.

It does **not** usually need broad neighbor expansion.

#### Cat1

Cat1 is mostly:

- multi-fact aggregation,
- cross-turn composition,
- sometimes temporal + relational composition.

It benefits from:

- retrieving the right direct turns,
- but also from the memory corpus containing sufficiently specific event facts.

The current benchmark-facing smart ingest often stores abstract summaries such as:

- "promotes LGBTQ rights"
- "has been busy painting"

when the question needs:

- a specific event,
- a date anchor,
- a participant relation,
- or a concrete decision/outcome.

That is why Cat1 cannot be solved by retrieval tuning alone.

---

## Goals

- Recover Cat2 to at least its pre-regression level quickly.
- Improve Cat2 beyond the current `66.36%` baseline.
- Improve Cat1 with changes that attack the real bottleneck instead of adding
  more retrieval noise.
- Make benchmark runs diagnostically cleaner by separating ingest variance from
  retrieval variance.

## Non-Goals

- Productizing LoCoMo-only fields such as `dia_id` as first-class server
  concepts.
- Optimizing for Cat3/Cat4/Cat5 in this proposal.
- Solving all remaining benchmark gaps with one retrieval tweak.

---

## Root Cause Summary

### Root cause A — explicit-session queries are still insight-first

In mixed recall, `MemoryService.Search` clears `session_id` and `source` before
primary memory search. The explicit-session filter is preserved only for the
session-side supplemental search.

For LoCoMo benchmark queries, this means:

- the primary result set is still global within the tenant,
- the session-side evidence is budget-limited,
- Cat2 exact answers can be crowded out by abstract insight rows.

### Root cause B — session evidence budget is too small

The current `supplementalSessionLimit(limit)` budget is appropriate for generic
mixed recall, but too small for benchmark-style explicit-session QA.

For `limit=20`, the session side gets only `3` slots.

That is often not enough for:

- the best direct turn,
- one alternate direct turn,
- one date-bearing turn,
- and one context-bearing turn.

### Root cause C — historical neighbor expansion exposed invalid locality assumptions

When `session_id` is explicit and reused across many ingest batches, local
adjacency by `(session_id, seq)` is not trustworthy.

The current handler already skips neighbor expansion for explicit `session_id`
queries. That safeguard removes the immediate regression source, but it does
not solve the broader ranking problem:

- explicit-session queries are still insight-first,
- direct session evidence is still budget-limited,
- and session-specific reranking is still too weak.

### Root cause D — Cat1 is limited by extraction quality on the content-mode path

The benchmark-facing `createMemory(...) -> CreateWithSession(...) ->
ReconcileContent(...) -> extractFacts(...)` path still over-compresses many
answerable events into vague insight facts.

That hurts Cat1 because multi-hop questions depend on:

- specific event statements,
- explicit entities,
- explicit time anchors,
- and preserved causal/relational details.

---

## Proposal

## Track A — Explicit-Session Retrieval Mode

### Core Idea

When a query carries an explicit `session_id`, do not treat session evidence as
secondary context. Treat it as the primary evidence source.

### Behavior

For `query != ""`, `session_id != ""`, and `memory_type == ""`, add a new
explicit-session branch in `listMemories()` with this exact control flow:

1. bypass provenance routing entirely,
2. bypass the current generic mixed-recall supplemental session path,
3. run `SessionService.Search(...)` first with the caller's explicit
   `session_id`, `agent_id`, `source`, `tags`, `state`, and `min_score`
   preserved,
4. rerank those direct session hits with the session-specific reranker from
   Track B,
5. run `MemoryService.Search(...)` second for insight support using the current
   memory-search semantics,
6. merge with a new explicit-session helper that places session hits first and
   insight hits second under separate budgets,
7. do **not** apply the existing `rerankGroundedMemories(query, merged)` to the
   merged explicit-session result,
8. if a final answer-shape pass is still desired later, it must be an
   explicit-session variant that preserves cross-type ordering and only reranks
   within the session-primary pool and within the insight-support pool
   separately,
9. do not call neighbor expansion in this branch.

This is intentionally a benchmark-friendly but still generally defensible mode:

- the caller explicitly asked for one session,
- that is a strong signal that local raw turns matter most,
- insight rows should support, not dominate.

### Recommended initial policy

- `sessionPrimaryLimit = min(limit, 8)`
- `insightSupplementLimit = limit - sessionPrimaryLimit`
- if fewer than `sessionPrimaryLimit` direct rows exist, give unused slots back
  to insight rows

Merge policy:

- take up to `sessionPrimaryLimit` reranked direct session hits first,
- then append up to `insightSupplementLimit` insight hits,
- if the session side under-fills, backfill from remaining insight hits,
- if the insight side under-fills, backfill from remaining session hits.

Example for `limit=20`:

- session-first budget = `8`
- insight supplement budget = `12`

This is a large change from the current `3`-row session supplement cap, but it
matches the benchmark workload much better.

### Why this should help Cat2

Cat2 exact-answer questions frequently need:

- one exact turn,
- one competing exact turn,
- one date/time turn,
- and maybe one paraphrased turn.

The current budget is too narrow.

### Why this should also help Cat1

It will not solve Cat1 alone, but it should improve the cases where the needed
multi-hop evidence already exists in raw turns but is currently being crowded
out by generic insight rows.

---

## Track B — Temporal and Entity-Aware Session Reranking

### Core Idea

Once explicit-session retrieval becomes session-first, rerank those direct
session rows more aggressively for QA-style exact answers.

### Scope

This reranker applies only inside Track A:

- input: direct session hits returned by `SessionService.Search(...)` in the new
  explicit-session branch,
- position: after session search, before the explicit-session merge helper,
- output: reordered session hits with the same result budget.

### Exact triggers and adjustments

Use additive score adjustments over the incoming score/order:

#### 1. Temporal boost for `when` queries

Trigger:

- query starts with `when `,
- or query contains `what date`, `which year`, `how long ago`.

Adjustments:

- `+0.35` if the row contains an absolute date or year,
- `+0.20` if the row contains a relative time marker such as `last week`,
  `yesterday`, `next month`,
- `-0.15` if the row lacks any visible time-bearing signal.

#### 2. Entity consistency boost

Trigger:

- always on for explicit-session reranking.

Adjustments:

- `+0.25` if the row contains the primary named entity from the question,
- `+0.15` if the row contains the question's main event term after lightweight
  stopword stripping.

#### 3. Generic-fact penalty

Trigger:

- query is temporal or event-style,
- and the row looks like a generic biography/preference fact rather than an
  event statement.

Adjustment:

- `-0.20` for generic trait/preference/biography rows with no event marker and
  no time signal.

### Ordering rule

Sort by adjusted score descending, then preserve original rank as the tiebreaker.

### Why this is different from current reranking

The current reranker is lightweight and blended across memory types.
This proposal adds a stronger session-specific rerank stage for explicit-session
queries before the final merge.

---

## Track C — Content-Mode Smart-Ingest Fact Specificity Improvements

### Core Idea

Improve the benchmark-facing content-mode smart-ingest path so it stores more
answerable event facts instead of flattening them into vague summaries.

Exact target surface:

- `MemoryService.CreateWithSession(...)`
- `IngestService.ReconcileContent(...)`
- `IngestService.extractFacts(...)`

This is the path used when the harness writes one turn at a time through
`createMemory(...)`.

### Target extraction improvements

The smart extractor should preserve:

- explicit event + time together,
- explicit person + action together,
- explicit cause/effect together,
- explicit relation tuples,
- explicit decisions/plans with time anchors.

Examples:

- prefer "Caroline attended an LGBTQ support group on May 7, 2023"
  over "Caroline promotes LGBTQ rights"
- prefer "Melanie signed up for a pottery class on July 2, 2023"
  over "Melanie creates pottery projects"

### Why this matters for Cat1

Cat1 is bottlenecked by missing specificity, not just retrieval ranking.
If the memory graph is too abstract, no reranker can recover the missing fact.

### Candidate implementation directions

#### Option C1 — prompt tightening only

Strengthen the `extractFacts(...)` prompt to prefer:

- dated events,
- explicit participants,
- concrete actions,
- specific outcomes.

#### Option C2 — hybrid memory write

Keep today’s insight extraction, but also preserve a limited number of
structured event memories from the session pipeline.

This is heavier than prompt tuning, but may be necessary if prompt-only changes
still collapse events too aggressively.

### Recommendation

Start with prompt tightening first.
Only move to hybrid writes if the corpus still remains too abstract after prompt
improvement.

---

## Track D — Benchmark Methodology Cleanup

### Problem

The current benchmark comparisons can mix:

- retrieval changes,
- content-mode ingest changes,
- and occasional `messages`-mode exploratory runs.

That means:

- ingestion LLM variance changes the stored corpus from run to run,
- retrieval changes and ingestion changes are confounded.

### Fix

Use a two-pass benchmark method:

#### Pass 1 — retrieval-only comparison

- ingest once,
- rerun with `--skip-ingest`,
- compare retrieval changes on the same tenant snapshot.

#### Pass 2 — end-to-end comparison

- rerun with ingest enabled,
- measure the combined benefit of ingest + retrieval changes.

### Recommendation

Use retrieval-only comparison as the primary gate for Track A/B.
Use end-to-end comparison on the content-mode path as the primary gate for
Track C.

---

## Recommended Rollout

### Phase 1 — Recover Cat2 quickly

Ship:

- explicit-session session-first retrieval mode,
- larger direct-session budget,
- explicit-session branch bypassing provenance routing and generic mixed-recall
  supplemental search,
- no neighbor expansion when `session_id` is explicit,
- stronger session reranking for temporal/entity queries.

Expected outcome:

- recover Cat2 above the current `63.55%`,
- plausibly exceed the prior `66.36%` baseline.

### Phase 2 — Improve Cat1 foundation

Ship:

- extraction prompt changes for event/time specificity,
- retrieval-only reruns on fixed ingested tenants,
- then full end-to-end reruns.

Expected outcome:

- Cat1 should move materially only after the stored memory corpus becomes more
  specific.

### Phase 3 — Reassess 70% target

After Phases 1 and 2:

- if Cat2 is still under `70%`, revisit answer-generation prompt/model and
  session-first budget sizing,
- if Cat1 is still far under `70%`, evaluate hybrid event-memory writes rather
  than more ranking heuristics.

---

## Metrics

Track separately:

- Cat1 LLM
- Cat2 LLM
- Cat1 token-F1
- Cat2 token-F1
- median retrieval latency
- number of direct session rows returned
- number of insight rows returned
- number of neighbor rows returned

For benchmark diagnostics, also record:

- percentage of explicit-session queries that use session-first mode,
- top-k memory type composition,
- question-type slices such as `when`, `who`, `what`, `where`.

---

## Risks

### Risk: overfitting to benchmark explicit-session behavior

Session-first ranking is appropriate for LoCoMo and some product queries, but
may be too aggressive for general mixed recall.

Mitigation:

- scope it only to explicit `session_id` queries,
- keep the default mixed path unchanged.

### Risk: larger raw-turn budget increases noise

More session rows can also add clutter.

Mitigation:

- pair the larger budget with stronger temporal/entity reranking,
- use fixed-tenant retrieval-only reruns to validate.

### Risk: prompt tightening changes product ingestion behavior

Cat1 improvements likely require extraction changes that affect all smart-ingest
traffic.

Mitigation:

- start with prompt tightening, not schema changes,
- validate benchmark gains before considering heavier write-path changes.

---

## Recommendation

Do not keep iterating on provenance routing and neighbor expansion alone for
LoCoMo Cat1/Cat2.

Recommended immediate sequence:

1. implement explicit-session session-first retrieval mode,
2. increase direct session evidence budget for explicit-session queries,
3. strengthen temporal/entity reranking,
4. benchmark again with `--skip-ingest`,
5. then improve smart-ingest fact specificity for Cat1.

This is the shortest path that aligns with the actual failure modes:

- **Cat2** needs cleaner direct evidence ranking,
- **Cat1** needs a more answerable memory corpus.
