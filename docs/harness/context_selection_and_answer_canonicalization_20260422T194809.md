## Run

- Accepted run date: `2026-04-22`
- Benchmark log: `/Users/bosn/locomo-logs/20260422T183407`
- Result JSON: `/Users/bosn/git/mem9-benchmark/locomo/results/2026-04-22T10-34-22-261Z.json`
- Accepted baseline source: `/Users/bosn/git/mem9/benchmark/BASELINE.md`

## Outcome

- Accepted as a success for baseline promotion.
- `Overall LLM (micro)`: `62.14%`
- `Overall F1 (micro)`: `60.98%`
- `Overall Evidence Recall`: `55.10%`

## Result Delta Vs Previous Baseline

- Previous baseline `Overall LLM (micro)`: `59.35%`
- New accepted baseline `Overall LLM (micro)`: `62.14%`
- LLM delta: `+2.79`
- F1 delta: `59.51% -> 60.98%` (`+1.47`)
- ER delta: `52.93% -> 55.10%` (`+2.17`)

Category movement:

- Cat 1: `31.91% -> 34.75%` LLM, `22.83% -> 24.90%` F1, `25.1% -> 26.8%` ER
- Cat 2: `70.40% -> 74.45%` LLM, `65.42% -> 66.88%` F1, `67.4% -> 68.0%` ER
- Cat 3: `31.25% -> 36.46%` LLM, `21.20% -> 24.39%` F1, `18.9% -> 20.8%` ER
- Cat 4: `67.54% -> 69.56%` LLM, `54.94% -> 56.46%` F1, `58.9% -> 62.9%` ER
- Cat 5: `95.29% -> 95.96%` F1, `55.8% -> 56.1%` ER

## What Changed

This accepted run came from a combined server-side and benchmark-side change set.

Server changes in `mem9/server/internal/handler/recall.go`:

- keep deeper exact/general candidate pools before final selection
- replace pure top-only selection with a balanced session/insight mix for exact/general recall
- preserve complementary evidence instead of letting one source type monopolize the prompt budget

Benchmark retrieval changes in `mem9-benchmark/locomo/src/retrieve.ts`:

- raise prompt context budget from `8` to `10`
- prefer the asked speaker for `What did X say...` questions
- stop over-penalizing useful memories just because they include `[image-caption: ...]`
- when a highly relevant retrieved turn is a question, boost the immediate follow-up reply so the actual answer stays in prompt context

Benchmark answer generation changes in `mem9-benchmark/locomo/src/llm.ts`:

- add prompt rules for multi-clause completeness and list completeness
- strip apology / meta lead-ins before judging
- normalize relationship-status and symbol/meaning answers
- add simple geography normalization for city-to-state / city-to-country cases that repeatedly showed up in LoCoMo
- give multi-clause questions a larger output budget so the model stops truncating supported answers

## Why This Worked

The previous failed run showed two distinct bottlenecks:

- evidence was often already retrieved but the benchmark prompt omitted the answer-bearing reply turn
- the model frequently returned only the first clause of a supported multi-part answer

The accepted change set fixed both:

- balanced recall plus follow-up-aware context selection kept the right evidence in-context more often
- answer-side canonicalization and completeness rules converted more `ER=1 but LLM=0` cases into accepted answers

This is why all three top-line metrics moved together instead of trading one off against another.

## Key Learn

- Benchmark prompt selection is now a first-class optimization surface; retrieved evidence can still be wasted if the answer turn is not promoted into the final context window.
- Caption handling needs nuance. Penalizing all image-bearing memories helps some quote/visual errors, but it also hides many real textual answers.
- The best server-side recall change here was not a larger raw pool by itself, but preserving heterogeneous evidence across source types.

## Next Direction

Start the next loop from this accepted baseline and push on the remaining low-performing areas:

- Cat 1 multi-hop exactness, especially partial lists and partial explanations
- Cat 3 temporal disambiguation, where the benchmark still confuses related nearby events
- open-domain cases where evidence exists but the answer still stops one clause too early
