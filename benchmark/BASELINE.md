export MNEMO_LLM_MODEL="qwen3.6-flash"
export OPENAI_JUDGE_MODEL="qwen3.6-plus"
export OPENAI_CHAT_MODEL="qwen3.6-plus"

Baseline policy as of 2026-05-07:

The active accepted LoCoMo harness baseline is the mem0-style-on-mem9 product
framework. It uses fresh mem9 server ingest through the normal mem9 HTTP API,
with `LOCOMO_PROTOCOL=mem0-style`, `LOCOMO_ANSWER_PROMPT=mem0-speaker`,
`LOCOMO_SPEAKER_INGEST_MODE=batch2`, `LOCOMO_SPEAKER_TOP_K=10`, and
`MEM9_RETRIEVAL_LIMIT=20` so answer context can contain up to 10 memories for
speaker_a plus up to 10 memories for speaker_b.

Current accepted active-framework run:

Results file:
/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-07T05-45-51-349Z_mem0-style.json

Archived result:
/home/ec2-user/Documents/Dev/harness/results/2026-05-07T05-45-51-349Z_mem0-style.json

Archived logs:
/home/ec2-user/Documents/Dev/harness/results/20260507T054533

Promotion gate:

- Active Overall LLM micro baseline: 67.17%.
- Strategy promotion should beat this active framework baseline/control by at
  least +0.5pp Overall LLM micro or net +8 LLM-correct pairwise, with no severe
  Cat2/Cat4 or performance regression.
- Cached-retrieval candidates must still compare primarily against a same-cache
  clean control with the same protocol, judge, answer model, ingest cache, and
  retrieval limit before any fresh active-framework promotion run.
- This run had 3 provider `DataInspectionFailed` single-question failures and
  therefore evaluated 1,983 F1 rows and 1,538 LLM-judged rows. Treat that as the
  current clean-run shape unless a future control removes the provider failures.

Current cached-retrieval same-cache control:

- None yet for cache `last-ingest-cache created_at=2026-05-07T05:45:51.383Z`.
- The next retrieval/ranking/context-only strategy must first run and archive a
  no-change cached control using this cache, same `mem0-style` protocol, same
  models, `speaker_top_k=10`, and `MEM9_RETRIEVAL_LIMIT=20`.

Legacy references:

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

── Results ──────────────────────────────────
Overall F1 (micro): 59.01%  (n=1983)
Overall F1 (macro): 52.40%
Overall LLM (micro): 67.17%  (n=1538)
Overall LLM (macro): 60.74%
Overall Evidence Recall: 71.41%

  Cat 1 (multi-hop   ):  F1=25.17%  LLM=38.30%  ER=43.7%  (n=282  llm_n=282)
  Cat 2 (temporal    ):  F1=64.05%  LLM=78.19%  ER=83.0%  (n=321  llm_n=321)
  Cat 3 (open-domain ):  F1=29.17%  LLM=52.08%  ER=45.3%  (n=96   llm_n=96)
  Cat 4 (single-hop  ):  F1=57.52%  LLM=74.37%  ER=81.2%  (n=839  llm_n=839)
  Cat 5 (adversarial ):  F1=86.07%  LLM=N/A    ER=67.5%  (n=445)
──────────────────────────────────────────────

Evidence speaker buckets:

  speaker_a_only        : F1=62.20%  LLM=70.04%  ER=74.64%  (n=965  llm_n=741)
  speaker_b_only        : F1=58.15%  LLM=66.71%  ER=71.75%  (n=924  llm_n=706)
  mixed                 : F1=34.48%  LLM=44.87%  ER=35.48%  (n=81   llm_n=78)
  unknown_or_no_evidence: F1=36.57%  LLM=61.54%  ER=14.29%  (n=13   llm_n=13)
