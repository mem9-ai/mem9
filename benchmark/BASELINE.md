export MNEMO_LLM_MODEL="qwen3.6-flash"
export OPENAI_JUDGE_MODEL="qwen3.6-plus"
export OPENAI_CHAT_MODEL="qwen3.6-plus"

Baseline policy as of 2026-05-03:

The previous 66.43% baseline predates the current architecture and is no longer
used as the success gate. The effective comparison baseline is the average of
recent valid qwen3.6-plus judge runs after the architecture migration:

- 2026-05-03T19-40-03-607Z_mem9-current.json: LLM 65.65%
- 2026-05-03T20-25-31-307Z_mem9-current.json: LLM 63.77%
- 2026-05-03T20-49-28-479Z_mem9-current.json: LLM 64.42%
- 2026-05-03T21-13-04-934Z_mem9-current.json: LLM 64.78%

Average effective baseline: Overall LLM (micro) 64.65%.

Current accepted run:

Results file:
/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-03T22-24-43-577Z_mem9-current.json

── Results ──────────────────────────────────
Overall F1 (micro): 62.73%  (n=1986)
Overall F1 (macro): 55.73%
Overall LLM (micro): 66.69%  (n=1540)
Overall LLM (macro): 58.63%
Overall Evidence Recall: 67.63%

  Cat 1 (multi-hop   ):  F1=26.28%  LLM=37.94%  ER=43.6%  (n=282  llm_n=282)
  Cat 2 (temporal    ):  F1=71.31%  LLM=81.31%  ER=83.8%  (n=321  llm_n=321)
  Cat 3 (open-domain ):  F1=27.44%  LLM=41.67%  ER=45.1%  (n=96  llm_n=96)
  Cat 4 (single-hop  ):  F1=58.57%  LLM=73.60%  ER=76.2%  (n=841  llm_n=841)
  Cat 5 (adversarial ):  F1=95.07%  LLM=N/A  ER=59.6%  (n=446)
──────────────────────────────────────────────

Delta versus effective average baseline:

- Overall LLM (micro): +2.04pp
- Overall F1 (micro): +1.33pp
- Overall Evidence Recall: +0.86pp
- Cat 2 LLM: +5.92pp
- Cat 3 LLM: +5.22pp
- Cat 1 LLM: +0.41pp
- Cat 4 LLM: +0.74pp

Delta versus previous accepted run
(`/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-03T21-33-59-472Z_mem9-current.json`):

- Overall LLM (micro): +1.43pp
- Overall F1 (micro): +0.40pp
- Overall Evidence Recall: +0.13pp
