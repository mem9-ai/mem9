---
title: "Proposal: LLM-generated tags on reconcile-written memories"
---

## Background

The reconcile pipeline (`ingest.go:reconcile`) today writes new and updated insight
memories with `Tags: nil`. The `Tags []string` field already exists on `domain.Memory`
and is stored/indexed in TiDB, but nothing populates it for auto-generated insights.
This means all insights created by the ingest pipeline are invisible to tag-based
filtering and browsing in the API.

**Acceptance criterion**: After this change, all write paths through `addInsight` and
`updateInsight` are tag-enabled — LLM-provided tags are persisted when the model
supplies them. If the model omits tags on a given event, the memory is written
tag-less; this is valid behavior and not a failure.

---

## Design: Two Tag Sources, Zero Extra LLM Calls

The ingest pipeline makes two LLM calls. Both are extended:

| Call | Function | Extended to return | Used for |
|---|---|---|---|
| Call #1 | `extractFacts` / `extractFactsAndTags` | Per-fact tags alongside each extracted fact | Cold-start `addAllFacts` only |
| Call #2 | reconcile LLM | `tags` field on every ADD/UPDATE event | ADD, UPDATE, pinned fallback |

**Why two sources?**

- Call #2 supplies tags for ADD and UPDATE — the reconcile LLM assigns tags directly
  to the final memory content (`event.Tags`), so no text-matching map is needed. This
  is reliable for both ADD (exact or paraphrased) and UPDATE (synthesized content).
- Call #2 does not run on cold-start (`addAllFacts` path, when
  `len(existingMemories) == 0`). Call #1 must supply tags for cold-start.

**Call sites summary:**

```
ADD                    -> event.Tags  (call #2)
UPDATE normal          -> event.Tags  (call #2)
UPDATE pinned fallback -> event.Tags  (call #2)
addAllFacts cold-start -> fact.Tags   (call #1)
```

**`gatherExistingMemories` wiring**: `gatherExistingMemories` is unchanged — it takes
`[]string` (fact texts). After `reconcile()` receives `[]ExtractedFact`, fact texts are
projected to `[]string` before being passed to `gatherExistingMemories`:

```go
texts := make([]string, len(facts))
for i, f := range facts {
    texts[i] = f.Text
}
existingMemories, gatherErr := s.gatherExistingMemories(ctx, agentID, texts)
```

**Duplicate cold-start facts**: if call #1 extracts two facts with identical `Text`
from the same conversation, both are written independently by `addAllFacts` — one
memory per fact. Deduplication of identical fact texts is handled upstream by the
reconcile LLM (which would NOOP the second occurrence); `addAllFacts` only runs when
there are no existing memories, making true duplicates a degenerate model output.

---

## What Changes

### 1. New type: `ExtractedFact` (ingest.go)

```go
// ExtractedFact holds a single atomic fact and the tags the LLM assigned to it.
type ExtractedFact struct {
    Text string   `json:"text"`
    Tags []string `json:"tags,omitempty"`
}
```

Defined at package level, used across `extractFacts`, `extractFactsAndTags`,
`extractAndReconcile`, `ReconcileContent`, `ReconcilePhase2`, `reconcile`,
and `addAllFacts`.

---

### 2. `extractFacts` — prompt and return type (ingest.go:347)

**Signature change:**

```go
// Before
func (s *IngestService) extractFacts(ctx context.Context, conversation string) ([]string, error)

// After
func (s *IngestService) extractFacts(ctx context.Context, conversation string) ([]ExtractedFact, error)
```

**Prompt change** — fold tag rules into the existing `## Rules` section and update
the output format:

Add to the end of `## Rules`:

```
8. Assign 1-3 short lowercase tags to each extracted fact describing its topic or
   category. Examples: "tech", "personal", "preference", "work", "location", "habit".
   Use hyphens for multi-word tags: "programming-language", "work-tool".
   If no meaningful tags apply, omit the "tags" field for that fact.
```

Updated output format:

```
{"facts": [{"text": "fact one", "tags": ["tag1", "tag2"]}, {"text": "fact two", "tags": ["tag3"]}, ...]}
```

Updated response struct:

```go
type extractResponse struct {
    Facts []ExtractedFact `json:"facts"`
}
```

Post-processing: trim whitespace on `f.Text`, skip empty. Tags carried as-is (clamped
later in `addInsight`/`updateInsight`).

---

### 3. `extractFactsAndTags` — prompt and return type (ingest.go:413)

This function already returns `facts []string` and `message_tags [][]string`. Extended
to return facts as `[]ExtractedFact` carrying per-fact tags. `message_tags` unchanged.

**Signature change:**

```go
// Before
func (s *IngestService) extractFactsAndTags(ctx context.Context, conversation string, messageCount int) ([]string, [][]string, error)

// After
func (s *IngestService) extractFactsAndTags(ctx context.Context, conversation string, messageCount int) ([]ExtractedFact, [][]string, error)
```

**Prompt change** — fold fact tag rules into `## Rules — facts`:

Add to the end of `## Rules — facts`:

```
8. Assign 1-3 short lowercase tags to each extracted fact describing its topic or
   category. Examples: "tech", "personal", "preference", "work", "location", "habit".
   Use hyphens for multi-word tags. If no meaningful tags apply, omit the "tags" field.
```

Updated output format (`message_tags` unchanged; `facts` becomes objects):

```json
{
  "facts": [{"text": "fact one", "tags": ["tag1"]}, {"text": "fact two", "tags": ["tag2", "tag3"]}],
  "message_tags": [["tag1", "tag2"], ["tag3"], ...]
}
```

Updated examples (all three existing examples updated to show fact objects):

```
Input:
User: Hi, how are you?
Assistant: I'm doing well, thank you! How can I help?
Output: {"facts": [], "message_tags": [[], []]}

Input:
User: My name is Ming Zhang, I am a backend engineer, mainly using Go and Python.
Assistant: Hi Ming Zhang!
Output: {"facts": [{"text": "Name is Ming Zhang", "tags": ["personal"]}, {"text": "Is a backend engineer", "tags": ["work"]}, {"text": "Mainly uses Go and Python", "tags": ["tech"]}], "message_tags": [["personal", "work", "tech"], ["answer"]]}

Input:
User: I'm debugging a memory leak in our Go service.
Assistant: Let's look at the heap profile. Can you share the pprof output?
User: Here it is: [pprof data...]
Output: {"facts": [{"text": "Debugging a memory leak in a Go service", "tags": ["tech", "debug"]}], "message_tags": [["tech", "debug", "go"], ["tech", "question", "debug"], ["tech", "tool-result", "code"]]}
```

Updated `## Output Format` line:

```
{"facts": [{"text": "fact one", "tags": ["tag1", "tag2"]}, {"text": "fact two", "tags": ["tag3"]}], "message_tags": [["tag1", "tag2"], ["tag3"], [], ...]}
```

Updated response struct:

```go
type extractResponse struct {
    Facts       []ExtractedFact `json:"facts"`
    MessageTags [][]string      `json:"message_tags"`
}
```

---

### 4. `Phase1Result` and `ExtractPhase1` (ingest.go:139)

```go
// Before
type Phase1Result struct {
    Facts       []string
    MessageTags [][]string
}

// After
type Phase1Result struct {
    Facts       []ExtractedFact  // text + per-fact tags from call #1
    MessageTags [][]string       // per-message tags, unchanged
}
```

`ExtractPhase1` passes the `[]ExtractedFact` return from `extractFactsAndTags`
directly into `Phase1Result.Facts`. No other logic change.

---

### 5. `ReconcilePhase2` (ingest.go:168)

**Signature change:**

```go
// Before
func (s *IngestService) ReconcilePhase2(ctx context.Context, agentName, agentID, sessionID string, facts []string) (*IngestResult, error)

// After
func (s *IngestService) ReconcilePhase2(ctx context.Context, agentName, agentID, sessionID string, facts []ExtractedFact) (*IngestResult, error)
```

Passes `[]ExtractedFact` directly to `reconcile()`. Handler call site
(`handler/memory.go:89`) passes `phase1.Facts` which is now `[]ExtractedFact` —
no handler logic change needed.

---

### 6. `extractAndReconcile` (ingest.go:322)

Receives `[]ExtractedFact` from `extractFacts`. Cap logic unchanged. Passes
`[]ExtractedFact` to `reconcile`.

---

### 7. `ReconcileContent` (ingest.go:194)

Calls `extractFacts` in a loop. Accumulates `[]ExtractedFact` instead of `[]string`.
Passes `[]ExtractedFact` to `reconcile`.

---

### 8. Reconcile system prompt — tags section (ingest.go:551)

Add a `## Tags` section before `## Output Format`, and update all examples that
contain ADD or UPDATE to include the `tags` field. NOOP and DELETE entries omit it.

```
## Tags

Assign 1-3 short lowercase tags to each ADD or UPDATE entry.
Tags describe the topic or category of the memory.
Examples: "tech", "personal", "preference", "work", "location", "habit"
Use hyphens for multi-word tags: "programming-language", "work-tool".
Omit the "tags" field entirely for NOOP and DELETE entries.
```

Updated examples (Result lines only; inputs unchanged):

```
Example 1 - ADD:
  {"memory": [{"id": "0", "text": "Is a software engineer", "event": "NOOP"},
              {"id": "new", "text": "Name is John", "event": "ADD", "tags": ["personal"]}]}

Example 2 - UPDATE:
  {"memory": [{"id": "0", "text": "Loves to play cricket with friends on weekends",
               "event": "UPDATE", "old_memory": "Likes to play cricket", "tags": ["personal", "habit"]},
              {"id": "1", "text": "Is a software engineer", "event": "NOOP"}]}

Example 3 - DELETE + ADD:
  {"memory": [{"id": "0", "text": "Name is John", "event": "NOOP"},
              {"id": "1", "text": "Loves cheese pizza", "event": "DELETE"},
              {"id": "new", "text": "Dislikes cheese pizza", "event": "ADD", "tags": ["personal", "preference"]}]}

Example 4 - NOOP only: (unchanged)

Example 5 - UPDATE age tiebreaker:
  {"memory": [{"id": "0", "text": "Prefers VS Code", "event": "UPDATE",
               "old_memory": "Prefers vim", "tags": ["tech", "preference"]},
              {"id": "1", "text": "Works at company Y", "event": "UPDATE",
               "old_memory": "Works at startup X", "tags": ["work"]}]}

Example 6 - NOOP only: (unchanged)
```

Updated `## Output Format` skeleton:

```json
{
  "memory": [
    {"id": "0",   "text": "...",            "event": "NOOP"},
    {"id": "1",   "text": "updated text",   "event": "UPDATE", "old_memory": "original text", "tags": ["work"]},
    {"id": "2",   "text": "...",            "event": "DELETE"},
    {"id": "new", "text": "brand new fact", "event": "ADD",    "tags": ["tech"]}
  ]
}
```

---

### 9. `reconcileEvent` struct (ingest.go:632)

```go
// Before
type reconcileEvent struct {
    ID        string `json:"id"`
    Text      string `json:"text"`
    Event     string `json:"event"`
    OldMemory string `json:"old_memory,omitempty"`
}

// After
type reconcileEvent struct {
    ID        string   `json:"id"`
    Text      string   `json:"text"`
    Event     string   `json:"event"`
    OldMemory string   `json:"old_memory,omitempty"`
    Tags      []string `json:"tags,omitempty"`  // NEW — from call #2, used for ADD and UPDATE
}
```

`omitempty` ensures backward compatibility: if the model omits tags the field
deserialises to `nil` and the write proceeds tag-less.

---

### 10. `reconcile` — tag lookup and call sites (ingest.go:516)

**Signature change:**

```go
// Before
func (s *IngestService) reconcile(ctx context.Context, agentName, agentID, sessionID string, facts []string) ([]string, int, error)

// After
func (s *IngestService) reconcile(ctx context.Context, agentName, agentID, sessionID string, facts []ExtractedFact) ([]string, int, error)
```

**LLM prompt construction** — project fact texts for both `gatherExistingMemories`
and the reconcile LLM (tags are internal, not sent to either):

```go
texts := make([]string, len(facts))
for i, f := range facts {
    texts[i] = f.Text
}
existingMemories, gatherErr := s.gatherExistingMemories(ctx, agentID, texts)
// ... (early return if empty -> addAllFacts)
factsJSON, _ := json.Marshal(texts)
```

**ADD call site** (ingest.go:668) — uses call #2 tags:

```go
newID, addErr := s.addInsight(ctx, agentName, agentID, sessionID, event.Text, event.Tags)
```

**UPDATE — pinned fallback** (ingest.go:690) — uses `effectiveTags`:

```go
newID, addErr := s.addInsight(ctx, agentName, agentID, sessionID, event.Text, effectiveTags)
```

**UPDATE — normal path** (ingest.go:699) — uses `effectiveTags`:

```go
newID, updateErr := s.updateInsight(ctx, agentName, agentID, sessionID, realID, event.Text, effectiveTags)
```

**Tag preservation on omission** — for UPDATE and pinned fallback, `effectiveTags` is
computed before the call sites to preserve existing tags when the reconcile LLM omits
the `tags` field:

```go
effectiveTags := event.Tags
if effectiveTags == nil {
    effectiveTags = existingMemories[intID].Tags
}
```

This means: if the reconcile LLM emits `tags`, those tags are written. If it omits
`tags`, the existing memory's tags are carried forward to the new version. This is
better UX than silently erasing prior tags on every UPDATE.

For ADD, `event.Tags` is used directly (no fallback — there is no prior memory to
inherit from).

All three cases use `event.Tags` / `effectiveTags` from call #2. No `tagsFor` map
needed.

---

### 11. `addAllFacts` (ingest.go:877)

**Signature change:**

```go
// Before
func (s *IngestService) addAllFacts(ctx context.Context, agentName, agentID, sessionID string, facts []string) ([]string, int, error)

// After
func (s *IngestService) addAllFacts(ctx context.Context, agentName, agentID, sessionID string, facts []ExtractedFact) ([]string, int, error)
```

```go
for _, fact := range facts {
    id, err := s.addInsight(ctx, agentName, agentID, sessionID, fact.Text, fact.Tags)
    ...
}
```

Cold-start memories are now tagged. No second LLM call needed.

---

### 12. `addInsight` and `updateInsight` (ingest.go:893, 926)

```go
// Before
func (s *IngestService) addInsight(ctx context.Context, agentName, agentID, sessionID, content string) (string, error)
func (s *IngestService) updateInsight(ctx context.Context, agentName, agentID, sessionID, oldID, newContent string) (string, error)

// After
func (s *IngestService) addInsight(ctx context.Context, agentName, agentID, sessionID, content string, tags []string) (string, error)
func (s *IngestService) updateInsight(ctx context.Context, agentName, agentID, sessionID, oldID, newContent string, tags []string) (string, error)
```

Both clamp then set `m.Tags = tags`. For `updateInsight`, tags are set on `m` before
`ArchiveAndCreate` — repo signature unchanged.

---

## Tag Validation

`maxTags = 20` at `memory.go:22`. Both `addInsight` and `updateInsight` clamp silently
before constructing `domain.Memory`:

```go
if len(tags) > maxTags {
    tags = tags[:maxTags]
}
```

---

## What Does NOT Change

| Thing | Reason |
|---|---|
| `domain.Memory.Tags` field | Already exists at `types.go:35` |
| DB schema / SQL | Tags stored as JSON array; `Create` already writes them |
| `ArchiveAndCreate` signature | Tags carried on `domain.Memory`, not passed separately |
| `MemoryService.Create` / `Update` | User-facing write paths unaffected |
| Handler (`memory.go`) | `phase1.Facts` type changes; no logic change needed |

---

## Tests to Add (`ingest_test.go`)

All tests follow the existing two-call `httptest.NewServer` mock pattern.

| Test | Path | What it verifies |
|---|---|---|
| `TestExtractFactsReturnsTags` | `extractFacts` | LLM returns `{"facts":[{"text":"Uses Go","tags":["tech"]}]}` -> `facts[0].Tags == ["tech"]` |
| `TestExtractFactsTagsOmitted` | `extractFacts` | LLM omits `tags` field -> `facts[0].Tags` is nil, no error |
| `TestExtractPhase1FactTagsPopulated` | `extractFactsAndTags` / `ExtractPhase1` | LLM returns facts with tags + message_tags -> `phase1.Facts[0].Tags == ["tech"]` and `phase1.MessageTags` still correct |
| `TestColdStartAddAllFactsSetsTags` | `addAllFacts` | No existing memories; call #1 returns fact with `["tech"]` -> `createCalls[0].Tags == ["tech"]` |
| `TestReconcileAddSetsTagsOnMemory` | `reconcile` ADD | Reconcile LLM says ADD with `"tags":["tech","work"]` on event -> `createCalls[0].Tags == ["tech","work"]` |
| `TestReconcileUpdateSetsTagsOnMemory` | `reconcile` UPDATE | Reconcile LLM says UPDATE with `"tags":["work"]` on event -> `createCalls[0].Tags == ["work"]` |
| `TestReconcileUpdateTagsOmitted` | `reconcile` UPDATE | Reconcile LLM omits `tags` on UPDATE -> `createCalls[0].Tags` is nil, no error |
| `TestReconcileTagsOmittedGracefully` | `reconcile` ADD | Reconcile LLM omits `tags` on ADD -> `createCalls[0].Tags` is nil, no error, no warning |
| `TestReconcileTagsClamped` | `addInsight` | Call #1 returns fact with 25 tags -> `createCalls[0].Tags` has exactly 20 entries |
| `TestReconcilePinnedFallbackCarriesTags` | `reconcile` UPDATE->ADD | Reconcile LLM emits UPDATE on pinned memory with `"tags":["tech"]`; fallback ADD carries `event.Tags` -> `createCalls[0].Tags == ["tech"]` |

---

## Files to Change

| File | Change |
|---|---|
| `server/internal/service/ingest.go` | New `ExtractedFact` type; `extractFacts` prompt + return type; `extractFactsAndTags` prompt + examples + return type; `Phase1Result.Facts` type; `ExtractPhase1` wiring; `ReconcilePhase2` + `extractAndReconcile` + `ReconcileContent` signatures; reconcile prompt `## Tags` section + all examples; `reconcileEvent` struct; `reconcile` signature + text projection + call sites (all use `event.Tags`); `addAllFacts` signature; `addInsight`/`updateInsight` signatures + clamp |
| `server/internal/service/ingest_test.go` | 10 new tests |

---

## Effort Estimate

~**200-230 LoC** net (production code ~130 LoC, tests ~80 LoC). Single file pair,
no schema migration, no new dependencies.
