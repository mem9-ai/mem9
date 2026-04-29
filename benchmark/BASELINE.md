export MNEMO_LLM_MODEL="qwen3.6-flash"
export OPENAI_JUDGE_MODEL="qwen3.6-plus"
export OPENAI_CHAT_MODEL="qwen3.6-plus"

── Results ──────────────────────────────────
Overall F1 (micro): 62.87%  (n=1986)
Overall F1 (macro): 54.83%
Overall LLM (micro): 66.95%  (n=1540)
Overall LLM (macro): 57.46%
Overall Evidence Recall: 70.06%

  Cat 1 (multi-hop   ):  F1=26.07%  LLM=38.65%  ER=43.0%  (n=282  llm_n=282)
  Cat 2 (single-hop  ):  F1=69.66%  LLM=78.19%  ER=84.5%  (n=321  llm_n=321)
  Cat 3 (temporal    ):  F1=23.65%  LLM=37.50%  ER=41.2%  (n=96  llm_n=96)
  Cat 4 (open-domain ):  F1=60.37%  LLM=75.51%  ER=79.1%  (n=841  llm_n=841)
  Cat 5 (adversarial ):  F1=94.39%  LLM=N/A  ER=65.7%  (n=446)
──────────────────────────────────────────────

Accepted from: /Users/bosn/git/mem9-benchmark/locomo/results/2026-04-29T03-05-38-455Z.json
Log dir: /Users/bosn/locomo-logs/20260429T110526
Acceptance gate: previous baseline Overall LLM micro 66.28% + 0.50pp = 66.78%.
