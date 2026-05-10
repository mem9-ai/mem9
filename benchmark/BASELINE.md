export MNEMO_LLM_MODEL="qwen3.6-flash"
export OPENAI_JUDGE_MODEL="qwen3.6-plus"
export OPENAI_CHAT_MODEL="qwen3.6-plus"

Baseline policy as of 2026-05-10:

The active accepted LoCoMo harness baseline is the mem0-style-on-mem9 product
framework after the canonical entity-store upgrade. It uses fresh mem9 server
ingest through the normal mem9 HTTP API, with `LOCOMO_PROTOCOL=mem0-style`,
`LOCOMO_ANSWER_PROMPT=mem0-speaker`, `LOCOMO_SPEAKER_INGEST_MODE=batch2`,
`LOCOMO_SPEAKER_TOP_K=10`, and `MEM9_RETRIEVAL_LIMIT=20` so answer context can
contain up to 10 memories for speaker_a plus up to 10 memories for speaker_b.

Current accepted active-framework run:

Results file:
/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-10T02-50-01-542Z_mem0-style.json

Unified result:
/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-10T02-50-01-542Z_mem0-style.unified.json

Archived result:
/home/ec2-user/Documents/Dev/harness/results/2026-05-10T02-50-01-542Z_mem0-style.json

Archived unified result:
/home/ec2-user/Documents/Dev/harness/results/2026-05-10T02-50-01-542Z_mem0-style.unified.json

Archived logs:
/home/ec2-user/Documents/Dev/harness/results/20260510T024951

Promotion gate:

- Active Overall LLM micro baseline: 68.29%.
- Promotion gate: 69.29%.
- Strategy promotion should beat this active framework baseline/control by at
  least +1.0pp Overall LLM micro over the clean control mean or net +15
  LLM-correct pairwise, with no severe Cat2/Cat4/mixed-speaker or performance
  regression.
- Cached-retrieval candidates must still compare primarily against a same-cache
  clean control with the same protocol, judge, answer model, ingest cache, and
  retrieval limit before any fresh active-framework promotion run.
- This run had 1 provider `DataInspectionFailed` single-question failure and
  therefore evaluated 1,985 F1 rows and 1,539 LLM-judged rows. Treat that as the
  current clean-run shape unless a future control removes the provider failure.
- The unified result schema is available for this run with `schemaVersion=1.0`,
  `total=1985`, and `errors=0`.

Current cached-retrieval same-cache control:

- None yet for cache `last-ingest-cache created_at=2026-05-10T02:50:01.599Z`.
- The next retrieval/ranking/context-only strategy must first run and archive a
  no-change cached control using this cache, same `mem0-style` protocol, same
  models, `speaker_top_k=10`, and `MEM9_RETRIEVAL_LIMIT=20`.

Legacy references:

The previous active-framework run
`/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-08T02-49-18-990Z_mem0-style.json`
scored 67.88% Overall LLM micro. It remains useful as a pre-entity-store
reference and must not be used as the active promotion gate.

The previous limit=20 `mem9-current` accepted run
`/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-06T06-56-08-251Z_mem9-current.json`
scored 70.97% Overall LLM micro. It remains useful only as a legacy protocol
reference and must not be mixed with the active mem0-style-on-mem9 promotion
baseline.

The previous accepted limit=10 run
`/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-03T22-24-43-577Z_mem9-current.json`
scored 66.69% Overall LLM micro. It remains useful only as an older legacy
reference and must not be used as the active promotion gate.

The invalid 2026-04-29 74.74% run remains permanently excluded.

-- Results ------------------------------------------------
Overall F1 (micro): 59.19%  (n=1985)
Overall F1 (macro): 53.22%
Overall LLM (micro): 68.29%  (n=1539)
Overall LLM (macro): 62.78%
Overall Evidence Recall: 71.46%

  Cat 1 (multi-hop   ):  F1=25.14%  LLM=39.36%  ER=45.5%  (n=282  llm_n=282)
  Cat 2 (temporal    ):  F1=66.74%  LLM=81.00%  ER=85.5%  (n=321  llm_n=321)
  Cat 3 (open-domain ):  F1=31.41%  LLM=56.25%  ER=47.3%  (n=96   llm_n=96)
  Cat 4 (single-hop  ):  F1=56.50%  LLM=74.52%  ER=80.5%  (n=840  llm_n=840)
  Cat 5 (adversarial ):  F1=86.32%  LLM=N/A    ER=65.7%  (n=446)
-----------------------------------------------------------

Evidence speaker buckets:

  speaker_a_only        : F1=62.64%  LLM=71.43%  ER=74.92%  (n=967  llm_n=742)
  speaker_b_only        : F1=58.38%  LLM=68.41%  ER=71.86%  (n=924  llm_n=706)
  mixed                 : F1=30.72%  LLM=38.46%  ER=32.01%  (n=81   llm_n=78)
  unknown_or_no_evidence: F1=37.73%  LLM=61.54%  ER=12.70%  (n=13   llm_n=13)
