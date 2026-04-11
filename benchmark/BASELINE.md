── Timings ─────────────────────────────────
wall_clock_ms: 6927439
provision_total_ms: 653072
ingest_total_ms: 19940758
evaluation_total_ms: 3245865
retrieval_total_ms: 10071957
llm_total_ms: 2822374
──────────────────────────────────────────────

── Results ──────────────────────────────────
Overall F1 (micro): 57.93%  (n=1986)
Overall F1 (macro): 50.29%
Overall LLM (micro): 70.45%  (n=1540)
Overall LLM (macro): 63.60%
Overall Evidence Recall: 48.59%

  Cat 1 (multi-hop   ):  F1=20.26%  LLM=47.16%  ER=18.7%  (n=282  llm_n=282)
  Cat 2 (single-hop  ):  F1=65.30%  LLM=81.93%  ER=65.5%  (n=321  llm_n=321)
  Cat 3 (temporal    ):  F1=17.76%  LLM=48.96%  ER=14.6%  (n=96  llm_n=96)
  Cat 4 (open-domain ):  F1=52.16%  LLM=76.34%  ER=53.9%  (n=841  llm_n=841)
  Cat 5 (adversarial ):  F1=95.96%  LLM=N/A  ER=52.2%  (n=446)
──────────────────────────────────────────────