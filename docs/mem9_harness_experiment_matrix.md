# mem9 LoCoMo Experiment Matrix

Date: 2026-05-10

This matrix is a plan only. Do not execute any experiment until the user approves
it explicitly.

## Preconditions For Any Experiment

| Gate | Required condition | Evidence / Rationale |
|---|---|---|
| Dirty state closed | `mem9`, `mem9-benchmark`, and `clawd` score-affecting files must be clean or explicitly declared as the candidate under test. | Current dirty files include `server/internal/handler/recall.go`, `locomo/src/registry.ts`, and harness files. Final harness state flags `server/internal/handler/recall.go` as score-sensitive dirty (`mem9_locomo_harness_state.json:46-50`, `:77-79`). |
| Cache lineage clean | Do not use the current `last-ingest-cache` unless producer lineage proves clean no-change code. | Harness policy invalidates reverted-candidate caches (`harness.md:57`, `harness.md:65`); current cache was created at `2026-05-10T16:42:56.710Z` (`last-ingest-cache.json:7`). |
| Control variance measured | Use at least 3 clean product-path controls and at least 3 same-cache controls for retrieval-only work. | Recent controls vary by about 1.9pp, larger than the former +0.3pp gate; formal keep is now +1.0pp or net +15, with +0.30pp..+0.99pp incubate only (`registry.jsonl:542`, `:551`, `:555`). |
| Fixed denominator | Expected LoCoMo row count is 1,986; any missing rows must be listed with score impact. | Question failures are dropped (`cli.ts:550-565`), stats average surviving rows (`stats.ts:92-114`). |
| Stage ownership | Each experiment must test exactly one stage: extraction, reconciliation, retrieval, ranking, prompt assembly, or answer generation. | Previous local-slice wins failed globally due mixed-stage effects. |

## Candidate Matrix

| # | Experiment | Hypothesis Tested | Stage | Exact Scope | Files Likely Changed | Benchmark Command | Expected Movement | Success Criteria | Failure Criteria | Rollback | Overfitting Risk | Approval |
|---:|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Cross-speaker context dedupe trace and server-side equivalent | Duplicate/polluted cross-speaker context is a top mem0-style bottleneck. | Prompt assembly / selection | First build read-only row-level trace proving duplicate removal would improve >=8 judged rows with <=4 risks; only then implement a product-safe server-side equivalent if possible. | Likely `server/internal/handler/recall.go`, `server/internal/service/memory.go`; no benchmark scoring changes. | Cached trace first; full command only after gate: `USING_LAST_INGEST=true bash /home/ec2-user/git/clawd/disc/scripts/locomo.sh` | Incubate at Overall +0.30pp..+0.99pp or pairwise net +5..+14; keep at +1.0pp or net +15. | Same-cache candidate beats mean clean same-cache control and reaches keep gate, or enters one bounded incubate refinement with structured pairwise evidence. | Movement <8, risk >4, or any Cat2/Cat4/mixed severe regression. | Revert server changes; discard candidate cache/control if produced. | Medium: dedupe can erase useful speaker-specific context. | Required before implementation and benchmark. |
| 2 | Source-linked child answer artifacts gated by parent retrieval | Short-answer facts should expand only when their source/parent memory is already selected, improving Cat4 ER0/ER1 without global fact noise. | Extraction / storage / context fidelity | Add child artifacts linked to source provenance but keep them non-top-level unless parent/source is retrieved. | `server/internal/service/ingest.go`, source provenance files, focused tests. | Fresh product-path: `bash /home/ec2-user/git/clawd/disc/scripts/locomo.sh` | Keep at Overall +1.0pp or net +15; incubate at +0.30pp..+0.99pp with Cat4 evidence recall stable or up. | Overall >= active gate and no Cat2/Cat3/mixed regression. | Memory count rises without row-level target gain; Cat4 noise or mixed regression. | Revert touched server files; discard produced cache/backend; rebuild clean control. | Medium-high: may encode benchmark short-answer shape. | Required. |
| 3 | Update/dedup-aware ingest with source-seq preservation | ADD-only exact-hash dedupe creates stale, duplicate, and conflicting facts that hurt current-state/list questions. | Reconciliation / extraction | Introduce narrow update/dedup behavior only when source-seq/entity/predicate match proves same fact slot. | `server/internal/service/ingest.go`, `fact_profile.go`, source provenance tests. | Fresh product-path: `bash /home/ec2-user/git/clawd/disc/scripts/locomo.sh` | Keep at Cat1-backed Overall +1.0pp or net +15; incubate at +0.30pp..+0.99pp with duplicate prompt count down. | Overall >= gate; duplicate/conflict diagnostics improve. | Fact-volume-only increase, Cat4/mixed regression, or stale fact still selected. | Revert ingest/reconcile changes; rebuild product control. | High: lifecycle mistakes can delete useful facts. | Required. |
| 4 | Exact source observation-date binding | Temporal ER1 failures come from selecting wrong nearby dates despite evidence being present. | Source provenance / ranking | Bind answer-time/date metadata to exact source observation, not broad date token boosts. | `server/internal/service/temporal_fact.go`, `ingest.go`, `fact_profile.go`, possibly `recall.go`. | Fresh product-path if ingest changes; cached only if ranking-only. | Cat2 +1.0pp; Overall +0.30pp..+0.99pp can incubate, but formal keep needs +1.0pp or net +15. | Cat2 improves, Overall non-regresses; valid incubate allowed at +0.30pp without other bucket loss. | Broad temporal bias, Cat4 regression, or moved rows <8. | Revert temporal/source files; rebuild control if cache changed. | Medium: date-shaped benchmark overfit. | Required. |
| 5 | ER0 storage-vs-retrieval attribution study before code | Determine whether ER0 rows are missing from storage or only missing from final top20. | Measurement / diagnosis | No code change; fixed sample of latest ER0 Cat1/Cat4 failures, inspect stored memories and candidate pools. | None initially. Later scope depends on result. | No full benchmark. Use read-only trace/query scripts only. | Produces classification of >=50 ER0 rows and identifies one mechanism with >=8 safe target rows. | >=8 rows share one production-legitimate bottleneck with <=4 risk rows. | Heterogeneous failures with no shared mechanism. | No code rollback needed. | Low. | Required to proceed to any ER0 retrieval/storage experiment. |

## Measurements To Record For Every Future Experiment

| Measurement | Why |
|---|---|
| Product control min/mean/max | Current no-change variance exceeded the former +0.3pp gate and must still be measured against the stricter +1.0pp/net +15 gate. |
| Same-cache control min/mean/max | Cached strategy comparison needs variance bounds. |
| Pairwise LLM net wins/losses | Avoid single aggregate noise. |
| Category LLM and ER | Cat2/Cat4 regressions repeatedly killed local wins. |
| Evidence speaker bucket metrics | Mixed-speaker is weak and can be hidden by aggregate. |
| Failed row denominator | Dropped rows change micro score. |
| Cache producer lineage | Avoid reverted-candidate cache contamination. |
| Retrieved context duplicate count | Cross-speaker duplicate pollution is a leading bottleneck. |

## Abandoned Or Delayed Directions

| Direction | Disposition | Evidence |
|---|---|---|
| Direct keyword/BM25 admission variants | Abandon | Product reverts at `keyword_only_bm25_admission_product_revert_20260509T101122Z_495.md` and entity reverts at `entity_confirmed_keyword_product_revert_20260510T082906Z_545.md`. |
| Entity-confirmed keyword admission v1 | Abandon exact fingerprint and threshold/cap variants | Cached evidence did not survive product validation (`registry.jsonl:549-553`). |
| Kind/type or exact predicate small selectors | Delay | Moved rows below gate (`registry.jsonl:544`, `:546`, `:556`). |
| Broad source-packet/source-tail scoring | Delay until context dedupe and risk proof | Repeated 0-5 moved rows and high risk (`registry.jsonl:532-538`). |
| Broad Cat1 second-hop/list expansion | Retry only after risk isolation | Second-hop full cached run regressed; prior Cat1 traces had high risk (`cat1_multihop_second_hop_retrieve_reject_20260510T161808Z_548.md`, `registry.jsonl:492`). |

## Approval Gate

This matrix is not permission to run. The user must explicitly approve one
experiment and its validation lane before implementation or benchmark execution.
