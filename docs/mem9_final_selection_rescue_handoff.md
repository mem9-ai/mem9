# mem9 Final-Selection Provenance Rescue Handoff

Date: 2026-05-12

## Current Decision

**KEEP_AS_INCUBATE_NO_CHANGE**

This candidate is incubated. It is not formally promoted as KEEP and it is not reverted.

## Current Workspace Status

At closeout start, `mem9` had:

```text
 M server/internal/handler/recall.go
 M server/internal/handler/recall_test.go
?? server/internal/handler/recall_trace.go
```

`mem9-benchmark` and `clawd` were clean.

After this closeout, three documentation files were added:

- `docs/mem9_final_selection_rescue_incubate_record.md`
- `docs/mem9_final_selection_rescue_artifact_index.md`
- `docs/mem9_final_selection_rescue_handoff.md`

No production behavior was changed in this closeout step.

## What Is Safe To Do Next

- Review harness engineering before restarting the optimization loop.
- Commit or archive the experiment documentation as evidence.
- Decide whether the incubating candidate should remain on the branch while harness engineering improves.
- Decide whether trace-only files should be removed, separately committed, or kept untracked for further diagnostics.

## What Must Not Be Done Next Without Explicit Approval

- Do not restart the harness.
- Do not start a new optimization experiment.
- Do not rerun full LoCoMo.
- Do not tune final-selection provenance rescue thresholds.
- Do not modify benchmark scoring.
- Do not modify answer prompts.
- Do not modify harness promotion rules.
- Do not modify ingestion, storage, or reconciliation.
- Do not promote this result as formal KEEP.

## What Remains Before Harness Restart

1. Complete planned harness engineering improvements.
2. Decide how to handle diagnostic trace code:
   - remove it before production-oriented work, or
   - commit it separately as debug tooling, or
   - keep it untracked while diagnostics continue.
3. Decide whether the incubating rescue candidate should be included in the next harness baseline or held aside.
4. Ensure `mem9-benchmark` and `clawd` remain clean before any new run.
5. Ensure future harness rules distinguish INCUBATE from formal KEEP and REVERT.

## Suggested Next Step

Proceed with harness engineering improvements, not optimization. The next work should improve experiment reliability and evidence handling before any new candidate is tested.

## Closeout Summary

- Decision: `KEEP_AS_INCUBATE_NO_CHANGE`.
- Benchmark was not rerun.
- Harness was not restarted.
- No code was changed during closeout.
- New closeout docs were created to preserve handoff context.
