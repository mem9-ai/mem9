export MNEMO_LLM_MODEL="qwen3.6-flash"
export OPENAI_JUDGE_MODEL="qwen3.6-plus"
export OPENAI_CHAT_MODEL="qwen3.6-plus"

── Results ──────────────────────────────────
Overall F1 (micro): 61.36%  (n=1986)
Overall F1 (macro): 53.40%
Overall LLM (micro): 63.77%  (n=1540)
Overall LLM (macro): 54.77%
Overall Evidence Recall: 55.39%

  Cat 1 (multi-hop   ):  F1=25.49%  LLM=34.40%  ER=29.5%  (n=282  llm_n=282)
  Cat 2 (single-hop  ):  F1=64.47%  LLM=74.77%  ER=72.1%  (n=321  llm_n=321)
  Cat 3 (temporal    ):  F1=22.95%  LLM=37.50%  ER=23.5%  (n=96  llm_n=96)
  Cat 4 (open-domain ):  F1=58.36%  LLM=72.41%  ER=65.2%  (n=841  llm_n=841)
  Cat 5 (adversarial ):  F1=95.74%  LLM=N/A  ER=47.8%  (n=446)
──────────────────────────────────────────────
