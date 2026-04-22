export MNEMO_LLM_MODEL="qwen3.6-flash"
export OPENAI_JUDGE_MODEL="qwen3.6-plus"
export OPENAI_CHAT_MODEL="qwen3.6-plus"

── Results ──────────────────────────────────
Overall F1 (micro): 60.98%  (n=1986)
Overall F1 (macro): 53.72%
Overall LLM (micro): 62.14%  (n=1540)
Overall LLM (macro): 53.81%
Overall Evidence Recall: 55.10%

  Cat 1 (multi-hop   ):  F1=24.90%  LLM=34.75%  ER=26.8%  (n=282  llm_n=282)
  Cat 2 (single-hop  ):  F1=66.88%  LLM=74.45%  ER=68.0%  (n=321  llm_n=321)
  Cat 3 (temporal    ):  F1=24.39%  LLM=36.46%  ER=20.8%  (n=96  llm_n=96)
  Cat 4 (open-domain ):  F1=56.46%  LLM=69.56%  ER=62.9%  (n=841  llm_n=841)
  Cat 5 (adversarial ):  F1=95.96%  LLM=N/A  ER=56.1%  (n=446)
──────────────────────────────────────────────
