# mem9 Final-Selection Provenance Rescue Predict-Only Result

Date: 2026-05-12T01:48:00Z

Mode: approved predict-only trace validation. This is not full LoCoMo benchmark approval, and no LLM judge was run.

## Executive Summary

The minimal production implementation passed the approved predict-only validation lane on the accepted mem0-style cache/backend lineage. The run completed 1,986 rows with `predictOnly:on`, `usingLastIngest:on`, and `llmJudge:off`.

Target movement on the 161 retrieved-but-ranked-too-low rows:

| Metric | Rows |
| --- | ---: |
| Target rows evaluated | 161 |
| Safe target rows improved | 32 |
| Safe target rows neutral | 125 |
| Safe target rows regressed | 0 |
| Risk rows target-neutral | 4 |
| Risk rows target-gold regressions | 0 |

Recommendation: **GO_FOR_FULL_BENCHMARK_APPROVAL**. This is a recommendation to ask for explicit approval before running full LoCoMo with LLM judge; it is not permission to run it.

## Evidence Sources

| Artifact | Path |
| --- | --- |
| Accepted clean baseline predict-only result | `/home/ec2-user/Documents/Dev/harness/diagnostics/20260511T062806Z-er0-trace/results/predict-only.json` |
| Accepted clean cache | `/home/ec2-user/Documents/Dev/harness/diagnostics/20260511T062806Z-er0-trace/cache/clean-ingest-cache.json` |
| Candidate predict-only result | `/home/ec2-user/Documents/Dev/harness/diagnostics/20260512T011857Z-final-selection-rescue-predict-only/results/predict-only.json` |
| Candidate server traces | `/home/ec2-user/Documents/Dev/harness/diagnostics/20260512T011857Z-final-selection-rescue-predict-only/server-traces/` |
| Movement summary JSON | `/home/ec2-user/Documents/Dev/harness/diagnostics/20260512T011857Z-final-selection-rescue-predict-only/exports/final_selection_rescue_predict_only_summary.json` |
| Target movement rows JSON | `/home/ec2-user/Documents/Dev/harness/diagnostics/20260512T011857Z-final-selection-rescue-predict-only/exports/final_selection_rescue_target_movement_rows.json` |
| Non-target movement rows JSON | `/home/ec2-user/Documents/Dev/harness/diagnostics/20260512T011857Z-final-selection-rescue-predict-only/exports/final_selection_rescue_non_target_movement_rows.json` |

## Run Settings

| Setting | Value |
| --- | --- |
| `LOCOMO_PROTOCOL` | `mem0-style` |
| `LOCOMO_ANSWER_PROMPT` | `mem0-speaker` |
| `LOCOMO_SPEAKER_INGEST_MODE` | `batch2` |
| `LOCOMO_SPEAKER_TOP_K` | `10` |
| `MEM9_RETRIEVAL_LIMIT` | `20` |
| `--predict-only` | on |
| `--using-last-ingest` | on |
| LLM judge | off |
| Rows | 1,986 |
| Ingest time | 0 ms |

The candidate run reused the accepted cache created at `2026-05-11T06:28:28.022Z` with the same 10 tenant ids. The restored local TiDB control schema was `mem9_trace_20260511T062806Z`.

## Trace Validation

| Check | Result |
| --- | --- |
| Trace mode | Enabled only on the validation server through `MNEMO_RECALL_TRACE_DIR` |
| Trace files | 3,992 |
| Expected result denominator | 1,986 rows |
| Result schema | unchanged versus accepted predict-only result |
| Retrieved memory item schema | unchanged versus accepted predict-only result |

The trace file count is higher than the simple `2 * 1986 = 3972` speaker-recall expectation because some evaluation queries are issued as traceable augmented recall queries. The result denominator stayed exactly 1,986.

## Target Movement

| Bucket | Improved | Neutral | Regressed |
| --- | ---: | ---: | ---: |
| All 161 targets | 32 | 129 | 0 |
| Safe targets | 32 | 125 | 0 |
| Risk rows | 0 | 4 | 0 |

By category:

| Category | Improved | Neutral | Regressed |
| --- | ---: | ---: | ---: |
| Cat1 | 2 | 40 | 0 |
| Cat4 | 30 | 89 | 0 |

By speaker bucket:

| Speaker bucket | Improved | Neutral | Regressed |
| --- | ---: | ---: | ---: |
| speaker_a_only | 17 | 57 | 0 |
| speaker_b_only | 14 | 64 | 0 |
| mixed | 1 | 8 | 0 |

By ranking subtype:

| Ranking subtype | Improved | Neutral | Regressed |
| --- | ---: | ---: | ---: |
| B. Evidence ranked below final top-k due to score composition | 11 | 39 | 0 |
| C. Evidence memory is suppressed by final selection despite top-10 rank | 13 | 10 | 0 |
| D. Evidence loses to wrong-speaker competitors | 2 | 16 | 0 |
| E. Evidence loses to temporally nearby distractors | 5 | 18 | 0 |
| F. Query terms do not align with stored summary content | 1 | 44 | 0 |
| A. Evidence memory is below selection confidence threshold | 0 | 2 | 0 |

## Non-Target Movement

On rows outside the 161 target set, final-context gold evidence movement was:

| Movement | Rows |
| --- | ---: |
| Improved | 80 |
| Neutral | 1,731 |
| Regressed | 16 |

By category:

| Category | Improved | Neutral | Regressed |
| --- | ---: | ---: | ---: |
| Cat1 | 15 | 219 | 6 |
| Cat2 | 6 | 312 | 3 |
| Cat3 | 3 | 93 | 0 |
| Cat4 | 19 | 703 | 2 |
| Cat5 | 37 | 404 | 5 |

By speaker bucket:

| Speaker bucket | Improved | Neutral | Regressed |
| --- | ---: | ---: | ---: |
| speaker_a_only | 32 | 855 | 8 |
| speaker_b_only | 41 | 802 | 7 |
| mixed | 7 | 66 | 1 |
| unknown_or_no_evidence | 0 | 8 | 0 |

This does not show an obvious non-target category or speaker-bucket regression in predict-only evidence movement. Cat1 has 6 non-target regressions, but also 15 non-target improvements plus 2 target improvements; Cat4 has 2 non-target regressions plus 30 target improvements.

## Returned Count / Context Size

The implementation did not expand returned memory counts relative to the accepted predict-only control.

| Count check | Result |
| --- | --- |
| Rows with increased returned memory count | 0 |
| Rows with changed returned memory count | 1 |
| Changed row | `conv-47:45`, old `(speaker_a=20, speaker_b=20, combined=40)`, new `(speaker_a=20, speaker_b=10, combined=30)` |
| Max old counts | `speaker_a=20`, `speaker_b=20`, `combined=40` |
| Max new counts | `speaker_a=20`, `speaker_b=20`, `combined=40` |

The existing benchmark/server path can return 20 per speaker for some exact/time-shaped calls, but this candidate did not increase that ceiling.

## Interpretation

Evidence:

- The same accepted cache/backend lineage was used.
- The result denominator is complete at 1,986 rows.
- Target gold evidence presence improved on 32 safe rows and regressed on 0 target rows.
- All 4 risk rows remained target-neutral.
- Non-target movement was net positive by final-context gold evidence presence.
- API/result schemas were unchanged.

Hypothesis:

The approved final-selection provenance rescue is doing what it was designed to do: rescue source-provenance-bearing evidence already present in the ranked candidate pool, without widening retrieval, changing storage, changing prompts, or expanding result size.

## Next Gate

Ask the user for explicit full benchmark approval. Do not run full LoCoMo or LLM judge until approved.

Final recommendation: **GO_FOR_FULL_BENCHMARK_APPROVAL**.
