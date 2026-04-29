export MNEMO_LLM_MODEL="qwen3.6-flash"
export OPENAI_JUDGE_MODEL="qwen3.6-plus"
export OPENAI_CHAT_MODEL="qwen3.6-plus"

── Results ──────────────────────────────────
Overall F1 (micro): 62.30%  (n=1985)
Overall F1 (macro): 54.02%
Overall LLM (micro): 66.28%  (n=1539)
Overall LLM (macro): 56.98%
Overall Evidence Recall: 68.19%

  Cat 1 (multi-hop   ):  F1=26.81%  LLM=37.01%  ER=43.1%  (n=281  llm_n=281)
  Cat 2 (single-hop  ):  F1=67.62%  LLM=80.37%  ER=84.9%  (n=321  llm_n=321)
  Cat 3 (temporal    ):  F1=21.12%  LLM=36.46%  ER=41.5%  (n=96  llm_n=96)
  Cat 4 (open-domain ):  F1=59.46%  LLM=74.08%  ER=75.6%  (n=841  llm_n=841)
  Cat 5 (adversarial ):  F1=95.07%  LLM=N/A  ER=63.5%  (n=446)
──────────────────────────────────────────────
