---
title: "Proposal: Query Strategy Router for LoCoMo Recall"
status: draft
created: 2026-04-10
last_updated: 2026-04-10
depends_on:
  - "locomo-cat1-cat2-to-70-proposal.md"
  - "locomo-cat1-entity-set-rerank-proposal.md"
  - "locomo-adaptive-retrieval-budget-proposal.md"
---

# Proposal: Query Strategy Router for LoCoMo Recall

## Summary

Recent LoCoMo results suggest there is no single recall strategy that works
best across Cat1, Cat2, and Cat3.

Observed pattern:

- Cat2 improves with exact-event / explicit-session / date-aware retrieval,
- Cat1 needs set/list coverage and multi-row composition,
- Cat3 mixes temporal lookup with inference/attribute questions and is not well
  captured by a simple "temporal" label.

This proposal adds a **query strategy router**:

- detect the likely retrieval strategy from the query,
- choose the best recall path for that strategy,
- fall back to the default mixed path when confidence is low.

The key design choice is:

> route by **retrieval strategy class**, not by benchmark category label.

So instead of trying to predict `cat1/cat2/cat3`, the router predicts things
like:

- exact event lookup,
- set aggregation,
- count query,
- attribute inference,
- default mixed recall.

---

## Problem

The current server has several useful retrieval modes, but no explicit router
that decides among them by query shape.

Current high-level strategies already present in code:

- default mixed memory search,
- explicit-session session-first search,
- provenance-routed mixed search,
- session-only search,
- event-fact boosts,
- lightweight query-shape reranking.

What is missing is:

> given a query, which of these strategies should we use first?

Without a router:

- Cat2 exact-answer questions may spend too much budget on generic insights,
- Cat1 list/set questions may get enough evidence but the wrong subset,
- Cat3 inference questions may be treated as plain temporal queries when they
  actually need broader evidence.

---

## Goals

- Improve LoCoMo by routing queries to more suitable retrieval strategies.
- Reuse existing server recall paths rather than replacing them wholesale.
- Keep the external API unchanged.
- Keep the system safe by falling back when routing confidence is low.

## Non-Goals

- Predicting benchmark category labels directly as the public contract.
- Replacing the answer model.
- Creating a large, opaque classifier with no fallback.

---

## Core Idea

Add a **query strategy detection phase** ahead of retrieval.

The router should:

1. infer the likely retrieval strategy,
2. assign a confidence score,
3. run the mapped retrieval path if confidence is high enough,
4. otherwise use the default strategy.

This should initially be applied in the `/memories` search path only.

---

## Strategy Classes

## 1. `exact_event_temporal`

Best for:

- `when did X ...`
- `what date ...`
- exact event/date lookup

Typical examples:

- `When did Melanie run a charity race?`
- `When did Caroline go to the LGBTQ support group?`

Desired retrieval behavior:

- explicit-session session-first when `session_id` is available,
- strong event-fact and time-bearing boosts,
- no neighbor expansion for explicit-session mode,
- larger direct session/event share.

---

## 2. `set_aggregation`

Best for:

- `what events`
- `what books`
- `what activities`
- `what types`
- `what names`
- `who did X help`

Typical examples:

- `What LGBTQ+ events has Caroline participated in?`
- `What are Melanie's pets' names?`
- `What types of pottery have Melanie and her kids made?`

Desired retrieval behavior:

- explicit-session session-first when possible,
- Cat1 entity-/family-aware reranking,
- coverage-aware final selection,
- moderate budget widening only if coverage is clearly weak.

---

## 3. `count_query`

Best for:

- `how many`
- numeric aggregation questions

Typical examples:

- `How many times has Melanie gone to the beach in 2023?`
- `How many children does Melanie have?`

Desired retrieval behavior:

- explicit-session session-first when possible,
- numeric/time-bearing row boosts,
- avoid over-diversification,
- prefer rows with explicit counts or bounded enumerations.

---

## 4. `attribute_inference`

Best for:

- `would X ...`
- `might X ...`
- `what kind of person`
- `what attributes`
- `what job might X pursue`

Typical examples:

- `Would Caroline be considered religious?`
- `What attributes describe John?`
- `What job might Maria pursue in the future?`

Desired retrieval behavior:

- broader evidence pool than exact-event mode,
- less dependence on one exact row,
- possibly adaptive widening if first-pass evidence is generic or contradictory.

---

## 5. `default_mixed`

Fallback for:

- queries that do not clearly match any specialized strategy,
- ambiguous queries,
- low-confidence routing decisions.

Desired retrieval behavior:

- current default mixed memory search,
- provenance-routed supplement where applicable,
- existing fallback semantics unchanged.

---

## Relationship to LoCoMo Categories

The router should **not** predict benchmark category labels directly.
However, the relationship between LoCoMo categories and strategy classes is
useful as design guidance for the detector.

### Important rule

Use this mapping to design the detector and to analyze benchmark failures.
Do **not** make `cat1/cat2/cat3` the runtime routing contract.

### Category-to-strategy relationship

| LoCoMo category | Typical meaning | Primary strategy class | Secondary strategy classes |
|---|---|---|---|
| `Cat1` | multi-hop / set-like | `set_aggregation` | `count_query`, `default_mixed` |
| `Cat2` | single-hop | `exact_event_temporal` for date/event questions | `count_query`, `default_mixed` |
| `Cat3` | temporal + inference mix | `attribute_inference` for `would/might/what kind` questions | `exact_event_temporal`, `default_mixed` |
| `Cat4` | open-domain | `default_mixed` | `exact_event_temporal`, `count_query` |
| `Cat5` | adversarial / no-info | `default_mixed` in v1 | later maybe a dedicated `no_answer` strategy |

### Practical interpretation

#### Cat1

Cat1 questions usually map to:

- `set_aggregation`

Examples:

- `What LGBTQ+ events has Caroline participated in?`
- `What books has Melanie read?`
- `What are Melanie's pets' names?`

Some Cat1 questions also map to:

- `count_query`

Example:

- `How many times has Melanie gone to the beach in 2023?`

#### Cat2

Cat2 does not map to one single strategy.

It often splits into:

- `exact_event_temporal`
  - for exact date/event questions
- `count_query`
  - for numeric single-hop questions
- `default_mixed`
  - for ordinary exact attribute lookup

#### Cat3

Cat3 is the least clean benchmark category for routing.

It contains:

- true temporal lookup questions -> `exact_event_temporal`
- inferential / attribute questions -> `attribute_inference`

Examples:

- `Would Caroline be considered religious?` -> `attribute_inference`
- `What might John's degree be in?` -> `attribute_inference`
- `When did X do Y?` -> `exact_event_temporal`

### v1 implication

For v1, the strategy router should support:

- `exact_event_temporal`
- `set_aggregation`
- `count_query`
- `default_mixed`

and defer:

- `attribute_inference`

This means:

- Cat1 is mostly covered in v1,
- Cat2 is mostly covered in v1,
- Cat3 is only partially covered in v1 and will still rely more heavily on
  fallback/default behavior.

That is acceptable for a first rollout if the immediate goal is:

- improve Cat1 and Cat2 safely,
- then add `attribute_inference` once the first router version is stable.

### Cat3 implication

Cat3 should **not** be treated as one dedicated recall strategy in v1.

Reason:

- Cat3 is not mostly clean temporal lookup,
- it contains a mix of:
  - inference / attribute questions,
  - and general mixed-recall questions.

So the practical recommendation is:

- do **not** add a benchmark-labeled `cat3_strategy`,
- instead treat Cat3 as mostly split between:
  - `attribute_inference`
  - `default_mixed`

### Cat3 recommendation

- `attribute_inference` is **out of v1 scope**
- but it is likely **required in v2** if improving Cat3 becomes a serious goal

This means:

- v1 can still improve Cat1 and Cat2 meaningfully without overcomplicating the router,
- but Cat3 should not be expected to improve much until `attribute_inference`
  becomes a real strategy class with its own retrieval logic.

---

## Detection Options

This proposal leaves room for several routing implementations.

## Option A — Heuristic router

Use query text heuristics only.

Pros:

- cheap,
- deterministic,
- easy to debug.

Cons:

- brittle,
- weaker on paraphrases and non-English queries.

Use cases:

- good first implementation,
- especially for explicit-session LoCoMo evaluation.

---

## Option B — Prototype semantic router

Maintain a small bank of prototype queries labeled by strategy.

At runtime:

- embed the incoming query,
- compare it against the prototype bank,
- use nearest strategy if confidence is high enough.

Pros:

- more robust than raw keywords,
- still deterministic enough to inspect,
- easier to tune than an LLM classifier.

Cons:

- requires prototype curation,
- still can overfit if built too directly from LoCoMo questions.

Use cases:

- likely the best medium-term starting point.

---

## Option C — LLM classifier

Use an LLM to classify:

- strategy class,
- primary entity,
- answer shape,
- confidence.

Pros:

- strongest semantic flexibility,
- better on paraphrases and ambiguity.

Cons:

- added latency/cost,
- less deterministic,
- harder to debug and benchmark.

Use cases:

- likely better as a fallback for ambiguous cases, not the first production
  implementation.

---

## Recommendation on Detection

Do **not** start with a pure benchmark-question table keyed to `cat1/cat2/cat3`.

The concrete v1 detection contract is:

- **v1: prototype-table router in control-plane MetaDB**
- **LLM fallback only for ambiguous or low-confidence cases**
- **no heuristic-only v1**

Rejected as the primary v1 design:

- heuristic-only router

Reason:

- the prototype-table design is already the chosen two-step pipeline,
- it is more semantically robust than plain heuristics,
- and still more inspectable than an LLM-only router.

---

## Proposed Detection Pipeline

This section refines the router into a concrete two-step design.

### Step 1 — Prototype Query Table in MetaDB

Maintain a small MetaDB table of **prototype query patterns**, each labeled with
one strategy class.

Important:

- store representative query patterns, not the full LoCoMo question corpus
- label rows with strategy class, not benchmark category
- keep the table small and curated
- support both `en` and `zh` rows in the table, even though LoCoMo itself is
  English-only

Recommended table purpose:

- cheap first-pass routing
- deterministic, inspectable behavior
- vector + FTS lookup over query prototypes

### Storage and ownership decision

For v1, the prototype table is a **global control-plane MetaDB table**.

That means:

- it does **not** live in tenant databases,
- it is shared across all tenants,
- it is created by control-plane schema/migration,
- it is owned by a control-plane repository/service pair,
- tenant provisioning does not create or manage it.

This is the correct scope because strategy routing is a global retrieval-policy
concern, not tenant data.

Concrete ownership contract for v1:

- schema lives in the control-plane schema surface
  - initial bootstrap SQL: `server/schema.sql`
  - long-term home: control-plane migration path
- add a dedicated repository:
  - `RecallStrategyPrototypeRepo`
- add a dedicated service:
  - `RecallStrategyRouterService`
- inject that service into `Server`
- `detectRecallStrategies(...)` calls that service rather than querying tenant
  DBs directly

Implementation note:

- Step 1 is effectively **TiDB-first** in v1 because the proposed control-plane
  search contract assumes vector + FTS support.
- The implementation must therefore gate Step 1 by control-plane backend
  capability:
  - full vector + FTS when supported,
  - FTS-only when vector is unavailable,
  - unresolved / fallback when neither leg is available.

Suggested interface sketch:

```go
type RecallStrategyPrototypeRepo interface {
    VectorSearch(ctx context.Context, query string, limit int, language string) ([]RecallStrategyPrototypeMatch, error)
    FTSSearch(ctx context.Context, query string, limit int, language string) ([]RecallStrategyPrototypeMatch, error)
}

type RecallStrategyRouterService interface {
    Detect(ctx context.Context, input StrategyRouterInput) (RecallRouteDecision, error)
}
```

Responsibility split:

- repository owns raw search-leg access only
- service owns:
  - dual-leg execution
  - RRF merge
  - class-score aggregation
  - confidence resolution

### Proposed table shape

Suggested columns:

- `id`
- `pattern_text`
- `strategy_class`
- `notes`
- `language`
- `active`
- `created_at`
- `updated_at`

Optional fields:

- `answer_family`
- `priority`
- `source` (`benchmark`, `prod_observation`, `manual`)

### Prototype table DDL

For v1, the prototype table should have a concrete DDL like:

```sql
CREATE TABLE IF NOT EXISTS recall_strategy_prototypes (
  id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  pattern_text   TEXT         NOT NULL,
  strategy_class VARCHAR(64)  NOT NULL,
  answer_family  VARCHAR(64)  NULL,
  language       VARCHAR(16)  NOT NULL DEFAULT 'en',
  source         VARCHAR(32)  NOT NULL DEFAULT 'manual',
  priority       INT          NOT NULL DEFAULT 0,
  active         TINYINT(1)   NOT NULL DEFAULT 1,
  notes          TEXT         NULL,
  embedding      VECTOR(1024) GENERATED ALWAYS AS (
    EMBED_TEXT('tidbcloud_free/amazon/titan-embed-text-v2', pattern_text, '{"dimensions": 1024}')
  ) STORED,
  created_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_rsp_active_lang_class (active, language, strategy_class, priority),
  FULLTEXT INDEX idx_rsp_fts (pattern_text) WITH PARSER MULTILINGUAL
);
ALTER TABLE recall_strategy_prototypes
  ADD VECTOR INDEX idx_rsp_vec ((VEC_COSINE_DISTANCE(embedding))) ADD_COLUMNAR_REPLICA_ON_DEMAND;
```

Implementation note:

- the hardcoded model name and dimensions above are illustrative for the
  proposal
- the real implementation should follow the repo's existing configuration-driven
  schema pattern for auto-embedding rather than freezing model/dimension values
  in the router design

### Backend contract

For v1:

- control-plane prototype routing is supported only when the control-plane DB is
  TiDB with FTS and vector search available,
- if vector search is unavailable, Step 1 degrades to FTS/keyword only,
- if both vector and FTS are unavailable, Step 1 is treated as unresolved and
  routing proceeds directly to Step 2 or `default_mixed`.

This keeps the control-plane search contract explicit.

Example rows:

- `When did X attend Y?` -> `exact_event_temporal`
- `What events has X participated in?` -> `set_aggregation`
- `How many times has X done Y?` -> `count_query`

### Prototype curation policy

The table should be built from:

- LoCoMo-derived pattern learning
- manually generalized prototype templates

Important:

- do **not** store every LoCoMo question verbatim
- do **not** use benchmark category as the row label
- do **not** rely on automatic translation for the initial bilingual table

Instead:

- learn the common query shapes from LoCoMo,
- abstract them into generic prototype patterns,
- then manually author both English and Chinese rows for the same strategy
  shape where useful.

Example:

English row:

- `What events has X participated in?`
- `strategy_class = set_aggregation`
- `answer_family = events`
- `language = en`

Chinese companion row:

- `X 参加过哪些活动？`
- `strategy_class = set_aggregation`
- `answer_family = events`
- `language = zh`

This preserves the retrieval strategy shape while allowing non-English support
later in production traffic.

### v1 table size guidance

For v1:

- English-only prototype bank would be roughly `20-40` rows
- bilingual `en + zh` prototype bank is therefore expected to be roughly
  `40-80` rows

That is still small enough to curate manually.

### Bootstrap seed set

The initial seed set should include at least these concrete rows:

| pattern_text | strategy_class | answer_family | language | source |
|---|---|---|---|---|
| `When did X attend Y?` | `exact_event_temporal` |  | `en` | `benchmark_derived` |
| `What date did X join Y?` | `exact_event_temporal` |  | `en` | `benchmark_derived` |
| `When did X sign up for Y?` | `exact_event_temporal` |  | `en` | `benchmark_derived` |
| `X 是什么时候参加 Y 的？` | `exact_event_temporal` |  | `zh` | `manual_translation` |
| `X 是哪天开始 Y 的？` | `exact_event_temporal` |  | `zh` | `manual_translation` |
| `What events has X participated in?` | `set_aggregation` | `events` | `en` | `benchmark_derived` |
| `What books has X read?` | `set_aggregation` | `books` | `en` | `benchmark_derived` |
| `What are X's pets' names?` | `set_aggregation` | `pets` | `en` | `benchmark_derived` |
| `X 参加过哪些活动？` | `set_aggregation` | `events` | `zh` | `manual_translation` |
| `X 读过哪些书？` | `set_aggregation` | `books` | `zh` | `manual_translation` |
| `How many times has X done Y?` | `count_query` | `counts` | `en` | `benchmark_derived` |
| `How many children does X have?` | `count_query` | `counts` | `en` | `benchmark_derived` |
| `X 做过 Y 多少次？` | `count_query` | `counts` | `zh` | `manual_translation` |
| `What is X's job?` | `default_mixed` |  | `en` | `manual` |
| `X 的工作是什么？` | `default_mixed` |  | `zh` | `manual_translation` |

Do **not** include `attribute_inference` seed rows in the v1 bootstrap set.

Reason:

- `attribute_inference` is out of v1 execution scope
- including those rows would create confusing observability without a runnable
  strategy implementation behind them

Those rows should be added only in v2, together with the actual
`attribute_inference` executor.

### Step 1 retrieval logic

For each incoming query:

1. run vector search over the prototype table,
2. run FTS/keyword search over the prototype table,
3. merge the prototype matches,
4. collect one or more candidate strategy classes.

Step 1 output should include:

- matched strategy class
- score
- source row id
- optional answer-family hint
- language

### Step 1 class-score aggregation

Use the current RRF merge approach across vector and FTS/keyword results, then
aggregate score by strategy class.

For each strategy class:

- `class_score = sum(top 2 merged row scores for that class)`
- `support_count = number of merged prototype rows for that class in top 5`
- `dual_leg_support = true` if that class has evidence from both vector and FTS
  legs

### Step 1 resolution rule

Use explicit thresholds in v1.

If Step 1 produces:

- one clear high-confidence strategy -> use it
- multiple high-confidence compatible strategies -> keep them both
- weak or conflicting result -> unresolved, move to Step 2

High-confidence rule:

- top class has `support_count >= 2` or `dual_leg_support = true`
- and `top_class_score >= second_class_score * 1.20`

Medium-confidence rule:

- top class has at least one valid support row
- and `top_class_score >= second_class_score * 1.08`

Low-confidence rule:

- no valid support row
- or top classes too close
- or vector/FTS evidence conflicts badly

Only medium/high confidence may route directly.
Low confidence must go to Step 2.

This step should be deterministic.

---

### Step 2 — LLM Fallback Strategy Decision

If Step 1 cannot confidently decide, ask an LLM to classify the query into one
or more strategy classes.

The LLM should output structured JSON like:

```json
{
  "strategies": [
    {"name": "set_aggregation", "confidence": 0.82},
    {"name": "count_query", "confidence": 0.34}
  ],
  "entity": "caroline",
  "answer_family": "events"
}
```

### Step 2 prompt template

Suggested system prompt:

```text
You are a recall-strategy classifier.
Classify the user's query into one or more retrieval strategy classes.

Allowed strategy classes:
- exact_event_temporal
- set_aggregation
- count_query
- default_mixed

Rules:
1. Return at most 2 strategies.
2. Only return 2 strategies if both are genuinely useful together.
3. If uncertain, prefer default_mixed.
4. Extract the primary entity when obvious.
5. Extract answer_family when obvious.
6. Return ONLY valid JSON.
```

Suggested user prompt:

```text
Query: <user query>

Return:
{
  "strategies": [
    {"name": "...", "confidence": 0.00}
  ],
  "entity": "...",
  "answer_family": "..."
}
```

Suggested few-shot examples:

```json
{"query":"When did Melanie run a charity race?","output":{"strategies":[{"name":"exact_event_temporal","confidence":0.92}],"entity":"melanie","answer_family":""}}
{"query":"What events has Caroline participated in?","output":{"strategies":[{"name":"set_aggregation","confidence":0.90}],"entity":"caroline","answer_family":"events"}}
{"query":"How many times has Melanie gone to the beach in 2023?","output":{"strategies":[{"name":"count_query","confidence":0.88},{"name":"set_aggregation","confidence":0.61}],"entity":"melanie","answer_family":"counts"}}
{"query":"What is Caroline's job?","output":{"strategies":[{"name":"default_mixed","confidence":0.76}],"entity":"caroline","answer_family":""}}
```

This step should be used only when:

- Step 1 score is below threshold,
- Step 1 top matches disagree,
- or Step 1 yields no valid strategy.

### Step 2 accept / reject rule

The LLM result is accepted only when:

- top returned strategy confidence is `>= 0.70`
- and if a second strategy is returned, its confidence is `>= 0.55`
- and if two incompatible strategies are returned, the confidence gap is
  `>= 0.10`

Otherwise:

- discard Step 2 output
- fall back to `default_mixed`

### Step 2 timeout / latency budget

Recommended v1 rule:

- LLM routing timeout = `500ms`
- timeout or malformed response -> `default_mixed`

### Why this is better than LLM-only routing

- cheaper on average
- more inspectable
- easier to benchmark
- easier to stabilize

The LLM is used for ambiguity resolution, not as the first or only router.

---

### Multi-Strategy Matching

Both Step 1 and Step 2 may return more than one plausible strategy.

This is acceptable because some queries are genuinely hybrid.

Examples:

- a query may be both `set_aggregation` and `count_query`
- a query may look partly `exact_event_temporal` and partly `attribute_inference`

The router should therefore support **multi-label output**, not just a single
winner.

### Fanout rule

If multiple strategies are selected:

- allow fanout to at most **2** strategies,
- reject or collapse anything larger back to the safest top strategy plus
  fallback rules.

This keeps runtime cost and merge complexity bounded.

### Compatibility rule

Strategies can fan out together only if they are operationally compatible.

v1 compatibility matrix:

| strategy A | strategy B | compatible? | v1 action |
|---|---|---|---|
| `set_aggregation` | `count_query` | yes | allow fanout |
| `exact_event_temporal` | anything else | no | keep stronger one or fallback |
| `default_mixed` | anything else | no | treat as fallback only |

So in v1 the only allowed fanout pair is:

- `set_aggregation + count_query`

For all other pairs:

- keep the stronger strategy only,
- or fall back to `default_mixed` if confidence gap is `< 0.10`.

### Deterministic v1 fanout merge

The only allowed v1 fanout pair is:

- `set_aggregation + count_query`

`mergeFanoutResults(...)` should implement:

- `primary = set_aggregation`
- `secondary = count_query`
- `primary_budget = ceil(limit * 0.6)`
- `secondary_budget = limit - primary_budget`
- append up to `primary_budget` rows from `set_aggregation` first
- then append up to `secondary_budget` rows from `count_query`
- dedup by final response identity
- if secondary under-fills, backfill from remaining primary rows
- if primary under-fills, backfill from remaining secondary rows

`total` semantics in v1:

- report `len(final_merged_rows)`

This keeps the merge deterministic and easy to debug.

---

### Final Router Output Contract

The router should produce:

```json
{
  "strategies": [
    {"name": "set_aggregation", "confidence": 0.82},
    {"name": "count_query", "confidence": 0.61}
  ],
  "entity": "caroline",
  "answer_family": "events",
  "resolution_source": "prototype",
  "resolution_mode": "fanout"
}
```

Where:

- `strategies` is the final capped set used by recall
- `entity` is optional but recommended
- `answer_family` is optional but recommended
- `resolution_source` is one of:
  - `prototype`
  - `llm`
  - `fallback`
 - `resolution_mode` is one of:
   - `single`
   - `fanout`
   - `fallback`

Suggested Go contract:

```go
type RecallRouteDecision struct {
    Strategies       []RoutedStrategy
    Entity           string
    AnswerFamily     string
    ResolutionSource string // "prototype" | "llm" | "fallback"
    ResolutionMode   string // "single" | "fanout" | "fallback"
}

type RoutedStrategy struct {
    Name       string
    Confidence float64
}
```

`resolution_source` precedence rule:

- if Step 2 runs and its result is accepted, `resolution_source = "llm"`
- if Step 2 runs and is rejected, `resolution_source = "fallback"`
- if Step 2 does not run and Step 1 is accepted, `resolution_source = "prototype"`

Step 1 candidate details should still be logged for observability even when
Step 2 overrides them.

---

### Fallback Rules

Always preserve a safe fallback.

Rules:

- if Step 1 and Step 2 both fail -> `default_mixed`
- if confidence is below threshold -> `default_mixed`
- if top strategies are incompatible and confidence gap is `< 0.10` -> `default_mixed`
- if fanout exceeds 2 -> truncate or fall back

This is critical for production safety.

---

## Routing Contract

The concrete v1 implementation uses **only** the final multi-strategy output
contract above.

The earlier single-strategy shape is not part of the v1 contract and should not
be implemented.

---

## Mapping to Existing Recall Paths

### `exact_event_temporal`

Use:

- explicit-session session-first branch when `session_id != ""`,
- event-fact rerank/boost,
- time-bearing rerank,
- no neighbor expansion in explicit-session mode.

### `set_aggregation`

Use:

- explicit-session session-first branch when possible,
- Cat1 entity-/family-aware reranking,
- coverage-aware final selection.

### `count_query`

Use:

- explicit-session session-first branch when possible,
- numeric/time-focused reranking,
- no diversity step unless the count evidence is obviously fragmented.

Concrete v1 `count_query` algorithm:

- boost rows with explicit numbers by `+0.35`
- boost rows with bounded list/count language (`twice`, `three`, `several`,
  comma-separated short enumerations) by `+0.20`
- if the query contains a time bound, boost rows with matching date/time
  signals by `+0.15`
- penalize generic biography/preference rows by `-0.20`
- keep top numeric rows first
- allow at most `2` supporting rows that reinforce the same count or bound
- do **not** apply Cat1 coverage diversity selection by default

### `attribute_inference`

Use:

- broader evidence pool,
- default mixed path plus optional adaptive widening,
- avoid overly narrow exact-event routing.

Note:

- `attribute_inference` is out of v1 execution scope
- this mapping remains here as a v2 contract placeholder only

### `default_mixed`

Use:

- current default mixed memory recall unchanged.

---

## v1 Execution Model

For v1, strategy execution should stay at the handler layer.

Reason:

- routing is request-policy logic, not low-level storage logic,
- the handler already owns:
  - filter parsing,
  - explicit-session vs mixed-path branching,
  - merge/fallback behavior,
- this keeps the rollback surface small.

### Handler integration point

Run the router in `listMemories()`:

1. parse request params,
2. build `domain.MemoryFilter`,
3. apply hard caller overrides such as `memory_type=session`,
4. run strategy detection,
5. dispatch one or two strategy executors,
6. merge or fallback,
7. emit the final response.

### v1 helper set

The concrete helper set for v1 should be:

- `detectRecallStrategies(...)`
- `executeDefaultMixed(...)`
- `executeExactEventTemporal(...)`
- `executeSetAggregation(...)`
- `executeCountQuery(...)`
- `executeRoutedStrategy(...)`
- `mergeFanoutResults(...)`
- `executeWithFallback(...)`

### `detectRecallStrategies(...)`

Purpose:

- run prototype-table detection,
- optionally run LLM fallback,
- return one or two strategies plus optional entity/family hints.

Suggested shape:

```go
func (s *Server) detectRecallStrategies(
    ctx context.Context,
    auth *domain.AuthInfo,
    filter domain.MemoryFilter,
) (RecallRouteDecision, error)
```

### `executeDefaultMixed(...)`

Purpose:

- wrap the current default behavior.

Suggested shape:

```go
func (s *Server) executeDefaultMixed(
    ctx context.Context,
    auth *domain.AuthInfo,
    svc resolvedSvc,
    filter domain.MemoryFilter,
) ([]domain.Memory, int, error)
```

### `executeExactEventTemporal(...)`

Purpose:

- run the exact event/date path.

Suggested shape:

```go
func (s *Server) executeExactEventTemporal(
    ctx context.Context,
    auth *domain.AuthInfo,
    svc resolvedSvc,
    filter domain.MemoryFilter,
    entity string,
) ([]domain.Memory, int, error)
```

Behavior:

- if `session_id != ""`, reuse the explicit-session session-first path
- otherwise reuse default mixed with current event/date-aware behavior

### `executeSetAggregation(...)`

Purpose:

- run the Cat1 set/list path.

Suggested shape:

```go
func (s *Server) executeSetAggregation(
    ctx context.Context,
    auth *domain.AuthInfo,
    svc resolvedSvc,
    filter domain.MemoryFilter,
    entity string,
    answerFamily string,
) ([]domain.Memory, int, error)
```

Behavior:

- if `session_id != ""`
  - explicit-session session-first retrieval
  - Cat1 entity-/family-aware reranking
  - coverage-aware final selection
- otherwise fallback to `default_mixed` in v1

### `executeCountQuery(...)`

Purpose:

- run the numeric/count path.

Suggested shape:

```go
func (s *Server) executeCountQuery(
    ctx context.Context,
    auth *domain.AuthInfo,
    svc resolvedSvc,
    filter domain.MemoryFilter,
    entity string,
    answerFamily string,
) ([]domain.Memory, int, error)
```

Behavior:

- if `session_id != ""`
  - explicit-session session-first retrieval
  - numeric/count-specific rerank
- otherwise fallback to `default_mixed` in v1

### `executeRoutedStrategy(...)`

Purpose:

- dispatch a strategy name to the correct executor.

Suggested shape:

```go
func (s *Server) executeRoutedStrategy(
    ctx context.Context,
    auth *domain.AuthInfo,
    svc resolvedSvc,
    filter domain.MemoryFilter,
    strategy RoutedStrategy,
    entity string,
    answerFamily string,
) ([]domain.Memory, int, error)
```

### `mergeFanoutResults(...)`

Purpose:

- merge two successful strategy result sets.

v1 rule:

- only used for the compatible pair `set_aggregation + count_query`
- use ratio-based ordered concatenation
- dedup and backfill
- do **not** do weighted cross-strategy score fusion in v1

Suggested shape:

```go
func mergeFanoutResults(
    primary []domain.Memory,
    secondary []domain.Memory,
    primaryStrategy string,
    secondaryStrategy string,
    limit int,
) []domain.Memory
```

### `executeWithFallback(...)`

Purpose:

- centralize the v1 fallback behavior.

Suggested shape:

```go
func (s *Server) executeWithFallback(
    ctx context.Context,
    auth *domain.AuthInfo,
    svc resolvedSvc,
    filter domain.MemoryFilter,
    decision RecallRouteDecision,
) ([]domain.Memory, int, error)
```

Behavior:

- unresolved router -> `default_mixed`
- one strategy -> run it, fallback if needed
- two strategies -> fanout, merge, fallback if both fail

### v1 hard rule

Use **structural fallback only** in v1:

- unresolved router -> fallback
- executor error -> fallback
- zero-row result -> fallback
- one surviving fanout branch may stand on its own

Do not add semantic insufficiency fallback yet.

### Existing query-shape rerank reuse

The existing `classifyGroundingAnswerShape` / `rerankGroundedMemories` logic is
**not** replaced by the router in v1.

Instead:

- the router selects the high-level strategy path,
- existing query-shape rerank helpers continue to operate inside the chosen
  executor where they already make sense.

---

## Suggested Implementation Order

### Phase 1

Implement prototype-table routing for:

- `exact_event_temporal`
- `set_aggregation`
- `count_query`
- fallback to `default_mixed`
- LLM fallback for ambiguous / low-confidence cases

Keep `attribute_inference` out of execution scope in this phase.

Phase 1 concrete task breakdown:

1. add control-plane DDL for `recall_strategy_prototypes`
2. add initial seed data for the bootstrap prototype set
3. implement `RecallStrategyPrototypeRepo`
4. implement `RecallStrategyRouterService` Step 1 detection
5. implement `detectRecallStrategies(...)` in the handler
6. implement `executeDefaultMixed(...)`
7. implement `executeExactEventTemporal(...)`
8. implement `executeSetAggregation(...)`
9. implement `executeCountQuery(...)`
10. implement `executeRoutedStrategy(...)`
11. implement `mergeFanoutResults(...)`
12. implement `executeWithFallback(...)`
13. add observability logs/counters
14. run offline routing audit and retrieval-only benchmark

### Phase 2

Tune and expand:

- prototype coverage,
- thresholds and confidence margins,
- prompt examples for LLM fallback,
- observability and routing audit quality.

### Phase 3

Add `attribute_inference` once the first router version is stable.

---

## Evaluation Plan

### Stage A — Offline routing audit

On LoCoMo queries:

- classify each query into a strategy,
- inspect whether the assigned strategy matches the actual failure mode.

Measure:

- strategy distribution,
- ambiguous/fallback rate.

### Stage B — Retrieval-only comparison

On fixed ingested tenants:

- baseline current retrieval,
- strategy router enabled.

Measure:

- Cat1 LLM / token-F1,
- Cat2 LLM / token-F1,
- Cat3 LLM / token-F1,
- per-strategy trigger rate,
- fallback rate,
- latency impact.

---

## Observability Requirements

Observability is mandatory in v1.

Require:

- structured log for chosen strategy decision
- structured log for fallback cause
- structured log for fanout use
- counters for:
  - chosen strategy
  - resolution source
  - resolution mode
  - fallback cause
  - fanout pair

Recommended per-request fields:

- query length
- session_id present or not
- chosen strategies
- confidence values
- prototype top row ids
- fallback reason

### Stage C — End-to-end comparison

After retrieval-only validation:

- rerun full `messages`-mode LoCoMo,
- compare to the latest production-relevant baseline.

---

## Will This Really Help?

My evaluation:

- **yes**, likely for Cat2 and some Cat3
- **yes**, likely for Cat1 if combined with the Cat1 rerank proposal
- **no**, not enough alone if the downstream strategy implementation remains weak

The router only helps if the strategies it selects are actually distinct and
useful.

So the value is:

- reducing strategy mismatch,
- not replacing the need for good specialized recall paths.

The biggest likely win is:

- stop sending Cat1-style set queries through essentially Cat2-style exact-hit
  retrieval.

---

## Risks

### Risk: category overfitting

If the router is built directly from LoCoMo labels, it may not generalize.

Mitigation:

- use strategy classes, not benchmark categories.

### Risk: wrong routing hurts recall

Specialized paths can be worse than default when misapplied.

Mitigation:

- confidence threshold,
- fallback to `default_mixed`,
- conservative rollout.

### Risk: complexity explosion

Too many strategy classes too early will be hard to evaluate.

Mitigation:

- start with 3-4 classes,
- instrument trigger rates,
- expand only when needed.

---

## Recommendation

This approach is worth trying.

Recommended next move:

1. implement the prototype-table strategy router in control-plane MetaDB,
2. route into the already-implemented explicit-session/event paths and the
   proposed Cat1 rerank path,
3. keep a default fallback,
4. include LLM fallback in v1 for ambiguous / low-confidence cases,
5. evaluate on LoCoMo before adding `attribute_inference`.

This is the clearest path if the goal is:

- no single recall strategy for all query types,
- but a stable way to choose among multiple stronger specialized strategies.
