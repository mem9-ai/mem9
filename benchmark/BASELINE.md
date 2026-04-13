── Timings ─────────────────────────────────
wall_clock_ms: 6092872
provision_total_ms: 469708
ingest_total_ms: 22042838
evaluation_total_ms: 4803160
retrieval_total_ms: 15770502
llm_total_ms: 3351728
──────────────────────────────────────────────

── Results ──────────────────────────────────
Overall F1 (micro): 58.84%  (n=1986)
Overall F1 (macro): 49.47%
Overall LLM (micro): 71.95%  (n=1540)
Overall LLM (macro): 63.56%
Overall Evidence Recall: 53.76%

  Cat 1 (multi-hop   ):  F1=22.60%  LLM=53.90%  ER=25.1%  (n=282  llm_n=282)
  Cat 2 (single-hop  ):  F1=58.18%  LLM=76.01%  ER=67.8%  (n=321  llm_n=321)
  Cat 3 (temporal    ):  F1=13.79%  LLM=44.79%  ER=18.6%  (n=96  llm_n=96)
  Cat 4 (open-domain ):  F1=56.57%  LLM=79.55%  ER=60.1%  (n=841  llm_n=841)
  Cat 5 (adversarial ):  F1=96.19%  LLM=N/A  ER=57.1%  (n=446)
──────────────────────────────────────────────
