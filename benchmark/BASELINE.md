export MNEMO_LLM_MODEL="qwen3.6-flash"
export OPENAI_JUDGE_MODEL="gpt-4o"
export OPENAI_CHAT_MODEL="gpt-4o"

── Results ──────────────────────────────────
Overall F1 (micro): 58.14%  (n=1968)
Overall F1 (macro): 49.99%
Overall LLM (micro): 57.57%  (n=1525)
Overall LLM (macro): 47.93%
Overall Evidence Recall: 53.54%

  Cat 1 (multi-hop   ):  F1=22.04%  LLM=24.91%  ER=24.7%  (n=277  llm_n=277)
  Cat 2 (single-hop  ):  F1=62.25%  LLM=74.05%  ER=65.8%  (n=316  llm_n=316)
  Cat 3 (temporal    ):  F1=16.68%  LLM=27.08%  ER=19.1%  (n=96  llm_n=96)
  Cat 4 (open-domain ):  F1=53.51%  LLM=65.67%  ER=60.6%  (n=836  llm_n=836)
  Cat 5 (adversarial ):  F1=95.49%  LLM=N/A  ER=56.7%  (n=443)
──────────────────────────────────────────────