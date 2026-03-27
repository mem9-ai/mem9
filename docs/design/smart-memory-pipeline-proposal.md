---
title: "Smart Memory Pipeline — Fact Extraction, Session Digest & Recall Optimization"
status: partially-implemented
created: 2026-03-06
last_updated: 2026-03-25
---

> **STATUS: PARTIALLY IMPLEMENTED**
>
> **Implemented:**
> - `memory_type` column (`pinned`, `insight`) and `MemoryType`/`MemoryState`
>   domain types (`active`, `paused`, `archived`, `deleted`)
> - `state` column replacing `tombstone` (soft-delete via `SoftDelete`)
> - `agent_id`, `session_id`, `superseded_by` columns
> - Two-phase ingest pipeline: `ExtractPhase1` (fact extraction) +
>   `ReconcilePhase2` (vector search + LLM reconcile + archive model)
> - `POST /memories` with `messages` payload; ingest modes (`smart`, `raw`, etc.)
> - Memory-type weighted scoring after RRF (`applyTypeWeights`)
> - `RelativeAge` field on search results
>
> **Not implemented:**
> - `TypeDigest` (`"digest"`) — the domain only has `TypePinned` and `TypeInsight`;
>   session digests were folded into the raw session storage proposal instead
> - Digest auto-archival background job (Phase 4)
> - `paused`/`archived` state transitions via `PUT /memories/:id`

# Proposal: Smart Memory Pipeline — Fact Extraction, Session Digest & Recall Optimization

**Date**: 2026-03-06 (revised 2026-03-06 post-review)
**Purpose**: Design the intelligent auto-capture pipeline for mnemos — extracting atomic facts, generating session digests, and optimizing recall accuracy through a two-phase LLM pipeline.
**Review status**: Addressing 4 blockers + 4 concerns from cross-validated review.

---

## 1. Problem Statement

mnemos currently stores memories as raw text blobs via `agent_end` hook. This leads to:

- **Low recall precision**: Vector search on long raw text (~2000 chars) returns noisy results
- **Duplicate facts**: "User prefers Go" stored repeatedly across sessions
- **Stale knowledge**: Old preferences never updated ("Uses Go 1.21" → "Uses Go 1.22")
- **Wasted context window**: Injecting raw sessions burns tokens vs. injecting atomic facts

**Goal**: Maximize recall accuracy by storing LLM-extracted atomic facts + session digests, with intelligent deduplication and update.

---

## 2. Memory Type Classification

All memories live in ONE table (`memories`), differentiated by a **new `memory_type` column**. Three types:

> **Note**: The existing `source` column (currently storing agent name as provenance) is **preserved unchanged**. `memory_type` is a new field for classification.

### Type Enum: `MemoryType`

| Value | Name | Description | Created By | Typical Length | Example |
|-------|------|-------------|------------|----------------|---------|
| `pinned` | Pinned Memory | User-explicitly stored long-term preference or fact | User via `memory_store` tool | 10-200 chars | "Always use gRPC for service communication" |
| `insight` | Extracted Insight | LLM-extracted atomic fact from conversation | Server pipeline (Phase 1) | 10-100 chars | "Prefers Go over Python" |
| `digest` | Session Digest | LLM-generated session summary capturing key context | Server pipeline (post agent_end) | 100-500 chars | "Debugged OOM in TiKV coprocessor; root cause was unbounded batch size; fixed by adding configurable limit" |

**Why `memory_type` instead of repurposing `source`?**
- `source` currently stores agent name (provenance: "who wrote this memory") — used in filters, plugin tools, and 3 plugins
- Repurposing `source` would be a **breaking semantic change** across server + plugins
- `memory_type` provides clean separation: **provenance** (`source`) vs **classification** (`memory_type`)
- Zero migration needed for existing records — `memory_type` defaults to `pinned`

**Why these names?**
- `pinned` — deliberate, user-initiated, long-term. Like pinning a message.
- `insight` — derived knowledge extracted by intelligence. Not raw data.
- `digest` — industry-standard term for condensed summary (email digest, news digest).

### Type Lifecycle

```
agent_end fires with messages
        │
        ▼
Plugin formats & POSTs to mnemo-server
  POST /api/memories/ingest { messages: [...], session_id: "..." }
        │
        ▼
Server Pipeline runs:
        │
        ├── 1. Generate session digest → store as memory_type="digest"
        │
        └── 2. Extract atomic insights → for each:
                ├── Vector search existing insights
                ├── LLM decides: ADD / UPDATE / DELETE / NOOP
                └── Execute decisions → memory_type="insight"

Meanwhile:
  User calls memory_store tool → stored directly as memory_type="pinned"
```

---

## 3. Memory State Machine

### State Enum: `MemoryState`

```
                    ┌──────────────────────────┐
                    │                          │
   create ──▶  [ active ] ──── pause ────▶ [ paused ]
                    │                          │
                    │                     resume │
                    │                          │
                    │          ◀────────────────┘
                    │
                archive                  (auto or manual)
                    │
                    ▼
              [ archived ] ────── restore ────▶ [ active ]
                    │
                 delete
                    │
                    ▼
              [ deleted ]    (soft delete, retained for audit)
```

| State | Visible in Recall? | Description |
|-------|-------------------|-------------|
| `active` | ✅ Yes | Default state. Participates in search and prompt injection. |
| `paused` | ❌ No | Temporarily hidden. User can pause a memory without deleting it (e.g., "I'm not using Go right now"). |
| `archived` | ❌ No | Historical record. Auto-archived when superseded by UPDATE, or manually by user. Retained for audit trail. |
| `deleted` | ❌ No | Soft delete. `updated_at` records when deletion occurred. Can be purged by background job after retention period. |

---

## 4. Tombstone → State Migration (4-Step Plan)

The existing `tombstone TINYINT(1)` column (27 occurrences in repository layer) must be migrated to `state VARCHAR(20)`.

### SQL Migration Steps

```sql
-- Step 1: Add state column with default (backward compatible — existing code still uses tombstone)
ALTER TABLE memories ADD COLUMN state VARCHAR(20) NOT NULL DEFAULT 'active';

-- Step 2: Migrate tombstoned records
UPDATE memories SET state = 'deleted' WHERE tombstone = 1;

-- Step 3: Add constraint (AFTER all code is updated to use state instead of tombstone)
ALTER TABLE memories ADD CONSTRAINT chk_state 
  CHECK (state IN ('active', 'paused', 'archived', 'deleted'));

-- Step 4: Drop tombstone column (AFTER verification — separate deployment)
ALTER TABLE memories DROP COLUMN tombstone;
```

### Code Migration Order

1. **Step 1-2**: Run SQL migration (safe — no code changes needed, tombstone still works)
2. **Update repository layer**: Replace all 27 `tombstone = 0` → `state = 'active'`, `tombstone = 1` → `state = 'deleted'`
3. **Update service layer**: `SoftDelete` sets `state = 'deleted'` instead of `tombstone = 1`
4. **Update domain types**: Remove `Tombstone bool`, add `State MemoryState`
5. **Verify**: Run full test suite, confirm all queries work with `state`
6. **Step 3**: Add CHECK constraint
7. **Step 4**: Drop `tombstone` column (separate deployment, after bake period)

**Rollback**: If anything fails before Step 4, revert code changes — `tombstone` column still exists and works.

---

## 5. Table Schema (Evolution of `memories`)

### New Columns (added to existing table)

```sql
ALTER TABLE memories
  -- Classification (NEW — does NOT replace source)
  ADD COLUMN memory_type  VARCHAR(20)   NOT NULL DEFAULT 'pinned'
                          COMMENT 'pinned|insight|digest — memory classification',

  -- Agent & session tracking
  ADD COLUMN agent_id     VARCHAR(100)  NULL        COMMENT 'Agent that created this memory',
  ADD COLUMN session_id   VARCHAR(100)  NULL        COMMENT 'Session this memory originated from',

  -- State machine (replaces tombstone — see Section 4 for migration)
  ADD COLUMN state        VARCHAR(20)   NOT NULL DEFAULT 'active'
                          COMMENT 'Memory lifecycle: active|paused|archived|deleted',

  -- Archive lineage
  ADD COLUMN superseded_by VARCHAR(36)  NULL     COMMENT 'ID of the memory that replaced this one (set on archive)';

  -- New indexes (no space_id prefix — dedicated tenant model)
CREATE INDEX idx_memory_type ON memories(memory_type);
CREATE INDEX idx_state       ON memories(state);
CREATE INDEX idx_agent       ON memories(agent_id);
CREATE INDEX idx_session     ON memories(session_id);
```

> **Note**: `archived_at` and `deleted_at` columns were removed during implementation. The `state` column + `updated_at` timestamp is sufficient — `updated_at` records when the state transition happened.

### Full Schema (tenant data plane — per-tenant TiDB Serverless)

```sql
CREATE TABLE IF NOT EXISTS memories (
  -- Identity
  id              VARCHAR(36)     PRIMARY KEY,

  -- Content
  content         TEXT            NOT NULL,
  embedding       VECTOR(1536)    NULL,

  -- Classification
  memory_type     VARCHAR(20)     NOT NULL DEFAULT 'pinned'
                  COMMENT 'pinned|insight|digest',

  -- Provenance (source stores agent name)
  source          VARCHAR(100),
  tags            JSON,
  metadata        JSON,
  agent_id        VARCHAR(100)    NULL     COMMENT 'Agent that created this memory',
  session_id      VARCHAR(100)    NULL     COMMENT 'Session this memory originated from',
  updated_by      VARCHAR(100),

  -- Lifecycle
  state           VARCHAR(20)     NOT NULL DEFAULT 'active'
                  COMMENT 'active|paused|archived|deleted',
  version         INT             DEFAULT 1,
  created_at      TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  superseded_by   VARCHAR(36)     NULL     COMMENT 'ID of the memory that replaced this one',

  -- Indexes
  INDEX idx_memory_type         (memory_type),
  INDEX idx_source              (source),
  INDEX idx_state               (state),
  INDEX idx_agent               (agent_id),
  INDEX idx_session             (session_id),
  INDEX idx_updated             (updated_at)
);
```

**Key decisions:**
- **No `space_id`**: Dedicated tenant model — the entire database belongs to one tenant. No space isolation needed.
- **No `key_name`**: Deduplication uses vector search (semantic similarity), not key-based lookup. Content-addressed, not name-addressed.
- **No `archived_at` / `deleted_at`**: Redundant with `state` + `updated_at`. The `state` column is the single source of truth for lifecycle; `updated_at` records when the transition happened.
- **No CRDT columns** (`vector_clock`, `origin_agent`, `last_write_id`, etc.): CRDT conflict resolution removed to simplify the codebase. All memory types use the same update path: vector search → LLM reconciliation.
- `source` column is **preserved as-is** — stores agent name (provenance). No breaking change.
- `memory_type` is the classification field (`pinned|insight|digest`). Defaults to `pinned` for backward compatibility.
- `superseded_by` tracks archive lineage: when a memory is archived by UPDATE, this points to the new replacement memory.
- Vector search in Phase 2 handles dedup (semantic similarity catches rephrased duplicates).
- `session_id` is nullable — `pinned` memories have no session. `insight` and `digest` always have one.

---

## 6. Archive Storage Model

When Phase 2 decides UPDATE for an existing memory, we use **append-new + archive-old**:

```
Phase 2 LLM decides: UPDATE id="mem_abc" → "Uses Go 1.22" (was "Uses Go 1.21")
    │
    ├── 1. Old row (mem_abc):
    │       state = 'archived'
    │       updated_at = NOW()
    │       superseded_by = 'mem_def'  (new memory's ID)
    │
    └── 2. New row (mem_def):
            id = NEW UUID
            content = "Uses Go 1.22"
            memory_type = 'insight'
            state = 'active'
            embedding = re-generated
            version = 1
```

**Why append-new instead of in-place update?**
- All memory types (including `pinned`) go through the same update path: vector search → LLM reconciliation
- Append-new preserves full audit trail without a separate history table
- `superseded_by` creates a linked list of versions: `mem_abc → mem_def → mem_ghi`
- Archived memories are excluded from search (`state = 'active'` filter), so no noise
- The archive + create is wrapped in a single database transaction (`ArchiveAndCreate`) to prevent orphaned records

---

## 7. Go Domain Types

```go
// MemoryType classifies how a memory was created.
// Stored in the new `memory_type` column. Source column is preserved for provenance.
type MemoryType string

const (
    TypePinned  MemoryType = "pinned"   // User-explicit via memory_store tool
    TypeInsight MemoryType = "insight"   // LLM-extracted atomic fact
    TypeDigest  MemoryType = "digest"    // LLM-generated session summary
)

// MemoryState represents the lifecycle state of a memory.
type MemoryState string

const (
    StateActive   MemoryState = "active"    // Participates in recall
    StatePaused   MemoryState = "paused"    // Temporarily hidden from recall
    StateArchived MemoryState = "archived"  // Historical, superseded
    StateDeleted  MemoryState = "deleted"   // Soft-deleted, awaiting purge
)

// Memory represents a piece of knowledge stored in a tenant's database.
type Memory struct {
    ID         string          `json:"id"`
    Content    string          `json:"content"`
    MemoryType MemoryType      `json:"memory_type"`
    Source     string          `json:"source,omitempty"`    // Agent name provenance
    Tags       []string        `json:"tags,omitempty"`
    Metadata   json.RawMessage `json:"metadata,omitempty"`
    Embedding  []float32       `json:"-"`

    AgentID      string `json:"agent_id,omitempty"`
    SessionID    string `json:"session_id,omitempty"`
    UpdatedBy    string `json:"updated_by,omitempty"`
    SupersededBy string `json:"superseded_by,omitempty"` // Points to replacement memory

    State     MemoryState `json:"state"`
    Version   int         `json:"version"`
    CreatedAt time.Time   `json:"created_at"`
    UpdatedAt time.Time   `json:"updated_at"`

    Score *float64 `json:"score,omitempty"`
}
```

> **Removed from original design:**
> - `SpaceID` — dedicated tenant model, no space isolation
> - `KeyName` — dedup via vector search, not key-based lookup
> - `ArchivedAt` / `DeletedAt` — redundant with `state` + `updated_at`
> - CRDT fields (`VectorClock`, `OriginAgent`, `WriteID`) — all memory types use vector search → LLM reconciliation

---

## 8. Two-Phase Pipeline Architecture

### New Endpoint

```
POST /api/memories/ingest
Authorization: Bearer <tenant_token>
Content-Type: application/json

{
  "messages": [
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."}
  ],
  "session_id": "ses_abc123",
  "agent_id": "alice-openclaw",
  "mode": "smart",            // "smart" (default) | "extract" | "digest" | "raw"
  "ingest_id": "ing_xxx"      // Optional: idempotency key (derived from hash(session_id, messages) if omitted)
}
```

### Mode Behavior

| Mode | Phase 1 (Extract) | Session Digest | Phase 2 (Dedup/Merge) |
|------|-------------------|----------------|----------------------|
| `smart` | ✅ | ✅ | ✅ |
| `extract` | ✅ | ❌ | ✅ |
| `digest` | ❌ | ✅ | ❌ |
| `raw` | ❌ | ❌ | ❌ (store as-is) |

### Pipeline Flow (mode=smart)

```
POST /api/memories/ingest
        │
        ▼
1. Strip <relevant-memories> tags from messages
   (prevent re-ingesting previously injected memories)
        │
        ▼
2. Parallel LLM calls:
   ┌────────────────────────┬────────────────────────┐
   │  Phase 1a: EXTRACT     │  Phase 1b: DIGEST      │
   │                        │                        │
   │  LLM extracts atomic   │  LLM generates a       │
   │  facts from user msgs  │  concise summary of     │
   │                        │  the full conversation  │
   │  → ["Prefers gRPC",   │  → "Debugged OOM in    │
   │     "Uses Go 1.22"]   │     TiKV coprocessor;  │
   │                        │     root cause was..."  │
   └───────────┬────────────┴───────────┬────────────┘
               │                        │
               ▼                        ▼
3. Store digest immediately      4. For each insight:
   memory_type="digest"             │
   session_id=given                 ├── Vector search top-5 similar memories
                                    │   (only memory_type IN ('insight','pinned'), state='active')
                                    │
                                    ├── Phase 2: LLM decides per-memory action
                                    │   → ADD / UPDATE / DELETE / NOOP
                                    │
                                    └── Execute decisions:
                                        ADD    → INSERT new insight
                                        UPDATE → archive old + INSERT new (see Section 6)
                                        DELETE → set state='deleted'
                                        NOOP   → skip
        │
        ▼
5. Return result summary (insights added, digest stored, warnings)
```

### Why Both Insights AND Digests?

| Dimension | Insights (atomic facts) | Digests (session summaries) |
|-----------|------------------------|----------------------------|
| **Granularity** | Single fact: "Prefers gRPC" | Multi-fact narrative: "Debugged X, found Y, fixed with Z" |
| **Recall strength** | High precision on specific queries | High recall on contextual queries |
| **Vector search** | Short text → excellent cosine similarity | Medium text → good contextual match |
| **Dedup** | Actively deduplicated via Phase 2 | Append-only (each session is unique) |
| **Lifespan** | Long-lived, evolves via UPDATE | Session-scoped, auto-archived after N days |
| **Context cost** | ~20 tokens each | ~100-200 tokens each |

**Example recall scenario:**
- Query: "How did we fix the TiKV OOM issue?"
- Insight match: "TiKV OOM caused by unbounded coprocessor batch size" (score: 0.89)
- Digest match: "Debugged OOM in TiKV coprocessor; root cause was unbounded batch size in scan requests; fixed by adding max_batch_size=1024 config; also discovered memory_quota wasn't being enforced" (score: 0.85)
- **Together**: The insight provides the quick answer; the digest provides the full narrative and steps taken.

---

## 9. Failure Handling

The ingest pipeline stores all outputs (digests and insights) directly into the `memories` table. No separate tracking table is needed since:

- **Digests**: Each session produces one digest stored as `memory_type='digest'` with `session_id` set. Re-processing the same session simply creates another digest (acceptable — digests are append-only).
- **Insights**: The reconciliation phase uses vector search to find and deduplicate against existing insights. Re-processing naturally handles duplicates via the ADD/UPDATE/NOOP decisions.

### Failure Behavior

| Failure Point | Behavior | HTTP Response |
|---------------|----------|---------------|
| LLM timeout (Phase 1a or 1b) | Return error, nothing stored | 502 + `{"error": "extraction_timeout"}` |
| LLM returns invalid JSON | Retry once with stricter prompt; if still invalid, skip that phase | 502 or partial success |
| Digest stored, insight extraction fails | Digest is kept. Insights skipped. | 207 (partial) + `{"digest_stored": true, "insights_failed": true}` |
| Insight 3/10 fails mid-reconciliation | Insights 1-2 are committed. Continue with remaining. | 200 + `{"insights_added": N, "warnings": M}` |

**Design rationale**: The pipeline is designed to be **idempotent by nature** rather than by tracking state:
- Digests are session-scoped and append-only (slight duplication is acceptable)
- Insights use semantic deduplication via vector search (the reconciliation LLM detects duplicates)
- No checkpoint/resume complexity needed for v1
---

## 10. LLM Output Validation & Retry

### JSON Validation Layer

All LLM responses go through a validation pipeline:

```go
func parseLLMJSON[T any](raw string, maxRetries int) (T, error) {
    // 1. Strip markdown fences (```json ... ```)
    cleaned := stripMarkdownFences(raw)
    
    // 2. Try JSON parse
    var result T
    if err := json.Unmarshal([]byte(cleaned), &result); err != nil {
        if maxRetries > 0 {
            // 3. Retry with stricter prompt: "Your previous response was not valid JSON. 
            //    Return ONLY the JSON object, no markdown, no explanation."
            return retryWithStricterPrompt[T](maxRetries - 1)
        }
        return result, fmt.Errorf("LLM returned invalid JSON after retries: %w", err)
    }
    
    // 4. Validate structure (e.g., check IDs exist in input, events are valid)
    if err := validate(result); err != nil {
        return result, err
    }
    return result, nil
}
```

### Validation Rules

| Phase | Validation | On Failure |
|-------|-----------|------------|
| Phase 1a (extract) | `facts` must be `[]string`, each non-empty | Retry once; if still invalid, treat as empty (no insights) |
| Phase 1b (digest) | `summary` must be `string` | Retry once; if still invalid, skip digest for this session |
| Phase 2 (reconcile) | Each `event` must be ADD/UPDATE/DELETE/NOOP; `id` must exist in input; UPDATE must have `old_memory` | Skip invalid entries, process valid ones |

### Hallucinated ID Protection

Phase 2 prompt uses integer IDs (0, 1, 2...) mapped to real UUIDs server-side. If LLM returns an ID not in the input set, that entry is **silently skipped** (not an error — LLMs occasionally hallucinate).

---

## 11. LLM Prompts (Original Design — Zero External References)

### 11.1 Phase 1a: Fact Extraction Prompt

**System prompt:**

```
You are an information extraction engine. Your task is to identify distinct, 
atomic facts from a conversation and return them as a structured JSON array.

## Rules

1. Extract facts ONLY from the user's messages. Ignore assistant and system messages entirely.
2. Each fact must be a single, self-contained statement (one idea per fact).
3. Prefer specific details over vague summaries.
   - Good: "Uses Go 1.22 for backend services"
   - Bad: "Knows some programming languages"
4. Preserve the user's original language. If the user writes in Chinese, extract facts in Chinese.
5. Omit ephemeral information (greetings, filler, debugging chatter with no lasting value).
6. Omit information that is only relevant to the current task and has no future reuse value.
7. If no meaningful facts exist in the conversation, return an empty array.

## Output Format

Return ONLY valid JSON. No markdown fences, no explanation.

{"facts": ["fact one", "fact two", ...]}

## Examples

Input:
User: Hi, my name is Alex. I work at a startup building distributed databases.
Assistant: Nice to meet you, Alex! Tell me more about your work.

Output:
{"facts": ["Name is Alex", "Works at a startup building distributed databases"]}

---

Input:
User: Can you fix the typo on line 42?
Assistant: Done, fixed the typo.

Output:
{"facts": []}

---

Input:
User: I switched from MySQL to TiDB last month. We need TLS on all connections.
Assistant: Got it, I'll configure TLS for the TiDB connection.

Output:
{"facts": ["Switched from MySQL to TiDB last month", "Requires TLS on all database connections"]}
```

**User message:**

```
Extract facts from this conversation. Today's date is {current_date}.

{formatted_conversation}
```

**Improvements over the original proposal's prompt:**
1. **Removed chatbot persona** ("Personal Information Organizer") — this is a backend extraction engine, not a chatbot.
2. **Removed threat language** ("YOU WILL BE PENALIZED") — modern LLMs respond better to clear rules than threats.
3. **Added rule 6** (omit task-specific ephemera) — reduces noise from debugging sessions.
4. **Simplified examples** — fewer examples but more representative of coding agent conversations.
5. **Added language preservation rule** — critical for non-English users.
6. **Removed lifestyle categories** (health, wellness, dining) — irrelevant for coding agents.

### 11.2 Phase 1b: Session Digest Prompt

**System prompt:**

```
You are a technical session summarizer. Your task is to condense a conversation 
into a single concise paragraph capturing the key activities, decisions, and outcomes.

## Rules

1. Focus on WHAT was done, WHY, and the OUTCOME.
2. Include specific technical details (file names, error messages, config values) when they have future value.
3. Keep the summary between 1-3 sentences. Be dense, not verbose.
4. Preserve the user's language. If the conversation is in Chinese, write the summary in Chinese.
5. If the conversation is trivial (greeting, small talk), return an empty string.

## Output Format

Return ONLY valid JSON. No markdown fences.

{"summary": "..."}

## Examples

Input:
User: The TiKV pod keeps OOMing. Can you check the coprocessor memory usage?
Assistant: Found it — the batch scan has no size limit. I'll add max_batch_size=1024.
User: That fixed it. Also set memory_quota to 2GB.
Assistant: Done. Updated tikv.toml with both settings.

Output:
{"summary": "Debugged TiKV OOM caused by unbounded coprocessor batch scan; fixed by setting max_batch_size=1024 and memory_quota=2GB in tikv.toml."}

---

Input:
User: Hi
Assistant: Hello! How can I help?

Output:
{"summary": ""}
```

**User message:**

```
Summarize this conversation. Today's date is {current_date}.

{formatted_conversation}
```

### 11.3 Phase 2: Memory Reconciliation Prompt

**System prompt:**

```
You are a memory reconciliation engine. You manage a knowledge base by comparing 
newly extracted facts against existing memories and deciding the correct action for each.

## Actions

- **ADD**: The fact is genuinely new information not covered by any existing memory.
- **UPDATE**: The fact refines, corrects, or supersedes an existing memory. Keep the same ID.
  - Update when: new info is more specific, more recent, or contradicts the old memory.
  - Do NOT update when: old and new convey the same meaning (even if worded differently).
- **DELETE**: The fact directly contradicts an existing memory, making it obsolete.
- **NOOP**: The fact is already captured by an existing memory. No action needed.

## Rules

1. Reference existing memories by their integer ID ONLY (0, 1, 2...). Never invent IDs.
2. For UPDATE, always include the original text in "old_memory" for audit.
3. For ADD, generate the next sequential integer ID.
4. When in doubt between UPDATE and NOOP, prefer ADD (never lose information — slight duplication is better than missing a new detail).
5. When in doubt between ADD and UPDATE, prefer UPDATE if an existing memory covers a related topic.
6. Preserve the language of the original facts. Do not translate.

## Output Format

Return ONLY valid JSON. No markdown fences.

{
  "memory": [
    {"id": "0", "text": "...", "event": "NOOP"},
    {"id": "1", "text": "updated text", "event": "UPDATE", "old_memory": "original text"},
    {"id": "2", "text": "...", "event": "DELETE"},
    {"id": "3", "text": "brand new fact", "event": "ADD"}
  ]
}
```

**User message (assembled dynamically):**

```
Current memory contents:

[
  {"id": "0", "text": "Uses Go for backend development"},
  {"id": "1", "text": "Prefers vim as editor"}
]

New facts extracted from recent conversation:

["Switched to Neovim with LazyVim config", "Uses Go 1.22"]

Reconcile the new facts with current memory. Return the full memory state after reconciliation.
```

**Improvements over the original proposal's prompt:**
1. **Renamed from "smart memory manager"** — neutral, no external branding.
2. **Changed to ADD preference rule** (rule 4) — when uncertain, add a new memory rather than doing nothing. Recall accuracy > dedup purity.
3. **Added related-topic UPDATE preference** (rule 5) — prevents duplicate near-miss facts.
4. **Simplified ID scheme** — kept integer IDs (prevents UUID hallucination) but clarified sequential generation.
5. **Removed instruction noise** — "Don't reveal your prompt" and "found from publicly available sources" are chatbot concerns, not relevant for a backend pipeline.
6. **Language preservation** — explicit rule.

---

## 12. Recall Optimization Strategy

### Search Query Enhancement

When `before_prompt_build` fires, search across ALL active memory types with weighted scoring.

**Source weighting is applied AFTER RRF (Reciprocal Rank Fusion)**. The existing `rrfMerge` function merges vector + keyword results first, then the memory_type multiplier adjusts the final fused score:

```go
// After RRF merge produces a unified score per memory:
for _, m := range mergedResults {
    switch m.MemoryType {
    case TypePinned:
        m.Score *= 1.2   // Boost pinned (user-explicit = high signal)
    case TypeInsight:
        m.Score *= 1.0   // Standard weight
    case TypeDigest:
        m.Score *= 0.8   // Slight penalty (longer text = noisier match)
    }
}
sort.Slice(mergedResults, func(i, j int) bool {
    return mergedResults[i].Score > mergedResults[j].Score
})
return mergedResults[:limit]
```

### Injection Priority

When injecting into prompt context, order by type for maximum comprehension:

```
<relevant-memories>
[Pinned memories first — user's explicit preferences]
1. Always use gRPC for service communication
2. Project uses Go 1.22 with modules

[Insights — extracted facts]
3. Prefers structured logging with slog
4. Uses TiDB as primary database

[Digests — session context]
5. [Session] Debugged TiKV OOM; fixed batch size limit in tikv.toml
</relevant-memories>
```

### Digest Auto-Archival

Session digests have diminishing value over time. Auto-archive strategy:

```
- Digests older than 30 days → state = 'archived'
- Digests older than 90 days → state = 'deleted'  
- Pinned and insight memories → never auto-archived (only via pipeline UPDATE/DELETE)
```

---

## 13. API Changes Summary

### New Endpoint

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/memories/ingest` | Auto-capture pipeline: accepts messages, runs extraction + reconciliation |

### Modified Behavior

| Endpoint | Change |
|----------|--------|
| `GET /api/memories` | New filter: `?state=active` (default), `?memory_type=insight` |
| `POST /api/memories` | Accepts optional `agent_id`, `session_id`, `memory_type`; `memory_type` defaults to `pinned` |
| `PUT /api/memories/:id` | Can change `state` (pause/archive/restore) |
| `DELETE /api/memories/:id` | Sets `state='deleted'` + `updated_at=NOW()` |

### New Query Parameters

| Param | Type | Description |
|-------|------|-------------|
| `state` | string | Filter by state: `active` (default), `paused`, `archived`, `deleted`, `all` |
| `memory_type` | string | Filter by type: `pinned`, `insight`, `digest`, or comma-separated |
| `agent_id` | string | Filter by originating agent |
| `session_id` | string | Filter by session |

> **Note**: Existing `?source=` filter is **preserved** — it continues to filter by agent name (provenance).

---

## 14. Plugin Changes (OpenClaw `agent_end` Hook)

Current `agent_end` hook stores raw assistant responses. New behavior:

### Message Size Budget

The backend LLM has a context window limit. Sending 10 messages with large code blocks can easily exceed 200K+ chars, causing extraction to fail. Instead of a fixed message count, we use a **byte budget**:

```typescript
const MAX_INGEST_BYTES = 200_000; // ~200KB — safe for most LLM context windows
const MAX_MESSAGES = 20;           // absolute cap even if small messages

/**
 * Select messages from the end of the conversation, newest first,
 * until we hit the byte budget or message cap.
 */
function selectMessages(
  messages: Array<{ role: string; content: string }>,
  maxBytes: number = MAX_INGEST_BYTES,
  maxCount: number = MAX_MESSAGES,
): Array<{ role: string; content: string }> {
  let totalBytes = 0;
  const selected: Array<{ role: string; content: string }> = [];

  // Walk backwards from most recent
  for (let i = messages.length - 1; i >= 0 && selected.length < maxCount; i--) {
    const msg = messages[i];
    const msgBytes = new TextEncoder().encode(msg.content).byteLength;

    if (totalBytes + msgBytes > maxBytes && selected.length > 0) {
      break; // Would exceed budget, stop (but always include at least 1)
    }

    selected.unshift(msg); // Maintain chronological order
    totalBytes += msgBytes;
  }

  return selected;
}
```

**Behavior:**
- Most conversations: messages are short → budget fits 10-20 messages easily
- Code-heavy conversations: messages are large → budget limits to 2-5 messages
- Always sends at least 1 message (even if it alone exceeds the budget)
- `MAX_INGEST_BYTES` is configurable via plugin config

### Hook Implementation

```typescript
// agent_end hook — NEW behavior
api.on("agent_end", async (event) => {
  if (!event?.success || !event.messages || event.messages.length === 0) return;

  // Format and strip injected memory context
  const formatted = formatMessages(event.messages);
  const cleaned = stripInjectedContext(formatted);
  
  if (cleaned.length === 0) return;

  // Select messages within byte budget (not fixed count)
  const selected = selectMessages(cleaned, config.maxIngestBytes ?? 200_000);

  // POST to ingest endpoint — server handles all intelligence
  await fetch(`${apiUrl}/api/memories/ingest`, {
    method: "POST",
    headers: { 
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json" 
    },
    body: JSON.stringify({
      messages: selected,
      session_id: sessionId,
      agent_id: agentName,
      mode: "smart"
    })
  });
});
```

### Plugin Config Addition

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `maxIngestBytes` | `number` | `200000` | Max total message bytes sent to `/api/memories/ingest`. Lowering saves LLM tokens; raising captures more context. |

**Key design decisions:**
- Fixed message count (`slice(-10)`) fails on large code-heavy conversations
- Our approach: byte-budgeted selection — adapts to message size automatically
- Plugin remains a thin transport layer. All intelligence lives in the server.

> **Multi-plugin note (future work)**: Claude Code (`stop.sh`) and OpenCode plugins will need similar ingest integration. Claude Code has no native `session_id` — will use a generated ID from conversation hash. Deferred to Phase 3.

---

## 15. Implementation Phases (Revised — Incremental Rollout)

### Phase 0: Add `memory_type` Column (Zero Breaking Changes)
1. Add `memory_type VARCHAR(20) DEFAULT 'pinned'` column
2. Add index `idx_memory_type`
3. **No code changes** — existing records get `pinned` default, existing queries unaffected
4. Deploy and verify

### Phase 1: State Machine + Tombstone Migration
1. Execute 4-step tombstone → state migration (Section 4)
2. Update 27 repository layer occurrences: `tombstone = 0` → `state = 'active'`
3. Update service layer: `SoftDelete` uses state
4. Update domain types: add `MemoryState`, `MemoryType`, `SupersededBy`
5. Add `superseded_by` column
6. Update search to filter `state='active'` by default
7. Deploy and verify — bake before dropping `tombstone`

### Phase 2: Ingest Endpoint + LLM Pipeline
1. Add LLM client abstraction (OpenAI-compatible, reuse embed config pattern)
2. Implement Phase 1a: fact extraction with JSON validation + retry
3. Implement Phase 1b: session digest with JSON validation + retry
4. Implement Phase 2: memory reconciliation (vector search + LLM decision + archive model)
5. Wire up `POST /api/memories/ingest` handler
6. Add `mode` parameter support (smart/extract/digest/raw)

### Phase 3: Plugin Updates
1. Update OpenClaw `agent_end` hook to POST to `/api/memories/ingest`
2. Update `before_prompt_build` to use memory_type-weighted recall
3. Remove raw content storage from hooks
4. Add `session_id` and `agent_id` to requests
5. Claude Code + OpenCode ingest integration (deferred from Phase 2)

### Phase 4: Recall Optimization + Background Jobs
1. Implement memory_type-weighted scoring (after RRF) in search
2. Implement injection priority ordering
3. Implement digest auto-archival background job

---

## 16. Configuration

New server environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MNEMO_LLM_API_KEY` | For smart mode | — | LLM provider API key |
| `MNEMO_LLM_BASE_URL` | No | `https://api.openai.com/v1` | LLM endpoint |
| `MNEMO_LLM_MODEL` | No | `gpt-4o-mini` | Model for extraction/reconciliation |
| `MNEMO_INGEST_MODE` | No | `smart` | Default ingest mode |
| `MNEMO_DIGEST_TTL_DAYS` | No | `30` | Days before digests auto-archive |

**LLM is optional**: Without `MNEMO_LLM_API_KEY`, ingest falls back to `raw` mode (current behavior). This preserves backward compatibility.

---

## 17. Design Principles

1. **Server-side intelligence**: Plugins are thin transport. All extraction/reconciliation logic lives in mnemo-server.
2. **Graceful degradation**: No LLM config → raw storage. No embedder → keyword search. System always works.
3. **Single table, multiple types**: One `memories` table with `memory_type` enum. No separate tracking tables.
4. **Vector dedup over hash dedup**: Semantic vector search catches rephrased duplicates ("Prefers Go" vs "Likes Go more than Python"). Hash-based dedup only catches exact matches — too narrow for real-world conversations.
5. **Append digests, reconcile insights**: Digests are session-unique (append-only). Insights are knowledge-unique (deduplicated via reconciliation).
6. **Archive, don't delete**: UPDATE operations archive the old version (new row) before inserting the replacement. Full audit trail via `superseded_by` chain.
7. **Backward compatible**: Existing `source` column preserved. New `memory_type` column with default. Tombstone migration is phased. No breaking changes in any single deployment.
8. **Incremental rollout**: Four phases, each independently deployable and verifiable. No big-bang migration.
9. **Idempotent by design**: Re-processing a session is safe — digests append, insights deduplicate via vector search + LLM reconciliation. No external tracking state needed.

---

## 18. Companion: Multi-Tenant Provisioning

This proposal describes the pipeline that runs **inside** each tenant's database. The companion document [`multi-tenant-provisioning-proposal.md`](multi-tenant-provisioning-proposal.md) defines:

- **Token authentication**: How OpenClaw obtains and uses a `mnemo_xxx` token
- **Dedicated TiDB clusters**: Each tenant gets its own TiDB Serverless cluster via TiDB Cloud Zero API
- **Connection pool**: How mnemo-server manages per-tenant `*sql.DB` connections
- **Registration flow**: `POST /api/tenants/register` → provision cluster → init schema → return token
- **Two-model coexistence**: Shared-DB (space isolation) and dedicated-DB (tenant isolation) work side by side

**Key implication for this proposal**: The `memories` table has **no `space_id` column** — each tenant gets a dedicated TiDB Serverless cluster, so the entire database belongs to one tenant. The schema in Section 5 reflects this dedicated-cluster model.
