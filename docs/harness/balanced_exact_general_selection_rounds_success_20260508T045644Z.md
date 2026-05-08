# Balanced Exact/General Selection Rounds Success

Date: 2026-05-08
Lane: product-path

The accepted mem0-style-on-mem9 baseline was promoted from `67.17%` to `67.88%`
Overall LLM micro by increasing `balancedSelectionRounds` in
`server/internal/handler/recall.go` from `2` to `5`.

The candidate had first passed a same-cache retrieval validation as a near miss
in iteration 350. Iteration 351 ran a fresh product-path validation through the
normal mem9 HTTP API with:

- `LOCOMO_PROTOCOL=mem0-style`
- `LOCOMO_ANSWER_PROMPT=mem0-speaker`
- `LOCOMO_SPEAKER_INGEST_MODE=batch2`
- `LOCOMO_SPEAKER_TOP_K=10`
- `MEM9_RETRIEVAL_LIMIT=20`

Result:

- Result JSON: `/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-08T02-49-18-990Z_mem0-style.json`
- Archived result: `/home/ec2-user/Documents/Dev/harness/results/2026-05-08T02-49-18-990Z_mem0-style.json`
- Archived logs: `/home/ec2-user/Documents/Dev/harness/results/20260508T024905`
- Overall LLM micro: `67.88%`
- Overall F1 micro: `59.20%`
- Overall Evidence Recall: `71.78%`

Category LLM movement versus the prior accepted baseline:

- Cat1: `38.30 -> 37.59`
- Cat2: `78.19 -> 79.75`
- Cat3: `52.08 -> 53.13`
- Cat4: `74.37 -> 75.21`

The next active promotion gate is `68.38%` Overall LLM micro.
