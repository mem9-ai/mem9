## Run

- Finished run date: `2026-04-22`
- Benchmark log: `/Users/bosn/locomo-logs/20260422T223419`
- Result JSON: `/Users/bosn/git/mem9-benchmark/locomo/results/2026-04-22T14-34-35-191Z.json`
- Baseline source: `/Users/bosn/git/mem9/benchmark/BASELINE.md`

## Outcome

- Classified as a failure.
- Baseline `Overall LLM (micro)`: `62.14%`
- Current `Overall LLM (micro)`: `62.08%`
- Delta: `-0.06`

Other top-line movement:

- `Overall F1 (micro)`: `60.98% -> 59.79%` (`-1.19`)
- `Overall Evidence Recall`: `55.10% -> 51.31%` (`-3.79`)

Category movement:

- Cat 1: `34.75% -> 34.40%` LLM, `26.8% -> 23.3%` ER
- Cat 2: `74.45% -> 72.59%` LLM, `68.0% -> 65.6%` ER
- Cat 3: `36.46% -> 29.17%` LLM, `20.8% -> 13.1%` ER
- Cat 4: `69.56% -> 71.11%` LLM, `62.9% -> 58.3%` ER

## Boundary Note

- The official failure archive path in `~/Documents/Dev/harness/learns/` was not writable in the current sandbox.
- This fallback file is stored under `mem9/docs/harness/` so the round is still documented and can guide the next loop.
- `mem9-benchmark` remains compatibility-only. No new benchmark-side recall or answer heuristics should be added back.

## What Regressed

The main drop was evidence recall, not benchmark compatibility.

Patterns from the finished result set:

- Many regressions were `ER 1 -> 0` or `ER stayed 1 but LLM 1 -> 0`, which means the benchmark-side gains from the prior accepted run were not yet fully migrated into `mem9/server`.
- Temporal and exact/open-domain prompts often had the right evidence somewhere in the retrieved set, but not with the best answer-bearing memory near the top.
- Several answer turns relied on adjacent question turns for entity grounding, while several time answers relied on more explicit temporalized insights that were no longer ranked strongly enough.

Examples:

- `"When did Joanna first watch Eternal Sunshine of the Spotless Mind?"` kept the answer turn in context, but it fell behind less useful movie-related evidence.
- `"What does John like about Lebron James?"` lost the direct insight that contained the fuller answer (`skills, leadership, work ethic, dedication`).
- `"When do Jolene and her partner plan to complete the game Walking Dead?"` kept session evidence, but the more explicit dated evidence no longer surfaced as strongly.

## Assessment

This failure looks like a server-side ranking / evidence-shaping gap, not a reason to restore benchmark-side retrieval or answer post-processing.

The prior accepted run benefited from benchmark-side:

- context selection that promoted more answer-bearing turns
- answer shaping / canonicalization that converted some `ER=1` cases into accepted LLM answers

Under the current boundary, that benefit needs to be recreated by improving `mem9/server` recall and ranking so the returned memories are more directly answerable without benchmark-private logic.

## Next Direction

Chosen direction: continue forward on the current server-focused branch rather than reverting everything.

Immediate next step:

- strengthen `server/internal/handler/recall.go` so exact/time/general recall rewards stronger query anchors and more explicit answer-bearing candidates
- improve adjacent-turn support for answer turns that depend on neighboring context
- keep `mem9-benchmark` unchanged except for compatibility/stability fixes
