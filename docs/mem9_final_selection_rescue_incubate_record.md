# mem9 Final-Selection Provenance Rescue Incubate Record

Date: 2026-05-12

Decision: **KEEP_AS_INCUBATE_NO_CHANGE**

This is not a formal KEEP promotion. This is not a REVERT. The harness must not be restarted from this record alone.

## Final Dirty-State Inventory

`mem9` dirty state at closeout start:

```text
 M server/internal/handler/recall.go
 M server/internal/handler/recall_test.go
?? server/internal/handler/recall_trace.go
```

`mem9-benchmark` and `clawd` were clean.

| File | Classification | Recommendation |
| --- | --- | --- |
| `server/internal/handler/recall.go` | candidate implementation plus trace hook call sites | Keep for incubate branch. Revert candidate helper/call sites before abandoning experiment. Before production promotion, remove or explicitly approve trace hook call sites. |
| `server/internal/handler/recall_test.go` | focused tests | Keep for incubate branch. Include only if candidate implementation remains. |
| `server/internal/handler/recall_trace.go` | trace-only diagnostic helper | Optional cleanup later. Keep untracked only while diagnostics need it; remove or separately commit as diagnostic tooling before production promotion. |
| `docs/mem9_final_selection_rescue_replay.md` | experiment documentation | Archive as evidence. |
| `docs/mem9_final_selection_rescue_implementation.md` | experiment documentation | Archive as evidence. |
| `docs/mem9_final_selection_rescue_predict_only_result.md` | experiment documentation | Archive as evidence. |
| `docs/mem9_final_selection_rescue_full_benchmark_result.md` | experiment documentation | Archive as evidence. |
| `docs/mem9_final_selection_rescue_incubate_analysis.md` | experiment documentation | Archive as evidence. |
| `docs/mem9_final_selection_rescue_incubate_record.md` | experiment documentation | Archive as evidence. |
| `docs/mem9_final_selection_rescue_artifact_index.md` | experiment documentation | Archive as evidence. |
| `docs/mem9_final_selection_rescue_handoff.md` | experiment documentation | Archive as evidence. |

No unrelated dirty files were found.

## Why This Is Not KEEP

The full LoCoMo run did not reach the stricter promotion gate.

| Promotion signal | Result |
| --- | ---: |
| Overall LLM movement | `+0.67pp` |
| KEEP threshold | `+1.0pp` or pairwise net `+15` |
| Pairwise LLM net | `+11` |
| Non-target LLM net | `-8` |

The experiment is promising, but the LLM gain is not strong enough to formally promote. Cat2/Cat3 and non-target LLM movement also require caution.

## Why This Is Not REVERT

The evidence signal is positive and production-legitimate:

- Overall LLM improved from `68.29%` to `68.97%`.
- Overall F1 improved by `+0.94pp`.
- Overall ER improved by `+4.32pp`.
- Cat4 LLM improved by `+1.85pp`.
- Cat4 ER improved by `+5.03pp`.
- Target evidence movement was `42` improved, `118` neutral, `0` regressed, `1` missing.
- Returned memory count and context size did not expand.

Reverting now would discard a real target-evidence gain without a confirmed harmful rule pattern.

## Exact Changed Files

Candidate/runtime files:

| File | Role |
| --- | --- |
| `server/internal/handler/recall.go` | Final-selection provenance rescue implementation and trace hook call sites. |
| `server/internal/handler/recall_test.go` | Focused tests for rescue behavior and guardrails. |
| `server/internal/handler/recall_trace.go` | Trace-only helper gated by `MNEMO_RECALL_TRACE_DIR`; diagnostic-only. |

Experiment evidence docs:

| File | Role |
| --- | --- |
| `docs/mem9_final_selection_rescue_replay.md` | Offline replay result. |
| `docs/mem9_final_selection_rescue_implementation.md` | Implementation record. |
| `docs/mem9_final_selection_rescue_predict_only_result.md` | Predict-only validation result. |
| `docs/mem9_final_selection_rescue_full_benchmark_result.md` | Full benchmark result. |
| `docs/mem9_final_selection_rescue_incubate_analysis.md` | Regression/incubation analysis. |
| `docs/mem9_final_selection_rescue_incubate_record.md` | This closeout record. |
| `docs/mem9_final_selection_rescue_artifact_index.md` | Artifact index. |
| `docs/mem9_final_selection_rescue_handoff.md` | Handoff state. |

## Benchmark Command Used

```bash
env -u MNEMO_RECALL_TRACE_DIR \
  LOCOMO_PROTOCOL=mem0-style \
  LOCOMO_ANSWER_PROMPT=mem0-speaker \
  LOCOMO_SPEAKER_INGEST_MODE=batch2 \
  LOCOMO_SPEAKER_TOP_K=10 \
  MEM9_RETRIEVAL_LIMIT=20 \
  USING_LAST_INGEST=false \
  LOCOMO_PREDICT_ONLY=false \
  LOCOMO_HARNESS_AUTOWRITE=false \
  bash /home/ec2-user/git/clawd/disc/scripts/locomo.sh
```

No benchmark was run during this closeout step.

## Key Metrics

| Metric | Result |
| --- | ---: |
| Overall LLM | `68.97%` vs `68.29%`, `+0.67pp` |
| Overall F1 | `+0.94pp` |
| Overall ER | `+4.32pp` |
| Cat4 LLM | `+1.85pp` |
| Cat4 ER | `+5.03pp` |
| Pairwise LLM net | `+11` |
| Target evidence movement | `42` improved, `118` neutral, `0` regressed, `1` missing |
| Target LLM movement | `26` improved, `127` neutral, `7` regressed, `1` missing |
| Non-target LLM movement | `69` wins, `77` losses, net `-8` |

## Known Risks

- Cat2 slight regression: LLM `-0.62pp`, ER `-0.60pp`.
- Cat3 small-sample regression: LLM `-2.08pp` on `n=96`.
- Non-target LLM net negative: `69` wins, `77` losses.
- Mixed F1 regressed despite mixed LLM flat and mixed ER positive.
- Four provider `DataInspectionFailed` drops:
  - `conv-30:72`
  - `conv-30:76`
  - `conv-30:85`
  - `conv-47:136`

## Why No Bounded Guardrail Is Approved

The incubation analysis considered one plausible guardrail: disabling rescue for exact temporal/numeric query shapes. It is not approved because:

- It would not address the seven target LLM regressions.
- It would remove some Cat2 losses but also remove Cat2 wins.
- Same-cache predict-only evidence movement for exact temporal/numeric rows was positive overall.
- Cat3 and non-target regressions are heterogeneous.

The current evidence supports incubation without refinement, not threshold tuning.

## Rollback Instructions

To abandon this incubating candidate:

1. Revert the final-selection provenance rescue helper and call sites in `server/internal/handler/recall.go`.
2. Revert focused rescue tests in `server/internal/handler/recall_test.go`.
3. Remove `server/internal/handler/recall_trace.go` if trace diagnostics are no longer needed.
4. Keep docs as evidence unless explicitly cleaning the branch.

Do not change benchmark, prompt, scoring, harness, ingestion, storage, or reconciliation files as part of this rollback.

## Future Promotion Conditions

Before formal KEEP or production promotion:

- Re-run only after explicit approval and after harness engineering improvements are complete.
- Prefer a clean same-cache control or controlled fresh-run lane that can separate rescue behavior from fresh-ingest variance.
- Require Overall LLM `+1.0pp` or pairwise net `+15`.
- Require no severe Cat2, Cat4, or mixed-speaker regression.
- Confirm target evidence gains remain positive and target evidence regressions remain zero.
- Decide whether trace hooks and `recall_trace.go` belong in a separate diagnostic commit or should be removed.
