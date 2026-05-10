# mem9 LoCoMo Harness Retrospective

Date: 2026-05-10

Status: AUDIT MODE. This document is forensic analysis only. It does not approve
production, benchmark, harness, prompt, config, or scoring changes.

## Executive Summary

The last 500+ iterations did not fail for one single reason. The evidence points
to a process failure made of four interacting problems:

1. Earlier work did produce real keeps, but the later mem0-style phase shifted
   into harness-review/control/preflight churn. The registry contains 556 rows,
   with 144 `harness-review` rows and 373 `cached-retrieval` rows; recent rows
   are dominated by harness repairs and preflight rejects rather than accepted
   server changes (`/home/ec2-user/Documents/Dev/harness/experiments/registry.jsonl`).
2. The former active promotion gate was smaller than observed no-change variance.
   At audit time the baseline was 68.29% and the gate was 68.59%; after this
   audit follow-up the formal gate is 69.29% (`benchmark/BASELINE.md:31-36`).
   Recent no-change/control scores include 68.62%, 66.67%, and 66.73%
   (`registry.jsonl:542`, `registry.jsonl:551`, `registry.jsonl:555`).
3. The latest cached-control path is not clean enough to trust without repair.
   Harness policy says reverted product-path candidates contaminate their cache
   and backend (`/home/ec2-user/git/clawd/disc/harness/harness.md:57`,
   `harness.md:65`). The latest `last-ingest-cache.json` was created at
   `2026-05-10T16:42:56.710Z` (`locomo/results/last-ingest-cache.json:7`), the
   same timestamp family as the reverted product candidate recorded at
   `registry.jsonl:553`; the later "clean" cached control uses that cache
   (`registry.jsonl:555`).
4. The remaining score ceiling is not just "recall is bad." The latest inspected
   mem0-style run splits failed LLM rows into missing evidence, partial evidence,
   and full-evidence answer failures. Algorithmic audit found 247 failures with
   no retrieved evidence, 131 with partial evidence, and 199 with full evidence
   in `/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-10T20-08-27-470Z_mem0-style.json`.

There is also current dirty score-sensitive state: `mem9` has
`server/internal/handler/recall.go` dirty; `mem9-benchmark` has
`locomo/src/registry.ts` dirty; `clawd` has harness script/docs dirty. The final
harness state records `server/internal/handler/recall.go` as score-sensitive dirty
(`mem9_locomo_harness_state.json:46-50`, `:77-79`). No further benchmark result
should be promoted until that state is closed or explicitly validated.

## Evidence Map

| Source | Type | Range / Scope | Contains | Trust | Gaps / Risks |
|---|---|---:|---|---|---|
| `/home/ec2-user/.codex/sessions` | Codex transcripts | 624 files, 2026-05-03..2026-05-10 | Per-iteration agent sessions and subagent sessions | Medium | No `/home/ec2-user/.codex/archived_sessions` exists; some previous Mac logs are absent on EC2. |
| `/home/ec2-user/.codex/history.jsonl` | User/session history | current EC2 session | User stop/review/progress requests and repeated concerns | Medium | Summarized command output not always present. |
| `/home/ec2-user/Documents/Dev/harness/runtime` | Supervisor iteration logs | 594 iteration logs | Per-iteration execution logs and last messages | High for runtime behavior | Some interrupted iterations lack complete outcome. |
| `/home/ec2-user/Documents/Dev/harness/results` | Archived artifacts | 1964 files | Result JSON, manifests, preflight summaries, review summaries | High when manifest exists | Some older rows required manifest backfill. |
| `/home/ec2-user/Documents/Dev/harness/experiments/registry.jsonl` | Experiment registry | 556 rows | Decisions, lanes, scores, changed files, cache/control metadata | Medium-high | Some rows are backfilled; backfill can use loose cache identity (`locomo_backfill_manifests.py:429-440`). |
| `/home/ec2-user/Documents/Dev/harness/learns` | Failure notes | 807 files | Reverts, preflight rejects, harness repairs | Medium | Authoritative only when tied to result artifacts. |
| `/home/ec2-user/Documents/Dev/harness/proposals` | Success notes | 18 files | Historical keeps and baseline moves | Medium-high | Several predate repaired harness and active mem0-style protocol. |
| `/home/ec2-user/git/mem9/benchmark/BASELINE.md` | Active baseline | current | Baseline 68.29, formal gate 69.29 after audit follow-up, category buckets | High for current policy | Static harness text can drift; baseline lock is preferred. |
| `/home/ec2-user/git/mem9-benchmark/locomo/results` | Raw benchmark outputs | 283 result/cache files | Full QA rows, predictions, retrieved contexts, stats | High for score artifacts | LLM provider failures can drop rows (`cli.ts:550-565`). |
| `/home/ec2-user/git/mem9-benchmark/locomo/src` | Benchmark implementation | current | Retrieval, answer prompt, judge, scoring, stats | High | It contains benchmark-side answer/context aids, so not pure server quality. |
| `/home/ec2-user/git/mem9/server` | Product server code | current | Ingest, recall, ranking, reconciliation | High | Current dirty `recall.go` must be resolved before new runs. |
| `/home/ec2-user/git/mem0` | Reference implementation | local checkout | Hybrid scoring and mem0 prior | Medium | It is a design prior, not a mem9 baseline. |

Missing evidence:

- `/home/ec2-user/.codex/archived_sessions` is absent.
- `~/Library/Logs/com.openai.codex` is a macOS path and is absent on this EC2 host.
- Some historical pre-EC2 Mac artifacts were summarized in handoff/learn files, but not all original transcripts are present.
- The subagent audit did not rerun benchmarks, by design.

## Timeline Reconstruction

| Time / Iteration | Attempt | Hypothesis / Change | Score Movement | Outcome | Evidence |
|---|---|---|---:|---|---|
| 2026-04-07 | Session grounding blend | Preserve raw session turns with normal extraction and append session grounding | 64.42 -> 69.81, +5.39pp | keep | `/home/ec2-user/Documents/Dev/harness/proposals/mem9_benchmark_opt_20260407_0045.md:5` |
| 2026-04-07 | Lexical normalization | Normalize FTS/keyword query only | 69.81 -> 70.58, +0.78pp | keep | `/home/ec2-user/Documents/Dev/harness/proposals/mem9_benchmark_opt_20260407_0522.md:6` |
| 2026-04-25 | Enumeration adjacent turn | Conservative adjacent expansion for enumeration | 65.43 -> 66.28, +0.85pp | keep | `/home/ec2-user/Documents/Dev/harness/proposals/enumeration_adjacent_turn_success_20260425T2230.md:7` |
| 2026-04-29 | Policy-gated recall / vector fallback | Split query policies; fall back to keyword/FTS when vector weak | 66.28 -> 66.95, +0.67pp | keep | `/home/ec2-user/Documents/Dev/harness/proposals/policy_gated_recall_vector_fallback_success_20260429T150238.md:7` |
| 2026-05-02 | Source-turn finalization | Apply `FinalizeSearchResults` in confidence recall | 65.04 -> 66.43, +1.39pp | keep | `/home/ec2-user/Documents/Dev/harness/proposals/source_turn_finalize_success_20260502T135123.md:5` |
| 2026-05-03 | Temporal answer-time normalization | Normalize relative temporal answers from `[answer-time]` | 64.65/65.26 -> 65.26 | keep | `/home/ec2-user/Documents/Dev/harness/proposals/temporal_answer_time_normalization_success_20260503T215321Z.md:20` |
| 2026-05-03 | Location/deictic normalization | Narrow answer normalization for location/relative answers | 65.26 -> 66.69, +1.43pp | keep | `/home/ec2-user/Documents/Dev/harness/proposals/location_and_deictic_answer_normalization_success_20260503T222443Z.md:6` |
| 2026-05-05 / 068 | Limit=20 product baseline | Clean no-change limit=20 control | 66.69 -> 70.32 | keep baseline | `/home/ec2-user/Documents/Dev/harness/proposals/product_path_limit20_baseline_20260505T171107Z-068.md:51` |
| 2026-05-06 / 136 | Baseline refresh | Clean no-change refresh beat stale baseline | 70.32 -> 70.97 | keep baseline | `/home/ec2-user/Documents/Dev/harness/proposals/product_path_limit20_baseline_refresh_20260506T083712Z-136.md:27` |
| 2026-05-07 / 322 | List bridge adjacent source-turn | Carry same-speaker neighboring raw turns for lists/inventory | 67.17 -> 67.84, +0.67pp | keep | `/home/ec2-user/Documents/Dev/harness/proposals/list_bridge_adjacent_source_turn_success_20260507T171719Z-322.md:18` |
| 2026-05-08 / 351 | Balanced exact/general selection | More balanced recall selection rounds | 67.17 -> 67.88, +0.71pp | keep | `/home/ec2-user/Documents/Dev/harness/proposals/balanced_exact_general_selection_rounds_success_20260508T045644Z-351.md:36` |
| 2026-05-09 / 450 | Assistant assertion ingest | Extract concrete assistant assertions | +0.24pp, Cat4 -1.13pp | revert | `/home/ec2-user/Documents/Dev/harness/learns/assistant_assertion_answer_bearing_ingest_revert_20260509T010521Z-450.md:27` |
| 2026-05-09 / 494-495 | Keyword-only BM25 admission | Admit strong BM25-only hits | cached +0.65pp; product 67.10 vs 67.88 | revert | `/home/ec2-user/Documents/Dev/harness/learns/keyword_only_bm25_admission_continue_20260509T095901Z_494.md:24`, `/home/ec2-user/Documents/Dev/harness/learns/keyword_only_bm25_admission_product_revert_20260509T101122Z_495.md:10` |
| 2026-05-09 / 537 | Speaker tag role labels | Use real speaker labels during extraction | +0.28pp then +0.35pp, below gate; mixed/Cat4 down | continue then revert | `/home/ec2-user/Documents/Dev/harness/learns/speaker_tag_role_label_product_continue_20260509T191116Z_537.md:30`, `/home/ec2-user/Documents/Dev/harness/learns/speaker_tag_role_label_product_revalidation_revert_20260509T210843Z_537.md:28` |
| 2026-05-10 | Entity-store active baseline | Current accepted mem0-style baseline | 68.29; former audit-time gate 68.59, later raised to 69.29 | baseline | `/home/ec2-user/git/mem9/benchmark/BASELINE.md:31-45`, `:74-93` |
| 2026-05-10 / 545 | Entity-confirmed keyword admission | Mem0-derived bounded keyword admission | cached net +8; product 66.84 vs 68.29 | revert | `/home/ec2-user/Documents/Dev/harness/learns/entity_confirmed_keyword_admission_continue_20260510T075432Z_545.md:19`, `/home/ec2-user/Documents/Dev/harness/learns/entity_confirmed_keyword_product_revert_20260510T082906Z_545.md:26` |
| 2026-05-10 / 548 | Cat1 second-hop retrieval | Source-linked second-hop recall | cached 67.04 vs control 67.12 | revert | `/home/ec2-user/Documents/Dev/harness/learns/cat1_multihop_second_hop_retrieve_reject_20260510T161808Z_548.md:9` |
| 2026-05-10 / 548-550 | Carried product + kind/type preflight | Retry entity admission, then kind/type source priority | product 66.67; preflight moved 3<8 | revert/reject | `/home/ec2-user/Documents/Dev/harness/learns/entity_confirmed_keyword_product_revert_20260510T164239Z_548.md:14`, `/home/ec2-user/Documents/Dev/harness/experiments/registry.jsonl:556` |

## Repeated Failed Patterns

### 1. Local-slice wins did not survive global/product validation

Evidence:

- Assistant assertion ingest improved Cat1 and Cat2 but regressed Cat4 and missed gate
  (`assistant_assertion_answer_bearing_ingest_revert_20260509T010521Z-450.md:35`).
- Keyword-only BM25 improved cached score but product validation fell below active
  baseline (`keyword_only_bm25_admission_product_revert_20260509T101122Z_495.md:27`).
- Entity-confirmed keyword admission had same-cache pairwise evidence but product
  runs fell to 66.84 and then 66.67 (`entity_confirmed_keyword_product_revert_20260510T082906Z_545.md:36`,
  `entity_confirmed_keyword_product_revert_20260510T164239Z_548.md:15`).

Hypothesis:

The harness over-selected target slices with visible movement while underestimating
global Cat2/Cat4/mixed-speaker regression risk.

### 2. Preflight became a low-yield loop

Evidence:

- Registry rows 477-556 include many preflight rejects with `expected_moved_rows`
  below 8 or `risk_rows_count` above 4 (`registry.jsonl:477-556`).
- Harness policy now explicitly warns against standalone cached preflight churn
  and requires server-owned candidates under stall (`harness.md:205-223`).

Hypothesis:

The preflight machinery correctly prevented many bad full runs, but candidate
generation did not become stronger; it kept slicing by question shape/topic rather
than proving a product mechanism with broad safe movement.

### 3. Harness engineering started repairing symptoms faster than strategy quality

Evidence:

- Registry counts: 144 `harness-review` rows, 45 `harness-review keep` rows, and
  many recent validator/manifest/policy repairs (`registry.jsonl`).
- The supervisor/prompt includes multiple layers of post-fix validation, blocking
  policy, outcome validation, incubate ledger, and dirty recovery (`harness.md:171-243`).

Hypothesis:

Harness rules improved safety but also made the system spend many rounds on
process control. That was justified for contaminated runs, but it did not solve
candidate selection or algorithmic bottlenecks.

### 4. Cache/control lineage was not reliable enough

Evidence:

- Harness policy says reverted product candidates contaminate cache/backend
  (`harness.md:57`, `harness.md:65`).
- Latest `last-ingest-cache.json` has `created_at=2026-05-10T16:42:56.710Z`
  (`last-ingest-cache.json:7`).
- Registry records a reverted product candidate at `registry.jsonl:553` and a later
  cached clean control on the same current cache at `registry.jsonl:555`.
- Backfill can attach cached-control metadata using exact, basic, then loose
  identities (`locomo_backfill_manifests.py:429-440`).

Hypothesis:

Some later cached comparisons are contaminated or at least weaker evidence than
their labels imply.

## Benchmark Trustworthiness Assessment

The LoCoMo harness is useful as a rough signal, but it is not trustworthy enough
for single-run +0.3pp promotions right now. The formal keep gate has therefore
been raised to +1.0pp over clean control mean or net +15 LLM-correct pairwise,
while +0.30pp..+0.99pp remains an incubate-only band.

Evidence:

- Former audit-time gate: 68.29 baseline and 68.59 gate. Current formal gate:
  69.29 (`BASELINE.md:31-36`).
- No-change/control movement is larger than the gate: 68.62, 66.67, 66.73
  (`registry.jsonl:542`, `registry.jsonl:551`, `registry.jsonl:555`).
- Question-level failures return `null` and are dropped (`cli.ts:550-565`).
- Stats average surviving rows only (`stats.ts:92-114`).
- Cat5 is excluded from LLM judge because LLM judge is skipped for category 5
  (`cli.ts:641-645`), and overall LLM averages only non-null scores
  (`stats.ts:92`, `stats.ts:110-112`).
- The benchmark adds context and answer aids: source-turn rendering
  (`retrieve.ts:245-262`), answer-time annotations (`retrieve.ts:155-160`),
  temporal/location normalization (`llm.ts:58-72`), and detailed mem0 speaker
  answer prompt (`llm.ts:137-171`).

Conclusion:

Overall LLM micro currently reflects a combined system: extraction/storage,
server retrieval/ranking, benchmark context assembly, answer-model behavior, judge
behavior, provider failures, cache lineage, and row denominator. It should not be
treated as a precise direct measure of memory quality.

## Pipeline Bottlenecks

| Rank | Hypothesis | Stage | Evidence | Counter-evidence | Confidence |
|---:|---|---|---|---|---|
| 1 | Cross-speaker duplicate/polluted context is suppressing mem0-style answer quality. | Prompt assembly / retrieval presentation | mem0-style retrieves both speaker scopes and concatenates them (`retrieve.ts:81-123`); speaker ingest stores the conversation per speaker role mapping (`ingest.ts:137-162`); algorithm audit found exact duplicate retrieved content in 1932/1985 latest questions. | Duplicates also appear in many passing rows, so duplication is not sufficient by itself. | High |
| 2 | Evidence absence from final retrieval remains the largest raw failure class. | Retrieval / storage | Algorithm audit split latest failures as 247 no-evidence, 131 partial, 199 full-evidence; baseline Cat1 ER 45.5 and Cat4 ER 80.5 (`BASELINE.md:81-85`). | ER0 means not retrieved, not necessarily not stored. | High |
| 3 | Full-evidence failures are prompt pollution plus answer synthesis. | Prompt assembly / answer generation | 199 failed rows have full evidence; benchmark prompt/normalization heavily shapes answers (`llm.ts:137-171`, `llm.ts:58-72`). | Some ER=1 evidence may be buried under noisy duplicate context. | High |
| 4 | ADD-only reconciliation leaves stale/duplicate/conflicting memory pressure. | Extraction / reconciliation | Reconcile is explicitly ADD-only and never archives/updates/deletes (`ingest.go:1394-1398`); near-duplicate search is shadow-only unless enabled (`ingest.go:1419-1424`). | Local mem0 reference also gates candidates semantically and does not prove full lifecycle is needed. | Medium |
| 5 | Keyword/entity scoring cannot rescue vector-missed lexical evidence. | Retrieval candidate admission | mem9 ranker scores semantic candidates plus BM25/entity (`memory.go:452-485`); mem0 scoring also thresholds semantic candidates before combining (`mem0/utils/scoring.py:60-75`, `:101-110`). | Broad keyword admission variants have already failed product validation. | Medium |

## What Not To Try Again

| Approach | Why attempted | Result | Why likely failed | Evidence | Recommendation |
|---|---|---|---|---|---|
| Broad keyword-only / BM25 admission | Rescue exact lexical evidence missed by vector recall | Cached gains, product regression | Added noisy candidates globally; local slice did not transfer | `keyword_only_bm25_admission_product_revert_20260509T101122Z_495.md:10`, `:47` | Abandon direct variants; retry only with a different bounded mechanism and clean controls. |
| Entity-confirmed keyword admission v1 | Safer BM25 admission with entity confirmation | Cached net +8, product 66.84/66.67 | Same failure mode as keyword-only; product Cat2/Cat4/mixed risk | `entity_confirmed_keyword_product_revert_20260510T082906Z_545.md:26`, `entity_confirmed_keyword_product_revert_20260510T164239Z_548.md:14` | Abandon threshold/cap variants. |
| Small exact predicate / kind/type / answer-shape selectors | Move narrow Cat4 misses cheaply | Moved 1-7 rows, often below gate | Too small or too query-shaped | `registry.jsonl:544`, `registry.jsonl:546`, `registry.jsonl:556` | Delay; use only as diagnostics. |
| Cat1 second-hop/source packet broad retrieval | Improve multi-hop/list bridge | Cached full regression or high risk | More context noise than bridge gain | `cat1_multihop_second_hop_retrieve_reject_20260510T161808Z_548.md:9`, `registry.jsonl:492` | Retry only after cross-scope/context dedupe and risk proof. |
| Temporal/source-tail/scoring token boosts | Repair temporal and source failures | Mostly 0-5 moved rows | Repeated shape-level tuning without enough safe movement | `source_turn_question_neighbor_preflight_reject_20260509T180336Z_530.md:43`, `source_tail_scoring_isolation_preflight_reject_20260509T1851Z_534.md:45` | Abandon broad boosts; use exact provenance binding only. |
| Benchmark-side answer repair as strategy | Improve LLM/F1 output | Some older narrow keeps, broad attempts regressed | Optimizes evaluator rather than memory architecture | `llm.ts:58-72`, `llm.ts:137-171` | Only protocol/baseline changes with clean controls; not strategy. |

## Recovery Principles

Before any new optimization:

1. Close current dirty state.
2. Invalidate or rebuild any cache produced by reverted candidates.
3. Establish control variance with multiple clean product-path controls and multiple
   same-cache controls.
4. Use pairwise row-level net movement and fixed denominators, not single-run
   Overall LLM alone.
5. Separate pipeline-stage measurements: storage/extraction, candidate recall,
   ranking, context assembly, answer synthesis, judge.

## Approval Gate

No code, benchmark, harness, prompt, config, or scoring change is approved by this
retrospective. The next step requires explicit user approval of one recovery
experiment from `docs/mem9_harness_next_5_experiments.md`.
