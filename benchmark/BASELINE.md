export MNEMO_LLM_MODEL="qwen3.6-flash"
export OPENAI_JUDGE_MODEL="qwen3.6-plus"
export OPENAI_CHAT_MODEL="qwen3.6-plus"

── Results ──────────────────────────────────
Overall F1 (micro): 61.36%  (n=1985)
Overall F1 (macro): 52.86%
Overall LLM (micro): 65.04%  (n=1539)
Overall LLM (macro): 55.11%
Overall Evidence Recall: 61.77%

  Cat 1 (multi-hop   ):  F1=25.73%  LLM=37.37%  ER=35.2%  (n=281  llm_n=281)
  Cat 2 (temporal    ):  F1=63.67%  LLM=76.01%  ER=75.7%  (n=321  llm_n=321)
  Cat 3 (open-domain ):  F1=20.82%  LLM=33.33%  ER=36.3%  (n=96  llm_n=96)
  Cat 4 (single-hop  ):  F1=59.25%  LLM=73.72%  ER=70.9%  (n=841  llm_n=841)
  Cat 5 (adversarial ):  F1=94.84%  LLM=N/A  ER=56.5%  (n=446)
──────────────────────────────────────────────