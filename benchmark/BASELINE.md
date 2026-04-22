export MNEMO_LLM_MODEL="qwen3.6-flash"
export OPENAI_JUDGE_MODEL="qwen3.6-plus"
export OPENAI_CHAT_MODEL="qwen3.6-plus"

── Results ──────────────────────────────────
Overall F1 (micro): 59.51%  (n=1986)
Overall F1 (macro): 51.94%
Overall LLM (micro): 59.35%  (n=1540)
Overall LLM (macro): 50.28%
Overall Evidence Recall: 52.93%

  Cat 1 (multi-hop   ):  F1=22.83%  LLM=31.91%  ER=25.1%  (n=282  llm_n=282)
  Cat 2 (single-hop  ):  F1=65.42%  LLM=70.40%  ER=67.4%  (n=321  llm_n=321)
  Cat 3 (temporal    ):  F1=21.20%  LLM=31.25%  ER=18.9%  (n=96  llm_n=96)
  Cat 4 (open-domain ):  F1=54.94%  LLM=67.54%  ER=58.9%  (n=841  llm_n=841)
  Cat 5 (adversarial ):  F1=95.29%  LLM=N/A  ER=55.8%  (n=446)
──────────────────────────────────────────────