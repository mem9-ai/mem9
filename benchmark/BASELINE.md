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
/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-03T21-33-59-472Z_mem9-current.json

── Results ──────────────────────────────────
Overall F1 (micro): 62.34%  (n=1986)
Overall F1 (macro): 54.68%
Overall LLM (micro): 65.26%  (n=1540)
Overall LLM (macro): 57.16%
Overall Evidence Recall: 67.51%

  Cat 1 (multi-hop   ):  F1=26.34%  LLM=37.23%  ER=44.4%  (n=282  llm_n=282)
  Cat 2 (temporal    ):  F1=69.90%  LLM=79.75%  ER=83.2%  (n=321  llm_n=321)
  Cat 3 (open-domain ):  F1=23.28%  LLM=39.58%  ER=46.2%  (n=96  llm_n=96)
  Cat 4 (single-hop  ):  F1=58.39%  LLM=72.06%  ER=75.2%  (n=841  llm_n=841)
  Cat 5 (adversarial ):  F1=95.52%  LLM=N/A  ER=60.7%  (n=446)
──────────────────────────────────────────────

Delta versus effective average baseline:

- Overall LLM (micro): +0.61pp
- Overall F1 (micro): +0.69pp
- Overall Evidence Recall: +0.74pp
- Cat 2 LLM: +4.36pp
- Cat 3 LLM: +3.13pp
- Cat 1 LLM: -0.30pp
- Cat 4 LLM: -0.80pp
