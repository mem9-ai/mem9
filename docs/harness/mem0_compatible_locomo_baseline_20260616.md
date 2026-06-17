# Mem0-Compatible LoCoMo Baseline - 2026-06-16

## Run

- Accepted run date: `2026-06-16`
- Benchmark source: `mem9-benchmark` PR #16 (`--benchmark-preset mem0`)
- Answer model: `qwen3.6-plus`
- Judge model: `qwen3.6-plus`
- mem9 ingest model: `qwen3.6-flash`
- Scope: LoCoMo categories 1-4
- Retrieval limit: 200
- Context format: chronological Mem0-compatible retrieved context

Both corrected runs completed cleanly with `1,540/1,540` rows. The benchmark logs had no `fetch failed`, sample-level failure, `DataInspectionFailed`, or network-disconnect matches.

## Outcome

The accepted headline is the average of the two corrected clean runs.

| Metric | Run 1 | Run 2 | Average |
| --- | ---: | ---: | ---: |
| Overall F1 micro | 43.84% | 43.48% | 43.66% |
| Overall F1 macro | 36.71% | 36.62% | 36.66% |
| Overall LLM micro | 87.08% | 86.62% | 86.85% |
| Overall LLM macro | 81.83% | 81.52% | 81.68% |
| Overall Evidence Recall | 81.66% | 81.21% | 81.43% |

## Category Average

| Category | F1 | LLM | Evidence Recall |
| --- | ---: | ---: | ---: |
| Cat 1 multi-hop | 17.93% | 83.16% | 59.8% |
| Cat 2 temporal | 50.36% | 89.25% | 90.7% |
| Cat 3 open-domain | 26.70% | 64.58% | 56.3% |
| Cat 4 single-hop | 51.66% | 89.71% | 87.9% |

## Boundary

Earlier PR #16 full runs used `qwen3.6-flash` as the answer and judge model by mistake. Those runs are retained only as historical artifacts and are not part of this accepted baseline.

This result follows the Mem0-compatible LoCoMo benchmark protocol from `mem9-benchmark` PR #16. It is not a claim that the older in-repo `benchmark/locomo` harness has the same runner surface; that harness predates the `--benchmark-preset mem0` configuration and still reflects the older local benchmark shape.

## Follow-Up

Future benchmark runs, runner config, and artifact metadata should explicitly pin the answer model to `qwen3.6-plus` and write the judge model separately, unless @okJiang specifies another model.
