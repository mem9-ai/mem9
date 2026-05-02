# Source-Turn Finalize Success - 2026-05-02 13:51

## Verdict

Accepted under the harness success rule: latest Overall LLM micro is at least `+0.50pp` above `/Users/bosn/git/mem9/benchmark/BASELINE.md`.

- Previous baseline Overall LLM micro: `65.04%`
- Success threshold: `65.54%`
- Accepted result: `66.43%`
- Delta vs previous baseline: `+1.39pp`
- Log dir: `/Users/bosn/locomo-logs/20260502T115816`
- Result JSON: `/Users/bosn/git/mem9-benchmark/locomo/results/2026-05-02T03-58-30-678Z.json`
- Validation mode: `USING_LAST_INGEST=true`, `ingest_mode=session`, `role_mode=speaker`
- Cached ingest source: `/Users/bosn/git/mem9-benchmark/locomo/results/last-ingest-cache.json`

The direct delta against the immediately preceding full session run `/Users/bosn/locomo-logs/20260502T100200` was smaller: `66.04% -> 66.43%` (`+0.39pp`). This run should be treated as accepted against the checked-in baseline, but not as a large algorithmic breakthrough.

## Metrics

| Scope | Previous baseline LLM | Accepted LLM | Accepted F1 | Accepted ER |
| --- | ---: | ---: | ---: | ---: |
| Overall | `65.04%` | `66.43%` | `61.70%` | `67.15%` |
| Cat1 multi-hop | `37.37%` | `39.01%` | `26.33%` | `42.8%` |
| Cat2 temporal | `76.01%` | `81.31%` | `66.06%` | `83.4%` |
| Cat3 open-domain | `33.33%` | `39.58%` | `21.75%` | `42.0%` |
| Cat4 single-hop | `73.72%` | `73.01%` | `58.41%` | `76.0%` |
| Cat5 adversarial | `N/A` | `N/A` | `95.74%` | `59.4%` |

Evidence speaker buckets in the accepted run:

- `speaker_a_only`: F1 `65.47%`, LLM `69.81%`, ER `71.56%`
- `speaker_b_only`: F1 `60.43%`, LLM `65.01%`, ER `65.84%`
- `mixed`: F1 `35.50%`, LLM `48.10%`, ER `35.94%`
- `unknown_or_no_evidence`: F1 `37.60%`, LLM `61.54%`, ER `12.70%`

## What Changed

Server-only changes in `/Users/bosn/git/mem9/server`:

- `service.FinalizeSearchResults` was exported so handler-level recall paths can apply the same query-time response shaping as `MemoryService.Search`.
- `defaultConfidenceRecallSearch` now finalizes the merged pinned/insight/session selection before returning memories.
- `singlePoolConfidenceRecallSearch` now finalizes selected memories before returning memories.
- Source-turn scoring now recognizes subject-speaker questions such as `What is Melanie's relationship status?`, not only `What did X say/describe...` forms.
- Source-turn tokenization normalizes possessive names such as `Melanie's` to `melanie`, so speaker labels match query entities.
- Env-mutating source-turn tests were made serial and a regression test was added for subject-speaker source-turn selection.

No benchmark-side scoring, reranking, context pruning, answer repair, or LoCoMo-specific heuristic was added.

## Why It Helped

The benchmark normally calls the handler confidence recall path. Before this change, that path selected memories and returned them directly, bypassing query-time finalization. Insight memories therefore retained extraction-time `metadata.source_turns`, often up to six broad source turns per fact.

The benchmark thin client rendered those broad source turns into the answer prompt. That raised evidence recall in some cases but also buried or contradicted the answer-bearing evidence. After the fix, the handler path prunes source turns against the actual query before returning memories.

The expected effect was answer precision more than raw recall. The accepted run matched that shape:

- Overall LLM improved `+0.39pp` vs the immediately previous full session run.
- Overall ER dropped from `69.60%` to `67.15%`.
- `ER1/LLM0` dropped in the most relevant categories:
  - Cat2: `33 -> 25`
  - Cat3: `19 -> 14`
  - Cat4: `79 -> 76`

## Runtime And Reliability

The cached validation still took `6,720,596 ms` wall clock (`112.0 min`), even without provision or ingest.

- `provision_total_ms`: `0`
- `ingest_total_ms`: `0`
- `evaluation_total_ms`: `28,704,515`
- `retrieval_total_ms`: `108,526,866`
- `llm_total_ms`: `5,233,087`
- Recall requests: `1986`
- Recall p50: `44.8s`
- Recall p95: `114.6s`
- Recall max: `186.3s`

There were `16` transient HTTP `500` responses in the server log, mostly `invalid connection` from TiDB auto-vector/FTS/search paths. The benchmark completed all `1986` questions, but this is a reliability and performance issue for the next loop.

## Boundary Statement

This was a production server recall-path improvement:

- Any normal client using mem9 handler recall benefits.
- The benchmark remained a thin client.
- No private benchmark memory strategy was added.

The only benchmark-related choice was validation mode: `USING_LAST_INGEST=true` reused a valid `session`/`speaker` ingest cache because this patch changed retrieval/response shaping only.

## Next Direction

Do not broaden source-turn expansion further without evidence. The next high-value work should address one of:

- Reliability/performance: graceful degradation for auto-vector/FTS invalid-connection failures inside recall candidate branches, so one failed branch does not produce a 500.
- mem0-style scoring alignment: compare mem9's tiny RRF entity boost with mem0's additive semantic + normalized BM25 + entity scoring. This should be implemented in server recall only, not benchmark-side.
- Recall precision for mixed-speaker questions, where the accepted run still has LLM `48.10%` and ER `35.94%`.

