# mem9 Final-Selection Provenance Rescue Full Benchmark Result

Date: 2026-05-12T06:35:35Z

Mode: one approved full LoCoMo benchmark run with LLM judge enabled. No code was changed during or after the run.

## Executive Summary

Recommendation: **INCUBATE**.

The run improved Overall LLM from the active baseline `68.29%` to `68.97%`, a `+0.67pp` movement. This is below the strict `+1.0pp` KEEP gate but inside the `+0.30pp..+0.99pp` INCUBATE band. Pairwise LLM movement over locally matched rows was `+11` net wins, also inside the INCUBATE band.

The target evidence movement remained consistent with predict-only validation: the 161 diagnostic target records had `42` final-context gold dia-id improvements, `118` neutral, `0` regressions, and `1` provider-failed missing row. Target LLM movement was `26` improved, `127` neutral, `7` regressed, `1` missing.

This looks like a real recall/context evidence improvement with incomplete answer-quality conversion. It should not be promoted as KEEP yet.

## Git Diff Summary

Pre-run dirty state in `/home/ec2-user/git/mem9`:

```text
 M server/internal/handler/recall.go
 M server/internal/handler/recall_test.go
?? server/internal/handler/recall_trace.go
```

Diff stat before this result document:

```text
 server/internal/handler/recall.go      | 471 +++++++++++++++++++++++++++++++--
 server/internal/handler/recall_test.go | 170 ++++++++++++
 2 files changed, 618 insertions(+), 23 deletions(-)
```

Dirty file classification:

| File | Classification | Score-affecting? |
| --- | --- | --- |
| `server/internal/handler/recall.go` | candidate implementation plus default-off trace hook calls | Yes for rescue implementation |
| `server/internal/handler/recall_test.go` | focused tests | No runtime effect |
| `server/internal/handler/recall_trace.go` | trace-only diagnostic helper, untracked | No when `MNEMO_RECALL_TRACE_DIR` is unset |

`mem9-benchmark` and `clawd` were clean before the run. No benchmark, prompt, scoring, harness, ingest, storage, or reconciliation files were dirty.

Rollback remains simple: revert the candidate block and helper calls in `server/internal/handler/recall.go`, revert focused tests in `server/internal/handler/recall_test.go`, and remove or keep the default-off trace helper independently.

## Benchmark Command

```bash
env -u MNEMO_RECALL_TRACE_DIR \
  LOCOMO_PROTOCOL=mem0-style \
  LOCOMO_ANSWER_PROMPT=mem0-speaker \
  LOCOMO_SPEAKER_INGEST_MODE=batch2 \
  LOCOMO_SPEAKER_TOP_K=10 \
  MEM9_RETRIEVAL_LIMIT=20 \
  USING_LAST_INGEST=false \
  LOCOMO_PREDICT_ONLY=false \
  LOCOMO_HARNESS_AUTOWRITE=false \
  bash /home/ec2-user/git/clawd/disc/scripts/locomo.sh
```

Run log: `/home/ec2-user/locomo-logs/20260512T020421/locomo.log`

Result artifacts:

| Artifact | Path |
| --- | --- |
| Result JSON | `/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-12T02-04-40-552Z_mem0-style.json` |
| Unified JSON | `/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-12T02-04-40-552Z_mem0-style.unified.json` |
| Cache/backend manifest | `/home/ec2-user/locomo-logs/20260512T020421/cache-backend-manifest.json` |

## Environment

| Setting | Value |
| --- | --- |
| `LOCOMO_PROTOCOL` | `mem0-style` |
| `LOCOMO_ANSWER_PROMPT` | `mem0-speaker` |
| `LOCOMO_SPEAKER_INGEST_MODE` | `batch2` |
| `LOCOMO_SPEAKER_TOP_K` | `10` |
| `MEM9_RETRIEVAL_LIMIT` | `20` |
| `USING_LAST_INGEST` | `false` |
| `LOCOMO_PREDICT_ONLY` | `false` |
| LLM judge | on |
| Model | `qwen3.6-plus` |
| Judge model | `qwen3.6-plus` |
| `MNEMO_RECALL_TRACE_DIR` | unset by `env -u` |

Trace instrumentation was default-off and did not alter the normal API response schema.

## Cache / Backend Lineage

Fresh product-path ingest was used. Suspicious prior cache lineage was not reused.

From `/home/ec2-user/locomo-logs/20260512T020421/cache-backend-manifest.json`:

| Field | Value |
| --- | --- |
| Cache file | `/home/ec2-user/git/mem9-benchmark/locomo/results/last-ingest-cache.json` |
| Cache sha256 | `56ab1f65b9860a99d9bf689dc6150eab1ee9b7f401519e3f17220055c4e95230` |
| Cache created | `2026-05-12T02:04:40.732Z` |
| Cache updated | `2026-05-12T04:22:57.929Z` |
| Sample count | `10` |
| Complete | `true` |
| Active memory count | `7534` |

## Denominator

| Metric | Count |
| --- | ---: |
| Expected rows | 1,986 |
| Completed F1 rows | 1,982 |
| Completed LLM-judged rows | 1,537 |
| Dropped/failed rows | 4 |

Dropped rows were provider `DataInspectionFailed` errors, not harness crashes:

| Displayed row | Local row id |
| --- | --- |
| `conv-30 [73/105]` | `conv-30:72` |
| `conv-30 [77/105]` | `conv-30:76` |
| `conv-30 [86/105]` | `conv-30:85` |
| `conv-47 [137/190]` | `conv-47:136` |

The run completed and wrote final result artifacts. The denominator is usable for incubation, but the four provider-dropped rows should be considered residual noise if this experiment is revisited.

## Overall Metrics

| Metric | Baseline | Candidate | Delta |
| --- | ---: | ---: | ---: |
| Overall LLM micro | 68.29% | 68.97% | +0.67pp |
| Overall F1 micro | 59.19% | 60.12% | +0.94pp |
| Overall Evidence Recall | 71.46% | 75.78% | +4.32pp |
| Overall LLM macro | 62.78% | 62.48% | -0.30pp |
| Overall F1 macro | 53.22% | 53.49% | +0.27pp |

Baseline/product control: `/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-10T02-50-01-542Z_mem0-style.json`.

Same-cache full LLM control: not applicable. This was an approved fresh full benchmark run; same-cache evidence movement was already checked in the predict-only validation lane.

## Category Metrics

| Category | Baseline LLM | Candidate LLM | LLM Delta | Baseline ER | Candidate ER | ER Delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Cat1 | 39.36% | 39.01% | -0.35pp | 45.48% | 46.50% | +1.02pp |
| Cat2 | 81.00% | 80.37% | -0.62pp | 85.51% | 84.92% | -0.60pp |
| Cat3 | 56.25% | 54.17% | -2.08pp | 47.31% | 47.24% | -0.07pp |
| Cat4 | 74.52% | 76.37% | +1.85pp | 80.52% | 85.54% | +5.03pp |
| Cat5 | N/A | N/A | N/A | 65.70% | 75.28% | +9.59pp |

Cat2 regressed slightly. Cat4 improved materially. Cat3 regressed by two judged rows on a smaller denominator (`n=96`), and should be watched before promotion.

## Speaker-Bucket Metrics

| Bucket | Baseline LLM | Candidate LLM | LLM Delta | Baseline ER | Candidate ER | ER Delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `speaker_a_only` | 71.43% | 71.79% | +0.37pp | 74.92% | 79.93% | +5.00pp |
| `speaker_b_only` | 68.41% | 69.65% | +1.23pp | 71.86% | 75.45% | +3.59pp |
| `mixed` | 38.46% | 38.46% | +0.00pp | 32.01% | 37.05% | +5.04pp |
| `unknown_or_no_evidence` | 61.54% | 53.85% | -7.69pp | 12.70% | 14.29% | +1.59pp |

Mixed-speaker LLM did not regress; mixed ER improved. Mixed F1 did regress from 30.72% to 25.87%, so this is not clean enough for KEEP.

## Target 161-Record Movement

The diagnostic target file contains 161 records and 159 unique row ids; `conv-48:25` and `conv-48:58` each appear twice in the diagnostic export. Counts below are record-based to preserve the approved 161-record target set.

| Metric | Improved | Neutral | Regressed | Missing |
| --- | ---: | ---: | ---: | ---: |
| LLM judge | 26 | 127 | 7 | 1 |
| F1 | 50 | 95 | 15 | 1 |
| Evidence recall | 42 | 118 | 0 | 1 |
| Final-context gold dia-id coverage | 42 | 118 | 0 | 1 |

The missing target row was `conv-47:136`, caused by provider `DataInspectionFailed`.

Target LLM movement by category:

| Category | Improved | Neutral | Regressed | Missing |
| --- | ---: | ---: | ---: | ---: |
| Cat1 | 1 | 38 | 3 | 0 |
| Cat4 | 25 | 89 | 4 | 1 |

Target ER/final-context evidence movement by category:

| Category | Improved | Neutral | Regressed | Missing |
| --- | ---: | ---: | ---: | ---: |
| Cat1 | 3 | 39 | 0 | 0 |
| Cat4 | 39 | 79 | 0 | 1 |

Target LLM movement by speaker bucket:

| Speaker bucket | Improved | Neutral | Regressed | Missing |
| --- | ---: | ---: | ---: | ---: |
| `speaker_a_only` | 14 | 55 | 5 | 0 |
| `speaker_b_only` | 12 | 63 | 2 | 1 |
| `mixed` | 0 | 9 | 0 | 0 |

## Non-Target Movement

Non-target row movement, excluding the 161 diagnostic records:

| Metric | Improved | Neutral | Regressed | Missing/Unjudged |
| --- | ---: | ---: | ---: | ---: |
| LLM judge | 69 | 1233 | 77 | 448 |
| F1 | 227 | 1370 | 227 | 3 |
| Evidence recall | 131 | 1604 | 85 | 7 |
| Final-context gold dia-id coverage | 131 | 1604 | 85 | 7 |

Worst non-target LLM regressions are binary judge flips from `1` to `0`; examples include:

| Row | Category | Question |
| --- | ---: | --- |
| `conv-26:106` | 4 | What are the new shoes that Melanie got used for? |
| `conv-26:148` | 4 | What was Melanie's reaction to her children enjoying the Grand Canyon? |
| `conv-26:76` | 1 | When did Melanie go on a hike after the roadtrip? |
| `conv-26:78` | 1 | What items has Melanie bought? |
| `conv-30:43` | 4 | What do the dancers in the photo represent? |

Non-target LLM movement was slightly negative (`69` wins, `77` losses), but it did not dominate the full result because target movement was more positive.

## Pairwise LLM Movement

Pairwise movement is computed over local row ids matched against the active baseline result.

| Set | Wins | Losses | Ties | Missing/Unjudged | Net |
| --- | ---: | ---: | ---: | ---: | ---: |
| All rows | 95 | 84 | 1358 | 449 | +11 |
| Target records, unique ids | 26 | 7 | 125 | 1 | +19 |
| Non-target rows | 69 | 77 | 1233 | 448 | -8 |

## Returned Memory Count / Context Size

Returned memory counts stayed fixed relative to the baseline over matched rows.

| Check | Result |
| --- | --- |
| Rows with increased returned memory count | 0 |
| Rows with decreased returned memory count | 0 |
| Rows with changed returned memory count | 0 |
| Max combined returned memories | 40 |
| Any per-speaker count over 20 | No |
| Any combined count over 40 | No |

The implementation did not expand top-k or context size.

## Regression Check

| Area | Assessment |
| --- | --- |
| Cat2 | Slight LLM and ER regression (`-0.62pp`, `-0.60pp`) |
| Cat4 | Positive movement (`+1.85pp` LLM, `+5.03pp` ER) |
| Mixed speaker | LLM flat, ER positive, F1 negative |
| Target evidence | Strongly positive, no target evidence regressions |
| Non-target LLM | Slightly negative pairwise net |

There is no severe Cat4 or mixed-speaker LLM regression. Cat2/Cat3 and non-target LLM noise prevent a KEEP recommendation.

## Interpretation

Evidence-backed conclusions:

- The rescue mechanism improved final-context source evidence on target rows: `42` target records gained gold dia-id coverage and `0` lost it.
- Overall ER increased by `+4.32pp`, and Cat4 ER increased by `+5.03pp`.
- Overall LLM improved by `+0.67pp`, below the strict KEEP gate.
- Pairwise all-row LLM net was `+11`, also below KEEP but within INCUBATE.
- Returned memory count did not increase.

Hypothesis:

The production-side final-selection provenance rescue is improving context evidence quality, but answer synthesis and non-target judge variance absorb part of the gain. This supports incubation and further diagnostic analysis, not immediate promotion.

## Decision

Final recommendation: **INCUBATE**.

Do not commit or promote as KEEP yet. Do not rerun automatically. A reasonable next gate would be user-approved analysis of the seven target LLM regressions, the Cat2/Cat3 regressions, and whether the target evidence gains are stable under a separate control run.
