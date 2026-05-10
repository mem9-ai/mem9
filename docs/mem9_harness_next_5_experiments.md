# Next 5 mem9 LoCoMo Experiments

Date: 2026-05-10

These are ordered recovery experiments after the audit. They are not authorized
for execution until the user explicitly approves.

## Required Setup Before Experiment 1

1. Close or explicitly validate the current dirty state:
   - `mem9/server/internal/handler/recall.go`
   - `mem9-benchmark/locomo/src/registry.ts`
   - `clawd/disc/harness/harness.md`
   - `clawd/disc/harness/mem9_locomo_harness_supervisor.sh`
   - `clawd/disc/scripts/locomo_backfill_manifests.py`
2. Do not reuse `last-ingest-cache.json` unless lineage proves it was produced by
   clean no-change code. Its current `created_at` is
   `2026-05-10T16:42:56.710Z` (`locomo/results/last-ingest-cache.json:7`).
3. Rebuild clean controls and record min/mean/max before comparing candidates.

## 1. ER0 Storage-vs-Retrieval Attribution Study

Hypothesis:

The largest raw failure class cannot be fixed safely until ER0 rows are split into
stored-but-not-retrieved versus never-stored/incorrectly-merged.

Exact change scope:

No code change. Read-only analysis of latest clean result, stored memories, and
candidate pools.

Files likely to change:

None.

Benchmark command:

No full benchmark. Use read-only trace/query tooling against a clean backend only.

Expected metric movement:

No direct score movement. Expected output is a classified ER0 table with at least
one homogeneous mechanism covering >=8 judged rows and <=4 risk rows.

Success criteria:

- Classify at least 50 Cat1/Cat4 ER0 failures.
- Identify one production mechanism with expected net >= +8 LLM rows.
- Produce row-level evidence: question, gold evidence, stored candidate status,
  first rank if present, source metadata, and risk rows.

Failure criteria:

- Failures are too heterogeneous.
- No shared mechanism reaches >=8 expected rows.

Rollback plan:

No rollback; read-only.

Overfitting risk:

Low.

Approval:

Required before running any command beyond read-only inspection.

## 2. Cross-Speaker Context Dedupe And Conflict-Aware Selection

Hypothesis:

mem0-style speaker-scoped retrieval duplicates the same conversation-derived facts
across both speaker contexts, causing answer confusion and hiding mixed-speaker
facts.

Evidence:

- `retrieve.ts` retrieves speaker_a and speaker_b separately and concatenates both
  contexts (`locomo/src/retrieve.ts:81-123`).
- `ingest.ts` prepares a full ingest plan per speaker role mapping
  (`locomo/src/ingest.ts:137-162`).
- Algorithm audit found exact duplicate retrieved content in 1932/1985 latest
  questions and 9481 duplicate memory items across prompts.
- Baseline mixed-speaker LLM is low: 38.46% (`benchmark/BASELINE.md:88-93`).

Exact change scope:

First perform a read-only trace simulation. If it proves movement, implement a
server-side selection/dedupe mechanism without changing benchmark scoring.

Files likely to change:

- `server/internal/handler/recall.go`
- `server/internal/service/memory.go`
- focused server tests

Benchmark command:

Cached after clean controls:

```bash
USING_LAST_INGEST=true bash /home/ec2-user/git/clawd/disc/scripts/locomo.sh
```

Expected metric movement:

Overall LLM +0.30pp or pairwise net +8; mixed-speaker +3pp; no Cat2/Cat4 severe
regression.

Success criteria:

- Trace gate: >=8 judged target rows improved, <=4 risk rows.
- Candidate beats same-cache control mean, not just one control run.
- No denominator drift.

Failure criteria:

- Dedupe removes speaker-specific evidence.
- Cat2/Cat4/mixed regresses.
- Movement is present only in benchmark-side context simulation and cannot be
  implemented in product server semantics.

Rollback plan:

Revert touched server files and discard candidate cache/control artifacts.

Overfitting risk:

Medium.

Approval:

Required for both implementation and benchmark.

## 3. Source-Linked Child Answer Artifacts

Hypothesis:

Short-answer source-linked child artifacts can improve Cat4 ER0/ER1 rows without
global top-level fact noise if they expand only after parent/source memory is
retrieved.

Evidence:

- Cat4 dominates current LLM failures in diagnostics, and Cat4 has high row count
  (`benchmark/BASELINE.md:81-85`).
- Previous broad source-packet/keyword methods failed due movement/risk; this
  experiment must be parent-gated, not global admission.

Exact change scope:

Server ingest/storage and retrieval context artifact generation only. No benchmark
answer prompt or scoring changes.

Files likely to change:

- `server/internal/service/ingest.go`
- source provenance helper files
- focused ingest/retrieval tests

Benchmark command:

Fresh product path:

```bash
bash /home/ec2-user/git/clawd/disc/scripts/locomo.sh
```

Expected metric movement:

Cat4 LLM +1.0pp or Overall LLM +0.30pp; evidence recall non-regressing.

Success criteria:

- Overall >= active gate after clean controls.
- Cat4 improves without Cat2/Cat3/mixed regression.
- Memory count increase is explainable and bounded.

Failure criteria:

- Fact volume increases without row-level gains.
- Source-linked artifacts become top-level noise.
- Product score regresses like keyword/entity admission did.

Rollback plan:

Revert server files, discard produced cache/backend, rebuild clean control.

Overfitting risk:

Medium-high.

Approval:

Required.

## 4. Exact Source Observation-Date Binding

Hypothesis:

Temporal failures with full evidence often choose the wrong nearby event/date.
Binding date metadata to exact source observation can improve Cat2 without broad
date-token bias.

Evidence:

- Benchmark answer prompt already contains temporal rules (`llm.ts:137-171`), so
  remaining temporal errors should be fixed in source provenance/ranking rather
  than prompt text.
- Broad temporal/source boosts repeatedly moved too few rows or carried risk
  (`source_turn_question_neighbor_preflight_reject_20260509T180336Z_530.md`,
  `source_tail_scoring_isolation_preflight_reject_20260509T1851Z_534.md`).

Exact change scope:

Exact source metadata only: no broad month/year/date token boosts.

Files likely to change:

- `server/internal/service/temporal_fact.go`
- `server/internal/service/ingest.go`
- `server/internal/service/fact_profile.go`
- possibly `server/internal/handler/recall.go`

Benchmark command:

Fresh product path if ingest/storage changes:

```bash
bash /home/ec2-user/git/clawd/disc/scripts/locomo.sh
```

Expected metric movement:

Cat2 LLM +1.0pp; Overall +0.15..0.30pp. This can enter incubate only if no bucket
regresses.

Success criteria:

- Cat2 improves against clean control mean.
- No Cat4/mixed regression.
- Row-level evidence shows exact source binding fixed the answer.

Failure criteria:

- Movement comes from broad date bias.
- Fewer than 8 expected rows.
- Cat4 or mixed-speaker regression.

Rollback plan:

Revert temporal/provenance changes; rebuild control if ingest changed.

Overfitting risk:

Medium.

Approval:

Required.

## 5. Narrow Update/Dedup-Aware Reconciliation

Hypothesis:

ADD-only exact-hash reconciliation leaves stale and conflicting facts that suppress
current-state and list answers.

Evidence:

- `reconcile` is explicitly ADD-only and never archives, updates, or deletes
  existing memories (`server/internal/service/ingest.go:1394-1398`).
- Near-duplicate search is shadow-only by default (`ingest.go:1419-1424`).
- Many previous fact-volume attempts regressed, so this must be update/dedup
  precision, not more extraction.

Exact change scope:

Only update a memory when entity/predicate/source-seq evidence proves it is the
same fact slot. Preserve source provenance.

Files likely to change:

- `server/internal/service/ingest.go`
- `server/internal/service/fact_profile.go`
- source provenance tests

Benchmark command:

Fresh product path:

```bash
bash /home/ec2-user/git/clawd/disc/scripts/locomo.sh
```

Expected metric movement:

Cat1 +1.0pp, duplicate-context count down, Overall +0.30pp.

Success criteria:

- Overall >= active gate.
- Duplicate/conflict diagnostics improve.
- No loss in Cat4/mixed.

Failure criteria:

- Useful historical facts are overwritten.
- Memory count or dedupe count changes without target-row improvement.
- Cat4/mixed regression.

Rollback plan:

Revert ingest/reconcile changes and rebuild clean product control.

Overfitting risk:

High.

Approval:

Required.

## Final Approval Gate

No experiment in this file is approved for execution. The user must explicitly
choose one experiment and approve its validation lane before implementation or
benchmark execution.
