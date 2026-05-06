# Product-path limit=20 baseline - 20260505T164958

## Summary

This iteration established the first clean product-path baseline at the active
EC2 harness default, `MEM9_RETRIEVAL_LIMIT=20`.

No mem9 server strategy code was changed. The run used fresh ingest through the
real mem9 API path, `LOCOMO_PROTOCOL=mem9-current`, qwen3.6-flash extraction,
qwen3.6-plus answer generation, and qwen3.6-plus judge.

## Result

- Result JSON: `/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-05T16-49-58-725Z_mem9-current.json`
- Archived result: `/home/ec2-user/Documents/Dev/harness/results/2026-05-05T16-49-58-725Z_mem9-current.json`
- Archived logs: `/home/ec2-user/Documents/Dev/harness/results/20260505T164943`
- Overall LLM micro: 70.32%
- Overall F1 micro: 64.72%
- Overall Evidence Recall: 71.86%

Category results:

- Cat 1: F1 30.00%, LLM 44.33%, ER 49.9%
- Cat 2: F1 71.27%, LLM 80.37%, ER 87.1%
- Cat 3: F1 27.56%, LLM 51.04%, ER 49.7%
- Cat 4: F1 62.26%, LLM 77.41%, ER 81.4%
- Cat 5: F1 94.62%, ER 61.4%

## Decision

Decision: `keep`.

This is not a strategy promotion; it is a baseline lock. The previous accepted
66.69% run used `combined_limit=10`, while the active harness now uses limit=20.
Future product-path promotion decisions should compare against this 70.32%
active-limit baseline, and cached strategy runs must continue to use a same-cache
clean control before fresh promotion.

## Regression Watch

The active-limit shape improves overall recall and LLM score, but the category
profile still points to the same high-value risks:

- Mixed speaker bucket remains weak: LLM 54.43%, ER 38.61%.
- Cat 2 is slightly below the legacy limit=10 run: 80.37% vs 81.31%.
- Context-noise losses remain material: 50 LLM losses with evidence, including
  24 where evidence appears in top 3.

## Next Action

Use this run as the active product-path baseline. For the next strategy iteration,
start from same-cache cached controls for retrieval, ranking, context, or answer
prompt changes, then require a fresh product-path validation against this 70.32%
baseline before any future keep.
