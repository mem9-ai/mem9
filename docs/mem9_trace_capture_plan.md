# mem9 ER0 Trace Capture Plan

Date: 2026-05-11 UTC

Mode: diagnostic trace capture only. This plan is written before any trace-only
code change, per the Experiment #1 follow-up rules.

## Objective

Rebuild a clean no-change diagnostic environment for the accepted
mem0-style-on-mem9 framework and capture enough read-only storage and retrieval
lineage to classify Cat1/Cat4 ER0 rows into storage, reconciliation, retrieval,
ranking, final top-k, final context, or answer-synthesis failures.

This is not an optimization experiment and must not be interpreted as a score
comparison or performance improvement.

## Environment Readiness

Current dirty-state check:

```text
/home/ec2-user/git/mem9            ## arch/level2...origin/arch/level2
/home/ec2-user/git/mem9-benchmark  ## arch/level2...origin/arch/level2
/home/ec2-user/git/clawd           ## main...origin/main
```

The only expected new repo files for this diagnostic phase are documentation and
trace-only instrumentation. No production logic, benchmark scoring, answer
prompt, or harness promotion rule may be changed.

The accepted backend/cache cannot be restored from
`/home/ec2-user/Documents/Dev/harness/results/20260510T024951` because that
archive contains no DB snapshot, stored-memory export, raw candidate pool,
post-filter pool, ranked candidate list, or final top-k lineage. Therefore the
diagnostic environment must be rebuilt from clean no-change code with a new
cache file and a timestamped artifact directory. The suspicious current
`last-ingest-cache.json` must not be used as authoritative evidence.

Accepted framework settings to use:

```text
LOCOMO_PROTOCOL=mem0-style
LOCOMO_ANSWER_PROMPT=mem0-speaker
LOCOMO_SPEAKER_INGEST_MODE=batch2
LOCOMO_SPEAKER_TOP_K=10
MEM9_RETRIEVAL_LIMIT=20
```

Trace capture should use benchmark `--predict-only` so it performs ingest and
retrieval but does not run answer generation, judging, or score comparison.

## Trace-Only Change Scope

Trace instrumentation is required because the normal API returns only final
top-k memories and the current accepted artifacts do not contain pre-final
candidate pools. The instrumentation will be isolated behind
`MNEMO_RECALL_TRACE_DIR`. With that env var unset, the code path must be a no-op
and normal API responses must remain byte-for-byte schema-compatible.

Files to touch:

| File | Reason |
|---|---|
| `server/internal/handler/recall_trace.go` | New trace-only helper for serializing recall candidate snapshots to JSON files when `MNEMO_RECALL_TRACE_DIR` is set. |
| `server/internal/handler/recall.go` | Add no-op-by-default trace calls in recall search functions after candidates are collected and after final selection is known. |
| `docs/mem9_trace_capture_plan.md` | This plan. |
| `docs/mem9_er0_trace_artifact_inventory.md` | Artifact inventory after capture. |
| `docs/mem9_er0_storage_vs_retrieval_attribution_v2.md` | Final attribution v2 report. |

Files not to touch:

- benchmark scoring code
- answer prompts
- harness promotion rules
- production retrieval ranking or selection logic
- mem9-benchmark retrieval behavior

## Data To Capture

For each traced server search request:

- timestamp
- tenant/cluster identity
- query text
- normalized query text as seen by the server
- requested limit and effective budget
- session_id, agent_id, memory_type
- recall query shape and selection mode
- raw server candidate pools per source pool after service candidate retrieval
- post-confidence candidates after confidence assignment
- deduped/ranked candidate list with scores and confidence
- final selected/top-k returned memories
- coarse candidate disposition when derivable: selected, duplicate/deduped,
  below confidence threshold, truncated or not selected
- cutoff reason and selection stats
- memory metadata, including source provenance fields when present

For each stored memory export:

- sample id
- speaker bucket
- tenant id
- speaker session id
- memory id
- memory type
- content
- agent id
- session id
- metadata
- created_at and updated_at
- source dialogue ids derived from `metadata.dia_id`, `metadata.seq`,
  `metadata.source_seqs`, `metadata.source_turns`, or `[dia:...]` markers

For each benchmark predict-only row:

- question id
- category
- speaker bucket
- question
- gold answer and evidence IDs
- final returned memories
- final returned dia IDs
- final prompt context

## Why Trace Mode Does Not Affect Behavior

The trace hooks will run only when `MNEMO_RECALL_TRACE_DIR` is non-empty.
Otherwise the helper returns immediately.

When enabled, trace mode must:

- read candidate and selected memory slices after normal retrieval code has
  already produced them;
- copy data into trace structs;
- write JSON files to the trace directory;
- never mutate candidate, memory, filter, ranking, confidence, budget, or API
  response values;
- never change request parameters, SQL, prompt text, scoring, or benchmark
  aggregation.

Trace write failures should be logged and ignored so retrieval behavior remains
unchanged.

## Enable / Disable

Enable:

```bash
export MNEMO_RECALL_TRACE_DIR=/home/ec2-user/Documents/Dev/harness/diagnostics/<timestamp>/server-traces
```

Disable:

```bash
unset MNEMO_RECALL_TRACE_DIR
```

No trace data should be written when disabled.

## Validation Plan

Before capture:

1. Run `make build` in `/home/ec2-user/git/mem9` to verify the server builds.
2. Run focused handler tests if feasible.
3. Start a diagnostic mnemo-server on a separate port, with
   `MNEMO_RECALL_TRACE_DIR` set.
4. Confirm `/healthz` responds.
5. Run a tiny predict-only smoke capture on one sample if needed to verify trace
   files are created.

Normal-output validation:

- Because the trace flag only writes side-channel files and does not affect the
  response body, verify the predict-only result schema still contains the normal
  row fields: `retrieved_memories`, `retrieved_dia_ids`,
  `speaker_a_context_retrieved`, and `speaker_b_context_retrieved`.
- The v2 attribution will not compare Overall LLM, F1, or candidate scores to
  baseline and will not call any movement an improvement.

## Capture Plan

1. Create a timestamped diagnostic directory under
   `/home/ec2-user/Documents/Dev/harness/diagnostics/`.
2. Create a fresh ingest cache under that directory, not
   `results/last-ingest-cache.json`.
3. Rebuild or reuse a clean control-plane database name for the diagnostic
   server; do not reuse suspicious cache lineage.
4. Run benchmark retrieval in predict-only mode with the accepted framework
   settings.
5. Export stored memories from the new cache's tenant/session scopes.
6. Preserve:
   - clean cache manifest
   - server trace JSON files
   - predict-only result JSON and unified JSON
   - stored memory export
   - source dialogue metadata
   - command and environment manifest with secrets redacted
7. Run attribution v2 from these artifacts only.

## Stop Conditions

Stop and report missing evidence if any of these remain unavailable:

- clean cache/backend lineage
- stored-memory export
- raw candidate traces
- post-filter/ranked candidate traces
- final top-k returned memories
- final prompt context

Do not compensate with generic optimization advice.
## Actual Capture Result

The clean diagnostic capture completed under:

```text
DIAG=/home/ec2-user/Documents/Dev/harness/diagnostics/20260511T062806Z-er0-trace
CACHE_FILE=/home/ec2-user/Documents/Dev/harness/diagnostics/20260511T062806Z-er0-trace/cache/clean-ingest-cache.json
PREDICT_RESULT=/home/ec2-user/Documents/Dev/harness/diagnostics/20260511T062806Z-er0-trace/results/predict-only.json
TRACE_DIR=/home/ec2-user/Documents/Dev/harness/diagnostics/20260511T062806Z-er0-trace/server-traces
```

Observed artifacts:

- predict-only rows: 1986
- server trace files: 3972
- stored memories exported: 7796
- accepted Cat1/Cat4 ER0 rows classified in v2: 235

The suspicious repo-local `last-ingest-cache.json` was not used as authoritative evidence. The abandoned earlier diagnostic attempt with wrong lineage was not used for v2 attribution. Source sequence provenance is interpreted as zero-based, matching `mem9-benchmark/locomo/src/ingest.ts`; comma/semicolon-joined evidence strings are regex-extracted before attribution.
