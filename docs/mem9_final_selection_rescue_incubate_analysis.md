# mem9 Final-Selection Provenance Rescue Incubate Analysis

Date: 2026-05-12

Mode: INCUBATE analysis only. No code, benchmark, prompt, scoring, harness, ingestion, storage, or reconciliation changes were made.

## Executive Summary

Recommendation: **KEEP_AS_INCUBATE_NO_CHANGE**.

The full benchmark incubation result is evidence-positive but not clean enough for promotion:

- Overall LLM moved `68.29% -> 68.97%`, `+0.67pp`.
- Overall ER moved `71.46% -> 75.78%`, `+4.32pp`.
- Target final-context gold dia-id movement was `42` improved, `118` neutral, `0` regressed, `1` provider-failed missing row.
- Target LLM movement was `26` improved, `127` neutral, `7` regressed, `1` missing.
- Non-target LLM movement was `69` wins, `77` losses, net `-8`.

The seven target LLM regressions do not share one mechanism. Three target LLM regressions actually gained gold evidence, four had unchanged gold evidence, and none lost target evidence. Cat2 has the clearest regression shape around exact temporal/numeric questions, but that same query shape also produced LLM wins and positive same-cache predict-only evidence movement. Cat3 and worst non-target regressions are heterogeneous.

No single safe guardrail is supported strongly enough to request implementation. Keep this experiment incubated as-is.

## Evidence Sources

| Evidence | Path |
| --- | --- |
| Full benchmark result report | `docs/mem9_final_selection_rescue_full_benchmark_result.md` |
| Predict-only validation report | `docs/mem9_final_selection_rescue_predict_only_result.md` |
| Offline replay report | `docs/mem9_final_selection_rescue_replay.md` |
| Diagnostic plan | `docs/mem9_retrieval_ranking_diagnostic_plan.md` |
| Baseline result | `/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-10T02-50-01-542Z_mem0-style.json` |
| Candidate full result | `/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-12T02-04-40-552Z_mem0-style.json` |
| Candidate unified result | `/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-12T02-04-40-552Z_mem0-style.unified.json` |
| Target movement rows | `/home/ec2-user/Documents/Dev/harness/diagnostics/20260512T011857Z-final-selection-rescue-predict-only/exports/final_selection_rescue_target_movement_rows.json` |
| Non-target predict-only movement rows | `/home/ec2-user/Documents/Dev/harness/diagnostics/20260512T011857Z-final-selection-rescue-predict-only/exports/final_selection_rescue_non_target_movement_rows.json` |

Row-level comparisons below use local row ids reconstructed from `/home/ec2-user/git/mem9-benchmark/locomo/data/locomo10.json`, because the unified result id offset is not stable across dropped rows.

## Target Wins vs Target Regressions

Target LLM wins/regressions:

| Metric | Wins | Losses | Net |
| --- | ---: | ---: | ---: |
| Target LLM | 26 | 7 | +19 |
| Target evidence recall / gold dia-id coverage | 42 | 0 | +42 |

Target LLM wins by subtype:

| Subtype | Wins |
| --- | ---: |
| B. Evidence ranked below final top-k due to score composition | 10 |
| C. Evidence memory is suppressed by final selection despite top-10 rank | 6 |
| D. Evidence loses to wrong-speaker competitors | 4 |
| E. Evidence loses to temporally nearby distractors | 3 |
| F. Query terms do not align with stored summary content | 3 |

Target LLM regressions by subtype:

| Subtype | Regressions |
| --- | ---: |
| B. Evidence ranked below final top-k due to score composition | 1 |
| C. Evidence memory is suppressed by final selection despite top-10 rank | 2 |
| D. Evidence loses to wrong-speaker competitors | 1 |
| E. Evidence loses to temporally nearby distractors | 1 |
| F. Query terms do not align with stored summary content | 2 |

The regressions are distributed across the same subtypes that produced wins, so subtype-level disabling would throw away real gains.

Target LLM regression rows:

| Row | Cat | Bucket | Subtype | Gold dia count | ER | F1 | Baseline answer -> Candidate answer | Interpretation |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| `conv-26:24` | 1 | `speaker_b_only` | B | `0 -> 0` | `0.00 -> 0.00` | `0.50 -> 0.40` | Running and pottery -> Running, pottery, and painting | Gold evidence unchanged; answer added an unsupported item. |
| `conv-30:25` | 1 | `speaker_a_only` | C | `0 -> 1` | `0.00 -> 0.50` | `0.25 -> 0.33` | Dance classes and instruction -> Workshops, classes, and competitions | Gold evidence improved; LLM judge still flipped down. |
| `conv-30:53` | 4 | `speaker_b_only` | C | `0 -> 1` | `0.00 -> 1.00` | `0.00 -> 0.17` | Jon said it, not Gina. -> Make them feel like a cool oasis. | Gold evidence improved; answer quality changed but not enough for judge. |
| `conv-41:122` | 4 | `speaker_a_only` | D | `0 -> 0` | `0.00 -> 0.00` | `0.22 -> 0.18` | Community flood damage -> Maria's offer to help | Gold evidence unchanged. |
| `conv-48:103` | 4 | `speaker_a_only` | F | `0 -> 0` | `0.00 -> 0.00` | `0.33 -> 0.00` | At a yoga class -> As her new neighbor | Gold evidence unchanged. |
| `conv-49:32` | 1 | `speaker_a_only` | F | `0 -> 0` | `0.00 -> 0.00` | `0.40 -> 0.00` | Losing his keys -> Unreliable new Prius | Gold evidence unchanged. |
| `conv-50:125` | 4 | `speaker_a_only` | E | `0 -> 1` | `0.00 -> 1.00` | `0.40 -> 0.00` | Tokyo music festival -> Calvin met him in Tokyo. | Gold evidence improved; LLM answer regressed. |

Conclusion: target regressions are mostly answer-synthesis/judge conversion failures, not evidence-loss failures. There is no target evidence regression to guard against.

## Cat2 Regression Analysis

Cat2 aggregate movement:

| Metric | Baseline | Candidate | Delta |
| --- | ---: | ---: | ---: |
| LLM | 81.00% | 80.37% | -0.62pp |
| ER | 85.51% | 84.92% | -0.60pp |

Row-level Cat2 LLM movement:

| Wins | Losses | Neutral | Missing | Net |
| ---: | ---: | ---: | ---: | ---: |
| 16 | 18 | 287 | 0 | -2 |

Cat2 loss breakdown:

| Breakdown | Rows |
| --- | ---: |
| Losses with ER/gold unchanged | 11 |
| Losses with ER/gold down | 7 |
| Losses with exact temporal/numeric query shape | 13 |
| Exact temporal/numeric wins | 11 |

Representative Cat2 losses:

| Row | Question | Gold count | ER | Baseline answer -> Candidate answer |
| --- | --- | --- | --- | --- |
| `conv-41:27` | When did John have a party with veterans? | `1 -> 1` | `1.00 -> 1.00` | Friday, 12 May 2023 -> 20 May 2023 |
| `conv-42:16` | What physical transformation did Nate undergo in April 2022? | `1 -> 0` | `0.50 -> 0.00` | Dyed his hair purple -> No physical transformation recorded. |
| `conv-42:18` | Which outdoor spot did Joanna visit in May? | `1 -> 0` | `1.00 -> 0.00` | Whispering Falls -> A waterfall on a hike |
| `conv-42:72` | When did Joanna plan on going to Nate's to watch him play with his turtles? | `1 -> 0` | `1.00 -> 0.00` | 10 November 2022 -> November 9, 2022 |
| `conv-44:45` | How many pets will Andrew have, as of December 2023? | `2 -> 1` | `0.67 -> 0.33` | Three dogs: Toby, Buddy, Scout -> At least three dogs. |
| `conv-49:39` | How many months lapsed between Sam's first and second doctor's appointment? | `2 -> 2` | `1.00 -> 1.00` | Approximately 3 months -> Approximately 5 months |

Evidence vs hypothesis:

- Evidence: Cat2 losses are overrepresented among exact temporal/numeric questions.
- Counter-evidence: Cat2 exact temporal/numeric questions also had `11` LLM wins, so disabling rescue for that shape would only recover a projected net `+2` Cat2 pairwise rows.
- Counter-evidence: same-cache predict-only movement did not show a Cat2 evidence problem. The predict-only report had Cat2 non-target evidence movement `6` improved and `3` regressed, not a broad Cat2 regression.
- Important caveat: the full benchmark used fresh ingest, so Cat2 differences can include storage/extraction and answer-generation variance, not just the rescue rule.

Conclusion: Cat2 is a watch item, but not enough to justify a guardrail now.

## Cat3 Regression Analysis

Cat3 aggregate movement:

| Metric | Baseline | Candidate | Delta |
| --- | ---: | ---: | ---: |
| LLM | 56.25% | 54.17% | -2.08pp |
| ER | 47.31% | 47.24% | -0.07pp |

Row-level Cat3 LLM movement:

| Wins | Losses | Neutral | Missing | Net |
| ---: | ---: | ---: | ---: | ---: |
| 6 | 8 | 82 | 0 | -2 |

Cat3 loss breakdown:

| Breakdown | Rows |
| --- | ---: |
| Losses with ER/gold down | 3 |
| Losses with ER/gold unchanged | 3 |
| Losses with ER/gold up | 2 |
| Exact temporal/numeric losses | 1 |

Cat3 losses are heterogeneous:

| Row | Question | Gold count | ER | Baseline answer -> Candidate answer |
| --- | --- | --- | --- | --- |
| `conv-42:73` | What state did Joanna visit in summer 2021? | `1 -> 0` | `1.00 -> 0.00` | Indiana -> Information not available. |
| `conv-43:67` | What would be a good hobby related to his travel dreams for Tim to pick up? | `0 -> 0` | `0.00 -> 0.00` | Photography or creative writing -> Learning an instrument |
| `conv-43:70` | Which Star Wars-related locations would Tim enjoy during his visit to Ireland? | `0 -> 1` | `0.00 -> 0.33` | No Star Wars interest mentioned. -> No Star Wars locations mentioned. |
| `conv-47:6` | Does James live in Connecticut? | `1 -> 0` | `1.00 -> 0.00` | Likely, adopted dog in Stamford. -> No information available. |
| `conv-48:36` | How old is Jolene? | `1 -> 2` | `0.10 -> 0.20` | Jolene's age is not mentioned. -> Jolene's age is unknown. |
| `conv-49:46` | How do Evan and Sam use creative outlets to cope with life's challenges? | `0 -> 0` | `0.00 -> 0.00` | Evan paints; Sam journals and runs. -> Evan paints; Sam considers painting. |

Conclusion: Cat3 movement is too small and mixed to support a rule change. Some losses have improved evidence, which points again to answer synthesis or judge variance.

## Non-Target Regression Analysis

Non-target LLM movement:

| Wins | Losses | Net |
| ---: | ---: | ---: |
| 69 | 77 | -8 |

Non-target losses by category:

| Category | Losses |
| --- | ---: |
| Cat1 | 13 |
| Cat2 | 18 |
| Cat3 | 8 |
| Cat4 | 38 |

Loss evidence movement:

| Evidence movement | Rows |
| --- | ---: |
| Gold/ER unchanged | 49 |
| Gold/ER down | 25 |
| Gold/ER up | 3 |

Worst non-target binary flips include:

| Row | Cat | Gold count | ER | Baseline answer -> Candidate answer |
| --- | ---: | --- | --- | --- |
| `conv-26:106` | 4 | `0 -> 0` | `0.00 -> 0.00` | Running -> Walking Luna and Oliver |
| `conv-26:148` | 4 | `1 -> 1` | `1.00 -> 1.00` | She was thankful they enjoyed it. -> She was thankful and relieved. |
| `conv-26:76` | 1 | `1 -> 1` | `1.00 -> 1.00` | October 19, 2023 -> She did not go hiking. |
| `conv-26:78` | 1 | `2 -> 1` | `1.00 -> 0.50` | Wooden figurines and pink sneakers -> Wooden figurines |
| `conv-30:43` | 4 | `1 -> 0` | `1.00 -> 0.00` | Jon's students performing at a festival -> Jon's dance students |
| `conv-41:127` | 4 | `1 -> 1` | `1.00 -> 1.00` | Veterans' resilience filled him with hope. -> Samuel's resilience filled him with hope. |

The losses do not form one clean rule-owned class. Many are answer exactness or paraphrase/judge changes despite unchanged gold evidence.

## Rule Causality Assessment

Evidence supporting rule benefit:

- Offline replay: `42` safe rows improved, `0` target-gold regressions.
- Predict-only same-cache validation: `32` target rows improved, `0` target regressions; non-target evidence movement was `80` improved vs `16` regressed.
- Full benchmark: target final-context gold dia-id movement was `42` improved, `0` regressed.
- Full benchmark: Overall ER improved `+4.32pp`; Cat4 ER improved `+5.03pp`.

Evidence against clean rule-caused regression:

- Target LLM regressions span five subtypes, and none lost target evidence.
- Cat2 full-run regression conflicts with same-cache predict-only evidence, where Cat2 non-target evidence movement was positive (`6` improved, `3` regressed).
- Cat3 losses include both ER-down and ER-up rows.
- The full benchmark was fresh ingest, not same-cache, so row changes include fresh storage/extraction and answer-generation variance.
- Four provider `DataInspectionFailed` rows changed denominator; one was a target row.

Hypothesis:

The rescue rule is probably improving final context evidence as designed, but the full-run LLM score is still dominated by answer synthesis, judge sensitivity, and fresh-ingest variance on a subset of rows.

## Guardrail Assessment

One possible guardrail was considered:

> Disable final-selection provenance rescue for exact temporal/numeric query shapes such as `when`, `which year`, `how many`, `how long`, `what year`, and `how old`.

Evidence for the candidate:

- Cat2 losses are concentrated in that query shape: `13/18` Cat2 losses.
- No target evidence-improved rows used that query shape, so the current target evidence gains would likely be preserved.
- Cat4 exact temporal/numeric rows had no LLM wins or losses in this comparison, so Cat4 gains would likely be preserved.

Evidence against implementing it now:

- The same exact temporal/numeric shape also had `11` Cat2 LLM wins.
- Across all non-target rows, exact temporal/numeric movement was only `12` wins vs `15` losses, projected net `+3` if reverted.
- Same-cache predict-only evidence movement for exact temporal/numeric non-target rows was `10` improved vs `3` regressed, meaning the guardrail would remove more same-cache evidence gains than evidence losses.
- It does not address the seven target LLM regressions.
- It does not address most Cat3 losses.

Conclusion: this is the only plausible bounded guardrail, but it is not safe enough to request. It risks discarding true evidence gains to chase a small full-run LLM noise pattern.

## Proposed Guardrail

Exact proposed guardrail: **none**.

The rejected guardrail above should not be implemented without stronger same-cache or replay evidence.

## Expected Impact Of No Change

| Area | Expected impact |
| --- | --- |
| Target evidence gains | Preserved: current evidence gain is `42` improved, `0` regressed. |
| Cat4 gains | Preserved: Cat4 LLM `+1.85pp`, Cat4 ER `+5.03pp`. |
| Cat2/Cat3 regressions | Remain an incubation risk, but current evidence does not attribute them cleanly to one fixable rescue condition. |
| Non-target LLM losses | Remain slightly negative (`69` wins, `77` losses), but heterogeneous and mostly not evidence-loss dominated. |

## Recommendation

**KEEP_AS_INCUBATE_NO_CHANGE**

Do not tune the rescue rule based on this single full-run result. The evidence supports keeping the implementation in incubation for further controlled analysis, not promotion and not rollback. Reverting would throw away a real target-evidence improvement. A bounded refinement is not justified because the only plausible guardrail has weak net LLM upside and negative same-cache evidence tradeoff.
