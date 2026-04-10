---
title: Fact Extraction Quality Improvement Proposal
date: 2026-04-10
status: draft
effort: ~35 LoC
expected-gain: +2-4% LoCoMo LLM score
---

## Problem Statement

LoCoMo benchmark analysis reveals that fact extraction is the primary bottleneck for recall quality. The current extraction prompt allows the LLM to over-generalize facts, losing critical specifics needed for downstream retrieval and answer generation.

### Evidence from Benchmark Failures

| Question | Gold Answer | Extracted Fact | Failure Mode |
|----------|-------------|----------------|--------------|
| "Where did Caroline move from 4 years ago?" | Sweden | "Caroline moved from her home country 4 years ago" | Proper noun replaced with generic term |
| "What did Caroline research?" | Adoption agencies | (not extracted) | Action verb + object lost entirely |
| "When did Melanie run a charity race?" | Sunday before 25 May 2023 | "Saturday, May 20, 2023" | Temporal reference mangled |

### Root Cause

The extraction prompt (`ingest.go:465-467`) contains:

```
3. Prefer specific details over vague summaries.
   - Good: "Uses Go 1.22 for backend services"
   - Bad: "Knows some programming languages"
```

This rule is **positive guidance** but lacks **negative constraints**. The LLM interprets "prefer specific" as a soft suggestion, not a hard rule. There is no explicit instruction to:

1. Never replace proper nouns with generic terms
2. Preserve action verbs precisely
3. Keep entity names verbatim even when context seems redundant

## Proposed Changes

### Change 1: Enhance Rule 3 with Verbatim Preservation Sub-rules

Expand rule 3 in the extraction prompt (after line 467 in `extractFacts`, after line 581 in `extractFactsAndTags`):

```
3. Prefer specific details over vague summaries.
   - Good: "Uses Go 1.22 for backend services"
   - Bad: "Knows some programming languages"
   NEVER replace specific names, places, organizations, or entities with generic terms.
   Proper nouns must appear verbatim in the extracted fact.
   - Good: "Caroline moved from Sweden 4 years ago"
   - Bad: "Caroline moved from her home country 4 years ago"
   - Good: "User works at Google"
   - Bad: "User works at a tech company"
   Preserve action verbs precisely. If the user "researched", "purchased", "visited",
   "investigated", or "called", keep the exact verb. Do not paraphrase to generic
   verbs like "looked at", "did", "went to", or "checked".
   - Good: "User researched adoption agencies"
   - Bad: "User looked into adoption"
   - Good: "User purchased a Tesla Model 3"
   - Bad: "User bought a car"
```

### Change 2: Enhance Rule 9 with Negative Examples

Expand rule 9 (temporal context) at line 495 in `extractFacts`, line 609 in `extractFactsAndTags`:

```
9. Always include temporal context when mentioned. Preserve dates, times, and
   temporal markers EXACTLY as stated. Do not convert between formats.
   - Good: "Ran a charity race last Saturday" (preserve relative reference)
   - Good: "Meeting on 2023-05-20" (preserve absolute date)
   - Bad: Converting "last Saturday" to "May 20, 2023" (loses relative context)
   - Bad: Converting "May 20, 2023" to "recently" (loses precision)
```

### Change 3: Add Extraction Completeness Rule

Add new rule 14 (after existing rule 13 which handles tag assignment):

Insert after line 509 in `extractFacts`, after line 622 in `extractFactsAndTags`:

```
14. When in doubt, extract more rather than less. A slightly verbose fact that
    preserves all details is better than a concise fact that loses information.
    The reconciliation phase will handle deduplication — your job is to capture
    everything the user stated.
```

## Implementation

### Files to Modify

| File | Change | Lines |
|------|--------|-------|
| `server/internal/service/ingest.go` | Expand rule 3 in `extractFacts` prompt | after 467 |
| `server/internal/service/ingest.go` | Expand rule 9 in `extractFacts` prompt | replace 495 |
| `server/internal/service/ingest.go` | Add rule 14 in `extractFacts` prompt | after 509 |
| `server/internal/service/ingest.go` | Expand rule 3 in `extractFactsAndTags` prompt | after 581 |
| `server/internal/service/ingest.go` | Expand rule 9 in `extractFactsAndTags` prompt | replace 609 |
| `server/internal/service/ingest.go` | Add rule 14 in `extractFactsAndTags` prompt | after 622 |

### Prompt Locations

| Function | Prompt Start | Prompt End | Rules Section |
|----------|--------------|------------|---------------|
| `extractFacts` | 449 | 515 | 454-509 |
| `extractFactsAndTags` | 563 | 656 | 568-622 |

### Estimated LoC

- Rule 3 expansion: ~10 lines x 2 prompts = ~20 lines
- Rule 9 expansion: ~5 lines x 2 prompts = ~10 lines
- Rule 14 addition: ~3 lines x 2 prompts = ~6 lines
- Total: ~35 lines
- No logic changes required
- No new dependencies

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| LLM generates longer facts, hitting token limits | Low | Existing `maxFacts=50` cap handles this |
| Over-extraction creates noise | Medium | Reconciliation phase already handles dedup |
| Prompt length increases LLM latency | Low | ~250 tokens added, negligible impact |
| Over-retention of vague hedges | Low | Rule 5 (omit ephemeral) still applies; new rules target specificity, not retention scope |

## Validation Plan

1. Run LoCoMo benchmark with current prompt (baseline)
2. Apply prompt changes
3. Run LoCoMo benchmark again
4. Compare:
   - Overall LLM score (target: +2-4%)
   - Cat1 (multi-hop) score specifically
   - Evidence recall (should improve if dia_id tracking added separately)

### Acceptance Criteria

- Proper noun retention: >90% of named entities in source appear verbatim in extracted facts
- Temporal precision: No format conversion errors in benchmark samples
- False positive rate: <10% increase in extracted facts that are truly ephemeral

## Alternative Approaches Considered

### A: Post-extraction validation

Add a second LLM pass to verify extracted facts contain all proper nouns from source.

**Rejected**: Doubles LLM cost, adds latency, doesn't address root cause.

### B: Few-shot examples with LoCoMo-style data

Add examples from actual LoCoMo failures to the prompt.

**Partially adopted**: The negative examples in this proposal serve this purpose without overfitting to benchmark.

### C: Structured extraction with entity slots

Force LLM to fill explicit slots: `{subject, verb, object, location, time}`.

**Rejected**: Over-constrains natural language facts, may miss nuanced information.

## Decision Requested

Approve prompt changes as specified, or request modifications before implementation.
