---
title: "Proposal: LoCoMo Strategy Executor Improvements for Cat1 and Cat3"
status: draft
created: 2026-04-11
last_updated: 2026-04-11
depends_on:
  - "locomo-query-strategy-router-proposal.md"
  - "recall-session-links-plus-neighbor-expansion-proposal.md"
  - "issue-149-recall-improvements-proposal.md"
---

# Proposal: LoCoMo Strategy Executor Improvements for Cat1 and Cat3

## Summary

The current branch repaired the biggest retrieval-accounting issue and improved
strategy detection, but Cat1 and Cat3 are still bottlenecked by the
**executor and answer-construction path**, not only by routing.

Latest post-fix benchmark run:

- Overall F1: `41.66%`
- Overall LLM: `71.67%`
- Overall evidence recall: `50.68%`
- Cat1 F1: `27.11%`, LLM: `61.35%`, Evidence Recall: `31.7%`
- Cat2 F1: `61.35%`, LLM: `85.36%`, Evidence Recall: `72.9%`
- Cat3 F1: `18.56%`, LLM: `56.25%`, Evidence Recall: `31.3%`

Observed pattern:

- retrieval availability is no longer the main problem; evidence recall has improved
  dramatically, but F1 barely moved,
- Cat2 is now healthy enough that broad widening should be treated as risky,
- Cat1 is now primarily a coverage-selection and count-synthesis problem,
- Cat3 is now primarily an inference-path and answer-format problem.

This proposal focuses on **executor-side recall improvements**:

1. establish the corrected post-fix baseline,
2. add an `attribute_inference` path for Cat3,
3. improve count/set synthesis,
4. reduce exact-vs-LLM gaps with answer normalization,
5. only then revisit targeted coverage selection and query augmentation,
6. keep router retuning as a late phase.

Implementation companion:

- `docs/design/locomo-strategy-executor-implementation-checklist.md`

The revised core decision is:

> now that evidence recall is largely repaired, prioritize **inference,
> count synthesis, and answer normalization** ahead of broad recall widening.

---

## Baseline Analysis

### 1. The benchmark mostly exercises the explicit-session mixed path

`listMemories` treats `q != "" && session_id != "" && memory_type == ""` as
`explicitSessionMixed` in `server/internal/handler/memory.go:288`, and falls into
the explicit-session/default mixed flow when the router does not produce a non-default
decision.

For routed strategies:

- `executeSetAggregation` calls `explicitSessionSearch` in
  `server/internal/handler/strategy_executor.go:231-249`
- `executeCountQuery` calls `explicitSessionSearch` in
  `server/internal/handler/strategy_executor.go:252-270`
- `executeExactEventTemporal` also routes to `explicitSessionSearch` in
  `server/internal/handler/strategy_executor.go:220-229`

This means LoCoMo Cat1/Cat3 performance is dominated by the quality of:

- `explicitSessionSearch` in `server/internal/handler/memory.go:395-440`
- session grounding in `server/internal/handler/memory.go:521-565`
- session reranking in `server/internal/handler/memory.go:924-980`

### 2. The post-fix benchmark shows retrieval is no longer the first-order bottleneck

Evidence recall moved from `4.37%` to `50.68%` overall, with large gains in every
category, but F1 remained almost flat. That means the next phases should optimize:

- which retrieved rows survive into the final context,
- how count/inference paths synthesize across those rows,
- how answers are normalized for benchmark scoring.

The new benchmark also shows that Cat2 is already strong enough that broad recall
widening should be treated as a possible regression risk.

### 3. Broad budget widening is no longer the first lever

Current executor/session limits:

- `explicitSessionPrimaryCap = 8` in `server/internal/handler/memory.go:42`
- `supplementalSessionLimit(10) = 2` in `server/internal/handler/memory.go:854-864`
- session search fetches `limit * 3` in `server/internal/service/session.go:18-20`

Those limits are still tight, but the new benchmark says broad widening should be
deprioritized until inference/count/normalization work lands. Targeted widening may
still help later for:

- Cat1 list/set questions that need evidence from many distant sessions
- Cat3 inference questions that need multiple weak signals rather than one exact row

### 4. Cat1 needs coverage selection and count synthesis, not only more recall

Current Cat1 executors only rerank an already narrow candidate pool:

- `rerankForSetAggregation` in `server/internal/handler/strategy_executor.go:273-330`
- `rerankForCountQuery` in `server/internal/handler/strategy_executor.go:332-388`

These functions improve ordering, but they do not ensure:

- session diversity,
- distinct event/item coverage,
- reduced duplicate local evidence,
- broader temporal spread.

The benchmark now supports a more specific conclusion:

- Cat1 ER improved from `4.2%` to `31.7%`
- Cat1 LLM stayed flat at `61.35%`
- Cat1 F1 slightly regressed

So “retrieve more” is not enough. Cat1 now needs:

- coverage-aware selection,
- count aggregation,
- answer normalization.

### 5. Cat3 has no dedicated inference strategy

The router only recognizes:

- `exact_event_temporal`
- `set_aggregation`
- `count_query`
- `default_mixed`

This is defined in `server/internal/domain/strategy.go:4-8` and repeated in the
LLM strategy prompt in `server/internal/service/strategy_router.go:313-328`.

There is no `attribute_inference` executor or strategy class yet, even though the
router proposal already identified it as the right class for many Cat3 questions.

### 6. `default_mixed` cannot currently exploit entity hints from the router

`listMemories` only diverts into executor-specific strategy handling when
`!decision.IsDefault()` in `server/internal/handler/memory.go:294-319`.

So a router output like:

```json
{"strategies":[{"name":"default_mixed","confidence":0.85}],"entity":"john"}
```

does not activate any special executor behavior. The request falls through to the
existing default path, and the entity hint is effectively ignored.

### 7. Query-shape reranking conflates retrieval and reranker inputs

`MemoryFilter` currently has only one `Query` field in
`server/internal/domain/types.go:66-77`.

That same field is used for:

- vector / FTS retrieval,
- event-fact weighting,
- explicit-session reranking,
- query-shape classification.

This blocks safe entity augmentation because prefix-sensitive rerankers like
`classifyGroundingAnswerShape` in `server/internal/handler/memory.go:1129-1145`
would change behavior if the retrieval query were modified to
`"john what might john's degree be in"`.

### 8. Router resolution is still aggressive for weak prototype matches

Step 1 resolution is accepted if prototype aggregation survives the thresholds in
`server/internal/service/strategy_router.go:252-305`.

In practice, recent logs show many prototype single-strategy decisions at
`0.05-0.07`, which is a weak signal for Cat3-style inference queries. Executor
work should be prioritized before tightening or relaxing those thresholds.

### 9. Measurement prerequisite: raw-session seq preservation

LoCoMo ingest sends explicit `seq` values from the benchmark side. The executor and
evaluation path depend on those values being preserved in session rows. The current
branch already includes a fix that preserves `IngestMessage.Seq` in:

- `server/internal/service/ingest.go`
- `server/internal/service/session.go`

This proposal treats that fix as a prerequisite and assumes the next benchmark run
uses it.

---

## Assessment of the Existing Idea Note

The note in `claude-notes/strategy-executor-improvement-ideas.md` is useful, but
its priorities need adjustment for the real LoCoMo path.

### Idea 1 — Entity query augmentation

**Verdict: valid**

Why:

- entity augmentation should improve both Cat1 and Cat3 retrieval precision,
- but it should apply to the **explicit-session/session path**, not only to a
  narrow non-session executor case.

Required shape:

- add `RawQuery` / `RerankerQuery`,
- use augmented query for retrieval,
- keep original query for shape-sensitive rerankers.

### Idea 2 — Budget expansion for set/count non-session path

**Verdict: partially valid, low benchmark priority**

Why:

- good idea in general,
- low value for LoCoMo because benchmark requests already include `session_id`,
  so explicit-session path dominates.

Recommended change:

- move the widening to the explicit-session path instead of prioritizing
  non-session widening first.

### Idea 3 — Strategy reranking on non-session path

**Verdict: partially valid, low benchmark priority**

Why:

- harmless improvement,
- but it does not attack the main LoCoMo bottleneck.

Recommended change:

- fold this into a later cleanup pass,
- do not make it an early benchmark-focused change.

### Idea 4 — Entity-based context expansion for `default_mixed`

**Verdict: valid, but incomplete**

Why:

- Cat3 does need entity-grounded supplemental evidence,
- but `default_mixed` currently has no path to consume router-provided entity hints.

Required shape:

- first make `default_mixed` executor-aware when the router returns hints,
- then add entity supplement search,
- preferably FTS/keyword-first for exact entity names.

### Missing from the note

The note omits several executor-critical items:

1. an `attribute_inference` strategy class and executor,
2. explicit-session budget widening,
3. coverage-aware final selection for Cat1,
4. count semantics beyond numeric-row reranking,
5. the `default_mixed` plumbing change needed to use entity hints,
6. post-retrieval answer normalization.

---

## Goals

- Improve Cat1 and Cat3 without regressing Cat2 materially.
- Keep the external `/memories` API unchanged.
- Prefer incremental changes that can be benchmarked phase-by-phase.
- Reuse the current two-layer design: router chooses a strategy, executor decides
  how to spend retrieval budget.
- Keep changes server-side.

## Non-Goals

- Replacing the answer model.
- Replacing the router with a large opaque classifier.
- Adding schema changes unless a later phase proves them necessary.
- Reworking benchmark ingestion itself beyond the already-fixed seq preservation.

---

## Acceptance Criteria

These targets are intentionally practical rather than aspirational.

### Benchmark targets

Against the next post-seq-fix baseline:

- Cat1 F1: `+4 to +8` points
- Cat1 evidence recall: `+5` points minimum
- Cat3 F1: `+4 to +7` points
- Cat3 LLM score: `+8` points minimum
- Cat2 F1 regression: no worse than `-2` points

### Behavioral targets

- Cat1 set/count queries should retrieve more diverse sessions before final trim.
- Cat3 inference queries should stop depending on exact-match rows alone.
- Router-provided entity hints should influence executor behavior even for
  `default_mixed`.
- Retrieval-query augmentation must not break prefix-sensitive rerankers.

### Operational targets

- No API contract changes.
- Query latency should remain within roughly `1.5x` of the current routed search
  path for the benchmark workload.
- Each phase must be benchmarkable independently.

---

## Proposed Rollout

## Phase 0 — Measurement Repair and Benchmark Re-baseline (Completed)

### Purpose

Establish a trustworthy post-fix baseline before making new recall changes.

### Work

1. Keep the raw-session `seq` preservation fix in the current branch.
2. Rerun LoCoMo categories `1,2,3` with the same harness settings.
3. Recompute:
   - overall F1,
   - per-category F1,
   - per-category LLM score,
   - per-category evidence recall.
4. Re-slice failures by:
   - query prefix,
   - evidence span across sessions,
   - count vs set vs inference wording.
5. Record the post-fix result:
   - `/Users/shenjun/Workspace/mem9-ai/mem9-benchmark/locomo/results/2026-04-11T08-03-24-923Z.json`

### Files

- `server/internal/service/ingest.go`
- `server/internal/service/session.go`

### Exit criteria

- [done] a new benchmark JSON is available,
- [done] evidence recall no longer shows the suspicious early-session-only pattern.

---

## Phase 1 — Widen and Diversify the Explicit-Session Executor

### Purpose

Fix the main Cat1/Cat3 bottleneck: too little and too-local session evidence.

### Work

1. Increase session fetch budget for routed executor paths:
   - raise the session search fetch multiplier in
     `server/internal/service/session.go:18-20`,
   - widen the executor’s working limit before final trim.
2. Make explicit-session primary budget strategy-aware:
   - exact-event can stay narrow,
   - set/count/inference should allow larger session-primary share.
3. Make supplemental session budget strategy-aware:
   - `set_aggregation`, `count_query`, and future `attribute_inference`
     should blend more than the current 2 rows at final limit 10.
4. Add a coverage-aware final selector for `set_aggregation`:
   - prefer distinct session IDs,
   - prefer distinct item/event signatures,
   - penalize duplicates from the same local cluster,
   - keep final API result count unchanged.
5. Add a broader final selector for inference-shaped queries:
   - prefer evidence breadth over a single very high-scoring generic row.

### Code touchpoints

- `server/internal/handler/memory.go:395-440`
- `server/internal/handler/memory.go:854-921`
- `server/internal/handler/strategy_executor.go:231-388`
- `server/internal/service/session.go:18-20`

### Notes

This phase subsumes the useful part of “Idea 2”, but applies it where LoCoMo
actually spends most of its budget.

After the post-fix benchmark, this phase should be treated as a **targeted later
phase**, not the immediate next move. The new benchmark does not justify broad
widening first; it justifies targeted coverage selection after inference/count/
normalization work.

### Exit criteria

- Cat1 evidence recall improves materially,
- Cat1 `how many` and list-style queries stop collapsing onto a tiny local window,
- Cat3 retrieves broader evidence even before inference routing is added.

---

## Phase 2 — Separate Retrieval Query from Reranker Query

### Purpose

Enable entity augmentation without breaking query-shape rerankers.

### Work

1. Extend `MemoryFilter` with:
   - `RawQuery string`
   - helper `RerankerQuery() string`
2. Update query-shape and reranking call sites to use the reranker query.
3. Keep retrieval using the possibly augmented query.
4. Introduce a routed helper that builds retrieval filters:

```go
// Conceptual shape only.
func retrievalFilter(filter domain.MemoryFilter, entity string) domain.MemoryFilter
```

5. For routed set/count/exact-event queries with a confident entity:
   - preserve `RawQuery`,
   - augment retrieval query with entity-first form.

### Code touchpoints

- `server/internal/domain/types.go:66-77`
- `server/internal/handler/memory.go:924-980`
- `server/internal/handler/memory.go:1129-1145`
- `server/internal/handler/strategy_executor.go`
- `server/internal/service/memory.go:470-559`

### Notes

This is the correct implementation shape for “Idea 1”.
After the latest benchmark, this phase becomes **conditional**, not immediate:
only pull it forward if Cat1/Cat3 still look entity-precision-limited after
`attribute_inference`, count synthesis, and normalization.

### Exit criteria

- entity augmentation improves Cat1/Cat3 retrieval precision,
- rerankers still classify `when`, `what kind`, `how many`, etc. correctly.

---

## Phase 3 — Improve Count Semantics

### Purpose

Lift the weakest Cat1 subgroup: count questions.

### Open design choice

This phase is intentionally underspecified until a short spike chooses the
occurrence-dedup method. “Distinct occurrence” can be implemented in several
meaningfully different ways:

- heuristic grouping by entity + event term + time bound,
- metadata-aware grouping when event-fact rows are available,
- embedding or lexical clustering,
- LLM-assisted clustering.

These options have different latency, determinism, and accuracy tradeoffs.
The implementation should start with a spike and choose a concrete method before
committing to the full phase.

### Work

1. Run a short spike for count aggregation and choose one method:
   - heuristic-first is preferred unless evidence shows it is insufficient.
2. Keep numeric/time boosts in `rerankForCountQuery`, but stop relying on them alone.
3. Add a count-aware post-retrieval aggregation step using the chosen method:
   - group rows by distinct event/item signature,
   - deduplicate repeated paraphrases of the same occurrence,
   - prefer explicit time-bounded occurrences when the query contains a year/date bound.
4. Expand `count_query + set_aggregation` fanout usage where both are useful.
5. Trim back to the original limit after aggregation.

### Code touchpoints

- `server/internal/handler/strategy_executor.go:252-388`
- `server/internal/handler/strategy_executor.go:394-447`

### Notes

This phase is benchmark-focused and more valuable than a non-session rerank pass,
but it should not be treated as a fully settled design before the spike result is in.

### Exit criteria

- Cat1 `how many` questions improve materially,
- counts become less sensitive to generic numeric rows.

---

## Phase 4 — Add `attribute_inference` and Entity-Aware Default Mixed

### Purpose

Give Cat3 a dedicated executor path instead of forcing inference questions into
exact-event, set, or plain default behavior.

### Work

1. Add `StrategyAttributeInference` to:
   - `server/internal/domain/strategy.go`
   - router LLM prompt in `server/internal/service/strategy_router.go:313-345`
   - prototype seed data.
2. Add inference-oriented prototypes for:
   - `would X ...`
   - `might X ...`
   - `what kind of person`
   - `what attributes`
   - `what job might`
3. Implement `executeAttributeInference`:
   - broader explicit-session budget,
   - weaker dependence on one exact row,
   - optional local neighbor/context expansion,
   - broader evidence blending before final trim.
4. Make `default_mixed` executor-aware when router hints are present, even if
   the primary strategy is still `default_mixed`.
5. Add entity supplement search for inference/default-mixed paths:
   - FTS/keyword-first,
   - vector optional later,
   - blend into final context with a bounded ratio.

### Code touchpoints

- `server/internal/domain/strategy.go:4-8`
- `server/internal/service/strategy_router.go:313-345`
- `server/seed_recall_strategy_prototypes.sql`
- `server/internal/handler/memory.go:294-319`
- `server/internal/handler/strategy_executor.go`

### Notes

This phase subsumes the useful part of “Idea 4” and adds the missing
`attribute_inference` executor that the note did not cover.

### Exit criteria

- Cat3 `would/might/what kind/what attributes` questions improve,
- inference no longer depends on exact-row luck,
- `default_mixed` can exploit router-provided entity hints.

---

## Phase 5 — Relax Session-ID Neighbor Expansion Guard for Whole-Conversation Sessions

### Purpose

Recover useful local context when the benchmark’s `session_id` is actually the
entire conversation container, not a tiny subthread.

### Problem

`provenanceSessionGroundingSearch` currently skips neighbor expansion whenever
`filter.SessionID != ""` in `server/internal/handler/memory.go:552-555`.

That is safe for some product cases, but too strict for LoCoMo-style full-conversation
session IDs.

### Work

1. Relax the guard for:
   - `attribute_inference`,
   - `exact_event_temporal`,
   - low-coverage session seeds.
2. Keep expansion bounded:
   - few seeds,
   - small local windows,
   - dedupe aggressively.

### Code touchpoints

- `server/internal/handler/memory.go:521-565`
- `server/internal/handler/memory.go:620-776`

### Exit criteria

- temporal and relational questions gain nearby evidence without large noise spikes.
- Cat2 F1 regression is no worse than `-2` points from the pre-Phase-5 baseline.
- Cat2 LLM regression is no worse than `-3` points from the pre-Phase-5 baseline.

---

## Phase 6 — Router Retuning After Executor Strengthening

### Purpose

Only after the executor is stronger, reduce weak forced resolutions.

### Work

1. Re-evaluate step-1 prototype thresholds in
   `server/internal/service/strategy_router.go:252-305`.
2. Increase fallback rate for weak prototype singles when:
   - class support is shallow,
   - score gap is small,
   - query shape looks inferential.
3. Add `attribute_inference` to the allowed class set.
4. Reassess whether `default_mixed` should be the preferred fallback more often.

### Code touchpoints

- `server/internal/service/strategy_router.go:16-30`
- `server/internal/service/strategy_router.go:252-305`
- `server/internal/service/strategy_router.go:313-345`

### Exit criteria

- fewer weak prototype misroutes,
- Cat3 benefits from better fallback behavior,
- Cat2 remains stable.

---

## Phase 7 — Answer Normalization and Benchmark Loop

### Purpose

Recover exact-F1 after retrieval quality improves.

### Problem

The benchmark shows large exact-vs-LLM gaps:

- Cat1 exact correct count is far below semantically correct count,
- Cat3 has the same pattern.

This means retrieval is not the only issue; formatting and canonicalization also
matter.

### Work

1. Normalize list answers:
   - stable separators,
   - remove duplicate items,
   - canonical ordering when safe.
2. Normalize count/date outputs:
   - prefer bare count where the question expects a number,
   - prefer canonical date forms where the benchmark is strict.
3. Re-run LoCoMo after each major phase and compare:
   - Cat1 overall,
   - Cat1 `how many`,
   - Cat3 modal/inference,
   - Cat2 regression.

### Notes

Originally this was intentionally last. The latest benchmark changes that
priority: because evidence recall is now much higher while F1 remains flat,
answer normalization should move earlier in the rollout.

---

## Recommended Rollout Order

1. Phase 0 — measurement repair and re-baseline
2. Phase 4 — `attribute_inference` + entity-aware `default_mixed`
3. Phase 3 — count semantics
4. Phase 7 — answer normalization
5. Phase 1 — targeted explicit-session coverage selection
6. Phase 2 — retrieval query vs reranker query split, if still needed
7. Phase 5 — selective neighbor expansion with explicit `session_id`
8. Phase 6 — router retuning

---

## Risks and Mitigations

### Risk 1 — Latency regression from broad widening that no longer appears first-order

Mitigation:

- widen only for selected strategies,
- keep final result count unchanged,
- benchmark latency per phase.

### Risk 2 — Cat2 regression from over-diversification

Mitigation:

- keep exact-event path relatively narrow,
- run per-category benchmark comparison after each phase.

### Risk 3 — Entity augmentation distorts reranker behavior

Mitigation:

- introduce `RawQuery`,
- switch rerankers to `RerankerQuery()`.

### Risk 4 — Inference executor adds too much noise

Mitigation:

- bounded entity supplement ratio,
- session-diversity caps,
- prefer FTS/keyword entity grounding first.

### Risk 5 — Router changes mask executor improvements

Mitigation:

- delay major router retuning until after executor phases are benchmarked.

---

## Verification Plan

For each phase:

1. run targeted unit tests for touched services/handlers,
2. run LoCoMo categories `1,2,3`,
3. compare:
   - F1,
   - LLM score,
   - evidence recall,
   - latency,
4. inspect at least 20 failed Cat1 rows and 20 failed Cat3 rows,
5. decide whether to proceed, tune, or revert before the next phase.

---

## Practical Recommendation

If only one phase can be shipped immediately after the post-fix benchmark, ship
**Phase 4** first.

Reason:

- Cat3 still lacks a dedicated inference path,
- router hints for `default_mixed` are still underused,
- the latest benchmark says answer construction, not raw recall, is now the main bottleneck.

If two phases can be shipped, do **Phase 4 + Phase 3**.

That combination gives:

- better inference handling,
- better count synthesis,
- direct pressure on the weakest remaining benchmark behaviors.
