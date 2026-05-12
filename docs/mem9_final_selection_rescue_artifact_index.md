# mem9 Final-Selection Provenance Rescue Artifact Index

Date: 2026-05-12

This index records the artifacts needed to review the incubating final-selection provenance rescue experiment.

## Primary Documents

| Artifact | Path | Purpose | Required for future review? | Archive later? |
| --- | --- | --- | --- | --- |
| Retrieval/ranking diagnostic plan | `docs/mem9_retrieval_ranking_diagnostic_plan.md` | Defines the evidence-backed mechanism and constraints. | Yes | Yes, after final decision. |
| Offline replay report | `docs/mem9_final_selection_rescue_replay.md` | Shows replay passed with `42` safe target gains and `0` target-gold regressions. | Yes | Yes, after final decision. |
| Implementation report | `docs/mem9_final_selection_rescue_implementation.md` | Records implementation scope, guardrails, tests, and rollback. | Yes | Yes, after final decision. |
| Predict-only result | `docs/mem9_final_selection_rescue_predict_only_result.md` | Shows same-cache evidence movement before full benchmark. | Yes | Yes, after final decision. |
| Full benchmark result | `docs/mem9_final_selection_rescue_full_benchmark_result.md` | Records the one approved full LoCoMo result and INCUBATE decision. | Yes | Yes, after final decision. |
| Incubate analysis | `docs/mem9_final_selection_rescue_incubate_analysis.md` | Analyzes regressions and rejects guardrail tuning for now. | Yes | Yes, after final decision. |
| Incubate record | `docs/mem9_final_selection_rescue_incubate_record.md` | Final closeout record for current state. | Yes | Yes, after final decision. |
| Experiment matrix | `docs/mem9_harness_experiment_matrix.md` | Tracks this experiment among post-retrospective candidates. | Yes | No, keep with harness docs. |

## Benchmark Artifacts

| Artifact | Path | Purpose | Required for future review? | Archive later? |
| --- | --- | --- | --- | --- |
| Full benchmark result JSON | `/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-12T02-04-40-552Z_mem0-style.json` | Primary row-level full result. | Yes | Yes, after copying to long-term diagnostics if needed. |
| Full benchmark unified JSON | `/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-12T02-04-40-552Z_mem0-style.unified.json` | Unified benchmark output with generation/judgment fields. | Yes | Yes, after copying to long-term diagnostics if needed. |
| Full benchmark log | `/home/ec2-user/locomo-logs/20260512T020421/locomo.log` | Run settings, progress, provider failures, final metrics. | Yes | Yes. |
| Server log | `/home/ec2-user/locomo-logs/20260512T020421/mem9-server.log` | Server behavior during full benchmark. | Useful | Yes. |
| TiDB log | `/home/ec2-user/locomo-logs/20260512T020421/tiup.log` | Backend runtime log. | Optional | Yes. |
| Cache/backend manifest | `/home/ec2-user/locomo-logs/20260512T020421/cache-backend-manifest.json` | Fresh cache lineage and active memory count. | Yes | Yes. |

## Baseline / Control Artifacts

| Artifact | Path | Purpose | Required for future review? | Archive later? |
| --- | --- | --- | --- | --- |
| Active baseline result JSON | `/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-10T02-50-01-542Z_mem0-style.json` | Baseline comparison for full result. | Yes | Yes, only after a newer accepted baseline is documented. |
| Active baseline unified JSON | `/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-10T02-50-01-542Z_mem0-style.unified.json` | Baseline row-level generation/judgment comparison. | Yes | Yes, only after a newer accepted baseline is documented. |
| Accepted clean trace directory | `/home/ec2-user/Documents/Dev/harness/diagnostics/20260511T062806Z-er0-trace` | Source of ER0 attribution, replay inputs, and accepted clean cache. | Yes | No until experiment family is closed. |
| Candidate predict-only directory | `/home/ec2-user/Documents/Dev/harness/diagnostics/20260512T011857Z-final-selection-rescue-predict-only` | Candidate same-cache predict-only validation artifacts. | Yes | No until experiment family is closed. |

## Replay / Predict-Only JSONs

| Artifact | Path | Purpose | Required for future review? | Archive later? |
| --- | --- | --- | --- | --- |
| Replay rows JSON | `/home/ec2-user/Documents/Dev/harness/diagnostics/20260511T062806Z-er0-trace/exports/final_selection_rescue_replay_rows.json` | Row/move-level offline replay evidence. | Yes | Yes, after final decision. |
| Predict-only summary JSON | `/home/ec2-user/Documents/Dev/harness/diagnostics/20260512T011857Z-final-selection-rescue-predict-only/exports/final_selection_rescue_predict_only_summary.json` | Aggregate predict-only movement and schema checks. | Yes | Yes, after final decision. |
| Predict-only target movement JSON | `/home/ec2-user/Documents/Dev/harness/diagnostics/20260512T011857Z-final-selection-rescue-predict-only/exports/final_selection_rescue_target_movement_rows.json` | 161-record target evidence movement. | Yes | Yes, after final decision. |
| Predict-only non-target movement JSON | `/home/ec2-user/Documents/Dev/harness/diagnostics/20260512T011857Z-final-selection-rescue-predict-only/exports/final_selection_rescue_non_target_movement_rows.json` | Non-target evidence movement. | Yes | Yes, after final decision. |

## Cleanup Recommendation Only

No cleanup was executed in this closeout step.

1. `server/internal/handler/recall_trace.go` should remain untracked only while active diagnostics may need it. Before production promotion, either remove it or commit it separately as diagnostic tooling. It should not be bundled silently into a production performance PR.
2. Trace hooks in `server/internal/handler/recall.go` should be removed before production promotion unless trace tooling is explicitly approved as part of the product branch. They are default-off, but they are not part of the minimal performance candidate.
3. The docs should be committed with the incubate branch or archived in a dedicated evidence commit. They are the audit trail for why the candidate is incubated rather than kept or reverted.
4. Minimal incubate candidate diff:
   - `server/internal/handler/recall.go`
   - `server/internal/handler/recall_test.go`
5. Diagnostic-only files:
   - `server/internal/handler/recall_trace.go`
   - trace hook call sites in `server/internal/handler/recall.go`
   - diagnostic directories under `/home/ec2-user/Documents/Dev/harness/diagnostics/`
6. Exclude from a future production PR unless separately approved:
   - `server/internal/handler/recall_trace.go`
   - trace hook call sites
   - large generated benchmark JSON/log artifacts
   - any benchmark, scoring, prompt, harness, ingestion, storage, or reconciliation changes
