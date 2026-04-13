---
title: "Proposal: Unified Routed Recall Executor for LoCoMo"
status: draft
created: 2026-04-13
last_updated: 2026-04-13
depends_on:
  - "locomo-query-strategy-router-proposal.md"
  - "recall-session-links-plus-neighbor-expansion-proposal.md"
supersedes:
  - "executor-architecture portions of locomo-strategy-executor-improvements-proposal.md"
  - "executor-architecture assumptions in locomo-strategy-executor-implementation-checklist.md"
related_to:
  - "locomo-strategy-executor-improvements-proposal.md"
---

# Proposal: Unified Routed Recall Executor for LoCoMo

## Summary

The current strategy router is directionally useful, but the executor pattern
under it is too fragmented and too eager to replace the common retrieval path.
This is the main reason the latest Cat3 benchmark shows acceptable answer
plausibility but poor evidence recall.

Latest Cat3-only run used for this proposal:

- Branch: `shenjun/recall-imporvement-0x02-strategy-router`
- Artifact:
  `/Users/shenjun/Workspace/mem9-ai/mem9-benchmark/locomo/results/2026-04-13T00-35-45-688Z.json`
- F1: `17.68%` (`mean(.score)` over 96 rows)
- LLM: `52.08%` (`mean(.llm_judge_score)` over 96 rows)
- Evidence Recall: `33.13%` (`mean(.evidence_recall)` over the 92 rows where
  `evidence_recall != null`, matching the benchmark summary convention)

For avoidance of doubt:

- if null `evidence_recall` rows are treated as zero over all 96 rows, the same
  artifact yields `31.75%`,
- this proposal uses the benchmark-summary convention, not the zero-filled one.

Observed pattern:

- almost every request is routed through an LLM-produced strategy decision,
- many Cat3 queries are forced into `attribute_inference` or
  `exact_entity_lookup`,
- those strategies often activate narrower session behavior and synthetic
  entity-family side queries too early,
- the result is often a plausible answer built from generic or adjacent facts,
  not the benchmark's gold evidence turns.

This proposal changes the executor architecture, not the router contract.

The core decision is:

> keep routing, but make routing select **budget, additive side queries, and
> reranking policy**, not a completely different retrieval executor.

The target shape is:

```text
router.Detect(query)
  -> {strategy, entity, answerFamily, confidence}
  -> unified candidate generation
  -> strategy-aware rerank
  -> final trim
```

This proposal is intentionally scoped to the recall path only.

It does **not** include:

- benchmark answer prompt tuning,
- ingest prompt tuning,
- benchmark-side scoring changes.

Those may still be valid later, but they should not be mixed into the executor
refactor.

---

## Relationship To The April 11 LoCoMo Plan

This proposal is **not** a second independent roadmap for all LoCoMo work.

It supersedes only the **executor-architecture assumptions** in:

- `docs/design/locomo-strategy-executor-improvements-proposal.md`
- `docs/design/locomo-strategy-executor-implementation-checklist.md`

for the current branch and branch-local Cat3 baseline cited above.

It does **not** supersede the general value of later work on:

- count semantics,
- answer normalization,
- prompt tuning,
- ingest extraction quality.

Those remain valid follow-on levers after the executor shape is corrected.

Concretely:

- this proposal replaces the assumption that the next executor work should add
  or preserve several strategy-specific retrieval branches,
- it keeps the later interpretation that prompt, normalization, and extraction
  may still matter after retrieval architecture is stabilized.

If this proposal is accepted, reviewers should treat it as the authoritative
design for routed recall execution on this branch before continuing any
executor-related checklist work.

---

## Problem

## 1. Routing is not the main defect

`detectRecallStrategies` in
`server/internal/handler/strategy_executor.go` already gives useful signal:

- `strategyName`
- `entity`
- `answerFamily`
- confidence / fallback reason

That signal is valuable. The problem is what happens after it is produced.

## 2. The current executor split is too exclusive

`executeRoutedStrategy` dispatches into several separate retrieval functions:

- `executeExactEventTemporal`
- `executeSetAggregation`
- `executeCountQuery`
- `executeAttributeInference`
- `executeExactEntityLookup`
- `executeDefaultMixed`

Most of these are thin wrappers around a common path plus reranking, but one of
them, `executeExactEventTemporal`, still behaves as a narrow special path.

The split creates three problems:

1. different strategies do not always benefit from the same additive evidence
   sources,
2. some strategies bypass entity-context and entity-insight side queries
   entirely,
3. Cat3 ends up over-committed to narrow paths when the right behavior is often
   "broader mixed recall with better post-retrieval ordering."

## 3. `default_mixed` is not acting as a true fallback

`shouldExecuteStrategyDecision` currently allows a `default_mixed` decision to
still run routed executor logic when `entity != ""`.

That means the system is often not truly falling back to the common mixed path.
Instead it is still taking a specialized executor route.

## 4. The explicit-session path is over-specialized for Cat3

In the current branch, Cat3-like queries frequently activate:

- second-hop session search,
- thread chase,
- neighbor expansion,
- entity-context side queries,
- entity-insight side queries,
- strategy-specific reranking,

all within one request.

That stack is too aggressive for a benchmark where evidence recall is measured
against precise dialogue turns.

## 5. The benchmark data shows answer plausibility without evidence fidelity

The latest Cat3 run shows many rows where:

- `llm_judge_score = 1`
- `evidence_recall = 0`

This means the system is often retrieving semantically related facts or
high-level summaries, but not the actual gold support turns.

That is an executor-shape problem, not just a classifier problem.

---

## Design Goals

- Keep the existing router and strategy vocabulary.
- Keep one stable, shared base retrieval path for all routed queries.
- Preserve additive evidence sources such as entity context and entity insights.
- Let strategies control budgets and rerankers, not exclusive candidate
  generation logic.
- Improve Cat3 evidence recall without broad Cat1/Cat2 regression.
- Keep the external `/memories` API unchanged.

## Non-Goals

- Removing the router.
- Routing directly by LoCoMo category label.
- Folding answer prompt or benchmark prompt work into this proposal.
- Replacing the ingest system in this phase.
- Adding a graph store or new external retrieval subsystem in this phase.

---

## What To Keep

## 1. The router

Keep `RecallStrategyRouterService` and `detectRecallStrategies`.

The router is still useful because it provides:

- a primary strategy class,
- optional fanout information,
- an entity hint,
- an answer-family hint.

Those outputs remain useful as retrieval policy inputs.

## 2. `entityAwareSearchWindow`

Keep `entityAwareSearchWindow` as the main routed candidate generator.

It already has the right overall shape:

- shared base retrieval,
- optional entity-context side query,
- optional entity-insight side query,
- bounded blending.

This is the closest thing the current code already has to the target design.

## 3. Entity side queries

Keep:

- `entityContextSearch`
- `entityInsightSearch`

These are additive retrieval helpers, which is the right pattern.

## 4. Strategy-aware budget tables

Keep the existing parameterization points, even if some values change later:

- `entityContextLimit`
- `entityInsightLimit`
- `explicitSessionNeighborWindow`
- `explicitSessionSecondHopEnabled`
- `explicitSessionThreadChaseEnabled`

These should become budget/policy knobs under a unified executor.

## 5. Strategy-specific rerankers

Keep the reranker functions:

- `rerankForSetAggregation`
- `rerankForCountQuery`
- `rerankForAttributeInference`
- `rerankForExactAnswerFamily`

These are still useful, but they should be applied after a shared candidate
generation phase.

---

## What To Remove Or Collapse

## 1. Collapse per-strategy retrieval executors

The following functions should stop being separate candidate-generation paths:

- `executeAttributeInference`
- `executeExactEntityLookup`
- `executeSetAggregation`
- `executeCountQuery`

They should become thin wrappers or disappear entirely into a unified execution
flow:

```go
mems, total, err := s.entityAwareSearchWindow(...)
mems = rerankByStrategy(...)
return paginate(...)
```

## 2. Remove `executeExactEventTemporal` as a distinct retrieval path

`executeExactEventTemporal` is the clearest problematic special case.

Today it can route directly to:

- `explicitSessionSearch`, or
- `executeDefaultMixed`

without going through the same additive entity-context behavior as the other
strategy executors.

That inconsistency should be removed.

Temporal questions should still get temporal-aware policy, but not a distinct
candidate-generation branch.

## 3. Stop treating `default_mixed` as a pseudo-specialized route

If the router decides `default_mixed`, that should mean the normal unified path
with minimal specialization, not a hidden entity-triggered executor variant.

---

## Proposed Unified Flow

## Step 1. Detect

Use the existing router unchanged:

```text
decision = router.Detect(query)
```

Relevant outputs:

- `decision.PrimaryStrategy()`
- `decision.Entity`
- `decision.AnswerFamily`
- fallback / confidence metadata

## Step 2. Generate candidates with one shared executor

Replace most of `executeRoutedStrategy` with:

```text
entityAwareSearchWindow(
  filter,
  entity,
  strategyName,
  answerFamily,
)
```

This unified candidate generator does:

1. base retrieval:
   - explicit-session mixed path when `session_id` is present,
   - default mixed path otherwise,
2. additive side query:
   - entity context,
3. additive side query:
   - entity insight,
4. bounded merge.

The strategy does **not** choose a different retrieval executor here.
It only changes the policy knobs used inside the shared executor.

## Step 3. Rerank by strategy

After candidate generation, dispatch one reranker:

- `set_aggregation` -> `rerankForSetAggregation`
- `count_query` -> `rerankForCountQuery`
- `attribute_inference` -> `rerankForAttributeInference`
- `exact_entity_lookup` -> `rerankForExactAnswerFamily`
- `exact_event_temporal` -> temporal-aware exact rerank
- `default_mixed` -> either no extra rerank, or current generic grounded
  reranking only

This turns strategy into a post-retrieval ordering decision instead of an
exclusive executor decision.

## Step 4. Trim

After reranking:

- paginate,
- preserve total semantics,
- return as today.

---

## Phase 1 Policy Matrix

Phase 1 must not leave core retrieval-shape choices to implementers.

The following matrix is normative for the first implementation pass.

| Strategy | Routed In Phase 1 | Candidate Generator | Entity Context | Entity Insights | Second Hop | Thread Chase | Neighbor Window | Post-Step Rerank |
|---|---|---|---|---|---|---|---|---|
| `default_mixed` | No when it is the sole strategy | existing legacy path | No new router-driven side query | No new router-driven side query | existing behavior only | existing behavior only | existing behavior only | existing behavior only |
| `exact_event_temporal` | Yes | unified executor | Yes | Yes | No | No | `1/1` | dedicated temporal exact rerank |
| `set_aggregation` | Yes | unified executor | Yes | Yes | No | No | `0/0` | `rerankForSetAggregation` |
| `count_query` | Yes | unified executor | Yes | Yes | No | No | `0/0` | `rerankForCountQuery` |
| `attribute_inference` | Yes | unified executor | Yes | Yes | No | No | `0/0` | `rerankForAttributeInference` |
| `exact_entity_lookup` | Yes | unified executor | Yes | Yes | No | No | `0/0` | `rerankForExactAnswerFamily` |

Notes:

- `default_mixed` is intentionally conservative in phase 1. If the router
  resolves to `default_mixed` only, the request should not enter the new routed
  executor just because `entity != ""`.
- phase 1 explicitly disables second-hop and thread chase for all non-default
  routed strategies to avoid carrying forward the current Cat3 over-expansion.
- only `exact_event_temporal` keeps a small neighbor window in phase 1, because
  local temporal context is still often useful and bounded.

### Phase 1 entity-insight budget

Phase 1 must also specify the insight-side budget for strategies newly marked
`Entity Insights = Yes`.

For these strategies:

- `exact_event_temporal`
- `set_aggregation`
- `count_query`

use one shared conservative generic budget shape in the first pass:

- `limit <= 2` -> `1`
- `limit <= 10` -> `2`
- `limit > 10` -> `3`

This applies only to phase 1 and is intentionally conservative.

Rationale:

- it avoids ad hoc policy invention during implementation,
- it keeps phase 1 structural rather than turning it into a broad retuning
  phase,
- it leaves later per-strategy retuning to phase 2 once the unified executor is
  benchmarked.

### Phase 1 entry condition

`shouldExecuteStrategyDecision` should behave as:

- route only when `!decision.IsDefault()` or when the router returned a valid
  compatible fanout pair,
- do **not** route a sole `default_mixed` decision merely because `entity != ""`.

This keeps phase 1 bounded and avoids silently changing the semantics of
fallback/default execution.

---

## Phase 1 Temporal Reranker

Phase 1 must specify what "temporal-aware exact rerank" means.

Introduce a dedicated temporal rerank helper for `exact_event_temporal` that:

- boosts rows with absolute time signals,
- boosts rows with relative time signals,
- boosts rows that contain the primary entity,
- boosts rows that contain the primary event term,
- penalizes generic facts that lack temporal cues,
- penalizes question turns unless they remain highly relevant after the other
  boosts.

This helper should reuse the same signal family already present in:

- `rerankExplicitSessionMemories`
- `isTemporalQuestion`
- `containsAbsoluteTimeSignal`
- `containsRelativeTimeSignal`

The important rule is:

> `exact_event_temporal` keeps a dedicated reranker, but not a dedicated
> candidate-generation branch.

---

## Strategy Semantics Under The Unified Executor

## `default_mixed`

Behavior:

- in phase 1, do **not** enter the routed executor when it is the sole strategy,
- preserve the current legacy default path,
- do not activate a hidden specialized route just because an entity was
  extracted,
- leave any future entity-aware `default_mixed` behavior to a later proposal or
  phase.

## `exact_event_temporal`

Behavior:

- use the same shared candidate generator,
- emphasize date-bearing rows,
- keep temporal reranking and exact-answer bias via the dedicated temporal
  reranker defined above,
- do not skip entity context/insight retrieval.

## `set_aggregation`

Behavior:

- use the same shared candidate generator,
- allow a larger additive budget where needed,
- apply set-aware reranking and coverage-aware selection later.

## `count_query`

Behavior:

- use the same shared candidate generator,
- bias toward numeric and time-bounded evidence during rerank,
- keep future count-specific aggregation logic separate from candidate
  generation.

## `attribute_inference`

Behavior:

- use the same shared candidate generator,
- allow broader evidence than exact-event,
- use inference-specific reranking,
- avoid forcing a narrow "Cat3-only" session path.

## `exact_entity_lookup`

Behavior:

- use the same shared candidate generator,
- use exact-answer-family reranking,
- preserve entity and answer-family side query benefits,
- avoid direct fallback to a different narrow search shape.

---

## Why This Direction Matches The mem0 Lesson

The local `mem0` codebase uses a simpler and safer retrieval pattern:

- broad vector retrieval,
- optional graph lookup in parallel,
- optional reranking,
- additive graph relations that do not replace or reorder the base path by
  default.

Its important lesson is not "remove specialization."

Its lesson is:

> keep one shared candidate-generation path and layer specialization on top of
> it.

That is exactly what this proposal does for mem9.

For mem9 specifically:

- the router remains,
- the shared candidate generator remains,
- additive side queries remain,
- only the exclusive executor split is removed.

---

## Expected Impact

## Primary expected wins

- Cat3 evidence recall improves because fewer queries are diverted into narrow
  special-case paths.
- Cat3 answer quality should become more stable because all strategies benefit
  from the same additive evidence sources.
- Exact temporal queries stop skipping entity side queries.
- Executor behavior becomes easier to reason about and benchmark.

## Secondary expected wins

- Less duplicated executor logic.
- Safer future strategy additions because a new strategy only needs:
  - budget tuning,
  - optional side-query tuning,
  - rerank policy.

## Risks

- If the shared base path is too broad, some exact temporal or exact entity
  queries may temporarily lose precision.
- Existing Cat2 behavior may regress if temporal/exact reranking is not strong
  enough after unification.
- Current budget tables may need retuning after the executor split is removed.

---

## Compatibility Invariants

The external `/memories` API must remain stable in the following ways during
phase 1:

- `listResponse` shape remains unchanged.
- `Route` remains populated whenever strategy detection succeeds, even if the
  request stays on the legacy non-routed `default_mixed` path.
- `responseDedupKey` remains the dedupe key for routed and fanout merges.
- `Limit` / `Offset` pagination semantics remain unchanged.
- `memory_type`, `session_id`, `source`, and tag filters retain their current
  meaning.
- Non-routed legacy paths retain their current `Total` semantics.
- For routed single-strategy execution, `Total` is the candidate count after
  additive blending and strategy rerank, before final pagination.
- For routed fanout execution, `Total` is the merged pre-page count after branch
  dedupe and before final pagination.

These invariants should be called out explicitly in tests when phase 1 is
implemented.

---

## Fanout Semantics Under The Unified Executor

Phase 1 keeps fanout, but it must be explicit.

### Supported fanout

Phase 1 keeps the existing compatible pair rule only:

- `set_aggregation + count_query`
- `count_query + set_aggregation`

No new fanout pairs are introduced in this proposal.

### Branch execution

For a compatible fanout decision:

1. derive `branchFilter` exactly as the current code does:
   - `Offset = 0`
   - `Limit = filter.Offset + filter.Limit`
2. execute each branch through the same unified candidate generator,
3. apply branch-specific reranking **inside each branch** before merge,
4. do **not** apply a second post-merge reranker in phase 1.

### Merge

Phase 1 keeps the current merge semantics to minimize surface area:

- 60/40 primary/secondary merge bias,
- `responseDedupKey` for dedupe,
- existing `paginateFanout` behavior,
- existing fallback behavior:
  - both branches fail -> fallback to legacy default path,
  - one branch fails -> use the surviving branch,
  - merged empty -> fallback to legacy default path.

This proposal changes branch candidate generation, not branch merge weighting.

---

## Rollout Plan

## Phase 1. Unified Non-Default Routed Execution

Goals:

- unify execution shape,
- keep default fallback conservative,
- avoid changing too many heuristics at once.

Changes:

- refactor `executeRoutedStrategy` into unified execution,
- remove `executeExactEventTemporal` as a distinct retrieval branch,
- stop pseudo-specialized `default_mixed` execution,
- implement the phase-1 policy matrix above,
- keep current fanout merge semantics initially.

Validation:

- benchmark Cat3 first,
- then check Cat1/Cat2 for regression.

## Phase 2. Budget retuning

After the unified executor is stable:

- retune explicit-session primary budget,
- retune side-query budgets,
- retune Cat3 second-hop / thread chase / neighbor expansion policy.

## Phase 3. Follow-on work outside this proposal

Separate proposals or commits may then address:

- answer prompt tightening,
- ingest extraction improvements,
- exact-entity family completeness,
- count aggregation improvements,
- additive entity/event structure beyond the current side queries.

---

## Benchmark Plan

The executor refactor should be benchmarked independently from answer prompt and
ingest changes.

Required sequence:

1. baseline current branch,
2. run unified executor only,
3. compare:
   - Cat1 F1 / LLM / ER
   - Cat2 F1 / LLM / ER
   - Cat3 F1 / LLM / ER
4. only after that, test answer prompt or ingest improvements.

Required analysis slices:

- routed strategy distribution,
- evidence recall by query prefix,
- evidence recall for `what`, `would`, `which`, `how many`,
- exact-entity family results,
- exact-temporal query results.

Success criteria for this proposal:

- Cat3 evidence recall improves materially over the current baseline,
- Cat2 does not materially regress,
- routed execution behavior becomes simpler and easier to interpret in logs.

---

## Post-Phase-1 Questions

These questions are intentionally deferred because they do not block phase 1:

## 1. Should later phases make sole `default_mixed` entity-aware again?

Phase 1 says no. A later phase may revisit this if benchmarks show that
router-provided entity hints still add value without recreating the current
hidden-specialization problem.

## 2. Should fanout remain once the unified executor is benchmarked?

Phase 1 preserves fanout semantics. Later phases may remove or simplify fanout
if it no longer adds measurable value after candidate generation is shared.

## 3. Should Cat3 re-enable any bounded session expansion after phase 1?

Phase 1 disables second-hop and thread chase for non-default routed strategies.
Later phases may re-enable a bounded subset if benchmark evidence supports it.

---

## Recommendation

Adopt this proposal before further prompt or ingest tuning.

The current benchmark and code review both support the same conclusion:

- routing is not the main defect,
- the fragmented executor pattern is,
- and the correct next step is a unified routed recall executor where strategy
  selects policy, not a different retrieval engine.
