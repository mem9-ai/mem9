```bash
export MNEMO_LLM_MODEL="qwen3.6-flash"
export OPENAI_CHAT_MODEL="qwen3.6-plus"
export OPENAI_JUDGE_MODEL="qwen3.6-plus"
```

```text
── Results (2-run average) ──────────────────
Overall F1 (micro): 43.66%  (n=1540 per run)
Overall F1 (macro): 36.66%
Overall LLM (micro): 86.85%  (n=1540 per run)
Overall LLM (macro): 81.68%
Overall Evidence Recall: 81.43%

  Cat 1 (multi-hop   ):  F1=17.93%  LLM=83.16%  ER=59.8%  (n=282  llm_n=282)
  Cat 2 (temporal    ):  F1=50.36%  LLM=89.25%  ER=90.7%  (n=321  llm_n=321)
  Cat 3 (open-domain ):  F1=26.70%  LLM=64.58%  ER=56.3%  (n=96   llm_n=96)
  Cat 4 (single-hop  ):  F1=51.66%  LLM=89.71%  ER=87.9%  (n=841  llm_n=841)
──────────────────────────────────────────────
```
