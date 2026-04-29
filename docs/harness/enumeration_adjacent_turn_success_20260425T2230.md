# Enumeration Adjacent Turn Success - 2026-04-25 22:30

## Verdict

Success under the updated harness rule. The success threshold is now baseline +0.8pp.

- Previous baseline Overall LLM micro: 65.43%.
- Success threshold: 66.23%.
- Accepted result: 66.28%.
- Delta: +0.85pp.

The accepted result is from `/Users/bosn/git/mem9-benchmark/locomo/results/2026-04-24T12-15-53-354Z.json`. After the failed subject-speaker guard round, the code was rolled back to this same server-only enum-adjacent state, then local tests and build passed.

## Server Change

Changed `/Users/bosn/git/mem9/server/internal/handler/recall.go` so enumeration-shaped recall uses the existing normal server adjacent-turn expansion:

- `EnableAdjacentTurns = true`.
- `AdjacentTurnRadius = 1`.
- `AdjacentTurnTopN = 12`.
- Existing enumeration fetch multiplier and second-hop settings remain active.

Added `/Users/bosn/git/mem9/server/internal/handler/recall_test.go` coverage to ensure enumeration candidate options expand adjacent turns.

This is a production server recall-path improvement. Any client calling the normal mem9 server recall/search path benefits; the benchmark is not acting as a strategy layer.

## Benchmark Boundary

No `mem9-benchmark` code was changed for this accepted optimization.

The benchmark remained a thin client:

- No benchmark-side recall.
- No benchmark-side rerank.
- No benchmark-side query classification.
- No benchmark-side LoCoMo answer repair.

## Metrics

| Metric | Previous baseline | Accepted |
| --- | ---: | ---: |
| Overall F1 micro | 61.61% | 62.30% |
| Overall LLM micro | 65.43% | 66.28% |
| Overall Evidence Recall | 67.59% | 68.19% |
| Cat 1 LLM | 36.65% | 37.01% |
| Cat 2 LLM | 76.32% | 80.37% |
| Cat 3 LLM | 39.58% | 36.46% |
| Cat 4 LLM | 73.84% | 74.08% |

The strongest gain is Cat 2 single-hop, where adjacent source turns recover answer-bearing turns near initially matched turns.

## Risk / Follow-Up

The main known downside is Cat 3 temporal regression. Adjacent expansion can add nearby but temporally competing context. Future optimization should not broaden recall or reweight common date tokens across categories. It should target temporal precision narrowly, preferably only when the query shape is already time/duration/frequency.

The immediately following subject-speaker uppercase guard failed at 64.09% and was rolled back. That failure is archived in `/Users/bosn/Documents/Dev/harness/learns/subject_speaker_guard_global_regression_20260425T222934.md`.
