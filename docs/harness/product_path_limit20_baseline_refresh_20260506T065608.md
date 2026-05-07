# Product-Path Limit=20 Baseline Refresh

Decision: `keep`
Lane: `product-path`
Target cluster: `control`

## Accepted Run

- Result: `/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-06T06-56-08-251Z_mem9-current.json`
- Archived result: `/home/ec2-user/Documents/Dev/harness/results/2026-05-06T06-56-08-251Z_mem9-current.json`
- Archived logs: `/home/ec2-user/Documents/Dev/harness/results/20260506T065553`
- Artifact manifest: `/home/ec2-user/Documents/Dev/harness/results/20260506T065553/harness-manifest.json`
- Protocol: `mem9-current`
- Retrieval limit: 20
- Models: ingest `qwen3.6-flash`, answer/judge `qwen3.6-plus`

## Metrics

- Overall LLM micro: 70.97%
- Overall F1 micro: 64.49%
- Overall Evidence Recall: 72.23%

This run is a clean no-change product-path control using the active repaired
limit=20 protocol. It replaces the previous documented limit=20 product-path
baseline at 70.32%, making the promotion gate 71.47%.

The legacy 66.69% limit=10 run remains only historical context, and the invalid
2026-04-29 74.74% run remains permanently excluded.

## Current Cached Control

Cached retrieval/ranking/context candidates on this ingest cache should compare
against:

- Result: `/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-06T07-20-13-729Z_mem9-current.json`
- Cache id: `last-ingest-cache created_at=2026-05-06T06:56:08.292Z`
- Overall LLM micro: 70.52%

## Watch Items

- Cat3 LLM is materially lower than the previous product baseline and should be
  monitored for regressions.
- Mixed-speaker evidence remains weak and should be treated as a targeted
  failure cluster rather than solved by broad recall expansion.
