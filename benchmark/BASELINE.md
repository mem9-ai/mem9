export MNEMO_LLM_MODEL="qwen3.6-flash"
export OPENAI_JUDGE_MODEL="qwen3.6-plus"
export OPENAI_CHAT_MODEL="qwen3.6-plus"

── Results ──────────────────────────────────
Overall F1 (micro): 61.61%  (n=1985)
Overall F1 (macro): 53.23%
Overall LLM (micro): 65.43%  (n=1539)
Overall LLM (macro): 56.60%
Overall Evidence Recall: 67.59%

  Cat 1 (multi-hop   ):  F1=25.30%  LLM=36.65%  ER=40.3%  (n=281  llm_n=281)
  Cat 2 (single-hop  ):  F1=65.20%  LLM=76.32%  ER=84.0%  (n=321  llm_n=321)
  Cat 3 (temporal    ):  F1=21.70%  LLM=39.58%  ER=44.9%  (n=96  llm_n=96)
  Cat 4 (open-domain ):  F1=59.55%  LLM=73.84%  ER=76.2%  (n=841  llm_n=841)
  Cat 5 (adversarial ):  F1=94.39%  LLM=N/A  ER=61.4%  (n=446)
──────────────────────────────────────────────