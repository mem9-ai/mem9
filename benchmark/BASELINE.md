export MNEMO_LLM_MODEL="qwen3.6-flash"
export OPENAI_JUDGE_MODEL="qwen3.6-plus"
export OPENAI_CHAT_MODEL="qwen3.6-plus"

── Results ──────────────────────────────────
Overall F1 (micro): 61.70%  (n=1986)
Overall F1 (macro): 53.66%
Overall LLM (micro): 66.43%  (n=1540)
Overall LLM (macro): 58.23%
Overall Evidence Recall: 67.15%

  Cat 1 (multi-hop   ):  F1=26.33%  LLM=39.01%  ER=42.8%  (n=282  llm_n=282)
  Cat 2 (temporal    ):  F1=66.06%  LLM=81.31%  ER=83.4%  (n=321  llm_n=321)
  Cat 3 (open-domain ):  F1=21.75%  LLM=39.58%  ER=42.0%  (n=96  llm_n=96)
  Cat 4 (single-hop  ):  F1=58.41%  LLM=73.01%  ER=76.0%  (n=841  llm_n=841)
  Cat 5 (adversarial ):  F1=95.74%  LLM=N/A  ER=59.4%  (n=446)
──────────────────────────────────────────────
