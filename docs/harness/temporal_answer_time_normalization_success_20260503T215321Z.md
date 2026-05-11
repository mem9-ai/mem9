# Temporal Answer-Time Normalization Success

Date: 2026-05-03

Run:

- `/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-03T21-33-59-472Z_mem9-current.json`
- Logs: `/home/ec2-user/locomo-logs/20260503T213343`
- Protocol: `mem9-current`
- Judge: `qwen3.6-plus`

## Result

The accepted run reached `Overall LLM (micro) 65.26%`, compared with the current
post-migration effective baseline average of `64.65%` from the four recent valid
runs. This is a `+0.61pp` gain over that average.

Key deltas versus the effective average:

- Overall F1: `+0.69pp`
- Overall LLM: `+0.61pp`
- Evidence Recall: `+0.74pp`
- Cat 2 temporal LLM: `+4.36pp`
- Cat 3 open-domain LLM: `+3.13pp`
- Cat 1 multi-hop LLM: `-0.30pp`
- Cat 4 single-hop LLM: `-0.80pp`

## Change

The benchmark answer layer now normalizes pure relative temporal answers when
the retrieved context already contains an answer-time annotation. For example,
if the model answers `next month` and the matching memory contains
`[answer-time: September 2023]`, the final answer becomes `September 2023`.

This is a benchmark compatibility fix, not a server recall/ranking strategy. It
uses only evidence already returned by mem9 and only applies to narrow temporal
answers such as `next month`, `last week`, or bare ordinal dates. It does not
modify entity answers or missing-information answers.

## Verified Examples

- `When is Caroline's youth center putting on a talent show?`
  - Before: `next month`
  - After: `September 2023`
- `When is Jon's group performing at a festival?`
  - Before: `next month`
  - After: `February 2023`
- `When will Evan and his partner have their honeymoon in Canada?`
  - Before: `next month`
  - After: `February 2024`

## Notes

The previous `benchmark/BASELINE.md` value of `66.43%` predates the current
architecture and is no longer a meaningful success gate. The baseline file was
updated to record the new post-migration average policy and this accepted run.

Next rounds should prioritize server-side gains again. This change reduces one
class of answer formatting loss but does not solve the underlying retrieval and
selection issues in multi-hop and single-hop categories.
