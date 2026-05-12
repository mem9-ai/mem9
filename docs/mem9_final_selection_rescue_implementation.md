# mem9 Final-Selection Provenance Rescue Implementation

Date: 2026-05-12T01:12:33Z

Mode: approved minimal implementation after offline replay. This document is not full-benchmark approval.

## Selected Hypothesis

The server already retrieves and ranks source-linked evidence for a meaningful subset of Cat1/Cat4 ER0 failures, but final selection drops that evidence in favor of weaker or redundant selected context. A conservative final-selection rescue can improve final-context evidence presence without changing retrieval, storage, prompt assembly size, scoring, or benchmark logic.

## Replay Justification

Offline replay artifact: `docs/mem9_final_selection_rescue_replay.md`.

Replay result over `/home/ec2-user/Documents/Dev/harness/diagnostics/20260511T062806Z-er0-trace`:

| Metric | Rows |
| --- | ---: |
| Target rows replayed | 161 |
| Safe rows improved | 42 |
| Risk rows affected by replacement | 4 |
| Risk rows gaining target-gold evidence | 0 |
| Target-gold regressions | 0 |

This passed the approved gate: `>=8` safe rows and `<=4` affected risk rows.

## Dirty State Classification

| File | Classification | Score-affecting by default? | Notes |
| --- | --- | --- | --- |
| `server/internal/handler/recall.go` | mixed: existing trace-only hooks plus candidate implementation | Candidate implementation is score-affecting; trace hooks are default-off | Candidate implementation is the provenance rescue block/helper. Trace output only runs when `MNEMO_RECALL_TRACE_DIR` is set. |
| `server/internal/handler/recall_trace.go` | trace-only diagnostic helper | No when `MNEMO_RECALL_TRACE_DIR` is unset | Kept for predict-only validation. |
| `server/internal/handler/recall_test.go` | focused tests | No runtime effect | Tests only. |
| `docs/mem9_final_selection_rescue_replay.md` | documentation | No | Replay evidence. |
| `docs/mem9_final_selection_rescue_implementation.md` | documentation | No | This file. |

Trace mode remains default-off: `recallTraceEnabled()` checks only `MNEMO_RECALL_TRACE_DIR != ""`, and the normal API response path does not include trace fields.

## Exact Guardrails Implemented

- Only candidates already present in the deduped server ranked list are considered.
- No raw/BM25/entity/date/source-tail expansion is performed.
- Candidate must not already be selected or source-duplicate an already selected memory.
- Candidate must have explicit source provenance through `seq`, `source_seqs`, `source_turns`, or equivalent dialogue-id metadata.
- Candidate confidence must be at least 65.
- Candidate ranked position must be at most 100.
- Candidate must have query/source-turn token alignment, or high confidence with both existing vector and keyword flags.
- At most one memory is replaced per recall call.
- Returned count is fixed.
- Selected memories with meaningful unique query coverage are protected.
- Pinned candidates are not rescued by this helper.
- No question id, category id, LoCoMo label, benchmark score, or gold answer is read by production code.

## Files Changed

| File | Change |
| --- | --- |
| `server/internal/handler/recall.go` | Adds `applyFinalSelectionProvenanceRescue` after existing balanced/top selection. Adds small metadata/provenance and rescue-token helpers. Existing trace-only hooks remain separate and default-off. |
| `server/internal/handler/recall_test.go` | Adds focused tests for the rescue guard and nearby non-rescue behavior. |

No benchmark-side files, prompts, scoring logic, harness promotion rules, ingest/storage/reconciliation code, or context-size settings were changed.

## Tests Run

Command:

```bash
cd server && go test -count=1 ./internal/handler -run 'TestFinalSelectionProvenanceRescue|TestSelectTopRecallCandidatesDedupesInsightAndRawSessionBySourceSeq|TestSelectTopRecallCandidatesKeepsDistinctInsightsFromSameSourceSeq|TestSelectEnumerationRecallCandidatesDedupesInsightAndRawSessionBySourceSeq|TestSelectTopRecallCandidates_PerformanceBridgeKeepsAnswerInsightDespiteRawSourceSeen'
```

Result: passed.

Covered cases:

1. High-confidence source-provenance candidate ranked outside selected top-k can replace a low-coverage selected memory while keeping returned count fixed.
2. Candidate below confidence 65 is not rescued.
3. Candidate without `seq`/`source_seqs`/`source_turns` provenance is not rescued.
4. No rescue when selected memories contribute unique query coverage.
5. No rescue when candidate is redundant with already selected source evidence.
6. No rescue from benchmark-only metadata such as `question_id` or `category`.
7. Time query selection remains unchanged when the rescue guard is not satisfied.

## Production Legitimacy

This is a general recall-quality selection rule. It uses source provenance already stored with memories and candidates already returned by the server ranking pipeline. It does not inspect benchmark categories, answers, question ids, or scoring outputs.

## Why This Is Not Benchmark Gaming

The implementation cannot target LoCoMo-specific rows because it has no access to row ids, categories, gold evidence, or judge outcomes. It also does not change the benchmark, answer prompt, scoring, context size, or candidate retrieval breadth.

## Rollback Plan

Rollback is reverting the final-selection rescue helper and its call sites in `server/internal/handler/recall.go`, plus the focused tests in `server/internal/handler/recall_test.go`. Trace-only instrumentation is separate and can be kept or reverted independently.

## Next Gate

Run the approved predict-only trace validation only. Do not run full LoCoMo or LLM judge without explicit approval.
