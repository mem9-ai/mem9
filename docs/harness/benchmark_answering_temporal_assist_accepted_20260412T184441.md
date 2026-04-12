## Run

- Accepted run date: `2026-04-12`
- Benchmark log: `/Users/bosn/locomo-logs/20260412T184441`
- Result JSON: `/Users/bosn/git/mem9-benchmark/locomo/results/2026-04-12T11-44-59-455Z.json`
- Accepted baseline source: `/Users/bosn/git/mem9/benchmark/BASELINE.md`

## Outcome

- Accepted as a success for baseline promotion.
- `Overall LLM (micro)`: `71.95%`
- `Overall F1 (micro)`: `58.84%`
- `Overall Evidence Recall`: `53.76%`

## Result Delta Vs Previous Baseline

- Previous baseline `Overall LLM (micro)`: `70.45%`
- New accepted baseline `Overall LLM (micro)`: `71.95%`
- LLM delta: `+1.50`
- F1 delta: `57.93% -> 58.84%` (`+0.91`)
- ER delta: `48.59% -> 53.76%` (`+5.17`)

Category movement:

- Cat 1: `47.16% -> 53.90%` LLM, `20.26% -> 22.60%` F1, `18.7% -> 25.1%` ER
- Cat 2: `81.93% -> 76.01%` LLM, `65.30% -> 58.18%` F1, `65.5% -> 67.8%` ER
- Cat 3: `48.96% -> 44.79%` LLM, `17.76% -> 13.79%` F1, `14.6% -> 18.6%` ER
- Cat 4: `76.34% -> 79.55%` LLM, `52.16% -> 56.57%` F1, `53.9% -> 60.1%` ER
- Cat 5: `95.96% -> 96.19%` F1, `52.2% -> 57.1%` ER

## What Changed

This accepted run came from benchmark-side answering changes in `mem9-benchmark/locomo`, not a server-side retrieval rewrite.

The accepted change set was:

- tighten the answer prompt so the model prefers copying the specific answer from memories instead of returning generic placeholders
- add read-time `[answer-time: ...]` annotations for temporal questions
- remove the aggressive temporal reranking experiment that over-promoted nearby but wrong temporal events
- keep the temporal prompt rule that says the model should use `[answer-time: ...]` exactly when present
- add a temporal disambiguation instruction: when multiple related events appear, choose the one whose action best matches the question

## Why This Worked

The main win was in answer assembly rather than raw retrieval.

The benchmark had many cases where:

- the evidence was already in the retrieved context
- but the answer model still produced `not mentioned`, a generic category, or the wrong neighboring event

The new prompt rules improved direct extraction and improved open-domain / multi-hop answer composition enough to raise the overall score.

The first temporal-assist attempt proved that benchmark-side answering changes were the right layer, but it also showed that temporal reranking was too aggressive and hurt Cat 2 / Cat 3 by moving related-but-wrong events ahead of the real answer. The accepted run kept the useful answer-time annotation while removing the harmful reorder behavior.

## Key Learn

- Benchmark-side answering is a real leverage point now.
- The safe part is answer-time annotation plus better extraction instructions.
- The unsafe part is changing retrieval order for temporal questions when multiple similar events exist.
- The next iteration should preserve context order and improve action-level disambiguation instead of promoting temporal candidates more aggressively.

## Next Direction

Start the next round from this accepted baseline and focus on:

- recovering Cat 2 / Cat 3 without giving back Cat 1 / Cat 4
- reducing temporal false matches between related events like `interview` vs `accepted`, or `planned` vs `did`
- adding narrower benchmark-side guidance for action alignment before considering any new server-side changes
