export MNEMO_LLM_MODEL="qwen3.6-flash"
export OPENAI_JUDGE_MODEL="qwen3.6-plus"
export OPENAI_CHAT_MODEL="qwen3.6-plus"

Baseline policy as of 2026-05-05:

The active accepted product-path baseline now uses `MEM9_RETRIEVAL_LIMIT=20`,
matching the EC2 harness default and mem0-style speaker-scoped context shape
of up to 10 memories for speaker_a plus up to 10 memories for speaker_b.

Current accepted product-path run:

Results file:
/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-05T16-49-58-725Z_mem9-current.json

Archived result:
/home/ec2-user/Documents/Dev/harness/results/2026-05-05T16-49-58-725Z_mem9-current.json

Archived logs:
/home/ec2-user/Documents/Dev/harness/results/20260505T164943

Promotion gate:

- Active Overall LLM micro baseline: 70.32%.
- Strategy promotion should beat this active product-path baseline/control by at
  least +0.5pp Overall LLM micro or net +8 LLM-correct pairwise, with no severe
  Cat2/Cat4 or performance regression.
- Cached-retrieval candidates must still compare primarily against a same-cache
  clean control with the same protocol, judge, answer model, ingest cache, and
  retrieval limit before any product-path promotion run.

Legacy reference:

The previous accepted run
`/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-03T22-24-43-577Z_mem9-current.json`
used `combined_limit=10` and scored 66.69% Overall LLM micro. It remains useful
only as a legacy reference and must not be used as the active limit=20 promotion
gate.

The invalid 2026-04-29 74.74% run remains permanently excluded.

── Results ──────────────────────────────────
Overall F1 (micro): 64.72%  (n=1986)
Overall F1 (macro): 57.14%
Overall LLM (micro): 70.32%  (n=1540)
Overall LLM (macro): 63.29%
Overall Evidence Recall: 71.86%

  Cat 1 (multi-hop   ):  F1=30.00%  LLM=44.33%  ER=49.9%  (n=282  llm_n=282)
  Cat 2 (temporal    ):  F1=71.27%  LLM=80.37%  ER=87.1%  (n=321  llm_n=321)
  Cat 3 (open-domain ):  F1=27.56%  LLM=51.04%  ER=49.7%  (n=96  llm_n=96)
  Cat 4 (single-hop  ):  F1=62.26%  LLM=77.41%  ER=81.4%  (n=841  llm_n=841)
  Cat 5 (adversarial ):  F1=94.62%  LLM=N/A  ER=61.4%  (n=446)
──────────────────────────────────────────────

Evidence speaker buckets:

  speaker_a_only        : F1=67.67%  LLM=72.78%  ER=74.37%  (n=967  llm_n=742)
  speaker_b_only        : F1=64.38%  LLM=69.69%  ER=72.78%  (n=924  llm_n=706)
  mixed                 : F1=38.73%  LLM=54.43%  ER=38.61%  (n=82   llm_n=79)
  unknown_or_no_evidence: F1=33.78%  LLM=61.54%  ER=10.58%  (n=13   llm_n=13)

Delta versus legacy limit=10 accepted run:

- Overall LLM (micro): +3.63pp
- Overall F1 (micro): +1.99pp
- Overall Evidence Recall: +4.23pp
- Cat 1 LLM: +6.39pp
- Cat 2 LLM: -0.94pp
- Cat 3 LLM: +9.37pp
- Cat 4 LLM: +3.81pp
