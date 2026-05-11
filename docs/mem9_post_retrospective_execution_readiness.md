# mem9 Post-Retrospective Execution Readiness

Date: 2026-05-11 UTC

Mode: readiness audit only. No production code, benchmark code, harness logic,
prompt, config, scoring logic, full LoCoMo benchmark, or Experiment #1 execution
was performed for this report.

## Executive Recommendation

**NO-GO for starting authoritative Experiment #1 yet.**

The repos are currently clean and the active baseline/gate is usable as policy,
but the current live `last-ingest-cache.json` and `locomo-cache` backend should
not be trusted for ER0 storage-vs-retrieval attribution. The cache is complete at
the file/backend-manifest level, but its producer lineage is tied to the reverted
iteration 548 product candidate. Experiment #1 requires read-only trace/query
tooling against a clean backend, so the clean backend/cache must be rebuilt or
restored before using live stored-memory or candidate-pool evidence.

Allowed before that rebuild: offline row inventory from the accepted baseline
result only. That is not enough to complete Experiment #1 because it cannot prove
stored-but-not-retrieved versus never-stored/incorrectly-merged.

## 1. Git Dirty State

Read-only commands executed:

```bash
git -C /home/ec2-user/git/mem9 status --short --branch
git -C /home/ec2-user/git/mem9-benchmark status --short --branch
git -C /home/ec2-user/git/clawd status --short --branch
```

Observed output:

```text
## arch/level2...origin/arch/level2
## arch/level2...origin/arch/level2
## main...origin/main
```

Current latest observed commits:

| Repo | Branch | Latest observed commit | Dirty files |
|---|---|---|---|
| `/home/ec2-user/git/mem9` | `arch/level2` | `edad37e docs: raise locomo promotion gate` | none |
| `/home/ec2-user/git/mem9-benchmark` | `arch/level2` | `2ce9c32 fix: raise locomo default promotion gate` | none |
| `/home/ec2-user/git/clawd` | `main` | `84b35b0 feat: update` | none |

Historical caveat: the latest harness-review artifact still records prior dirty
state in `server/internal/handler/recall.go` and harness observability files
(`/home/ec2-user/Documents/Dev/harness/results/20260510T210619-553-harness-review/harness-review-summary.json:193-214`).
That artifact is stale relative to the current git status above and should not
be treated as current dirty state.

## 2. Score-Affecting Dirty Files

Current score-affecting dirty files: **none**.

Current harness/observability dirty files: **none**.

Conclusion: dirty state is not a blocker now. Continue to re-check this before
any experiment because the audit preconditions require score-affecting files to
be clean or explicitly declared as the candidate under test
(`/home/ec2-user/git/mem9/docs/mem9_harness_experiment_matrix.md:10-16`).

## 3. Current Cache Trustworthiness

Current cache file:

- `/home/ec2-user/git/mem9-benchmark/locomo/results/last-ingest-cache.json`

Observed properties:

- `created_at`: `2026-05-10T16:42:56.710Z`
  (`/home/ec2-user/git/mem9-benchmark/locomo/results/last-ingest-cache.json:7`)
- `protocol`: `mem0-style`
  (`/home/ec2-user/git/mem9-benchmark/locomo/results/last-ingest-cache.json:12`)
- `combined_limit`: `20`
  (`/home/ec2-user/git/mem9-benchmark/locomo/results/last-ingest-cache.json:6`)
- sample count: 10, from direct JSON inspection
- sha256: `3a40b92b608ea67d33c3dd41e0b734e9dd2e5b8bf10339ff53ee1bd2000c26d8`

Current cache backend manifest:

- `/home/ec2-user/Documents/Dev/harness/results/20260510T202934Z-549-cached-control-current-cache/cache-backend-manifest.json`
- same cache sha and created time
  (`.../cache-backend-manifest.json:5-7`)
- `sample_count=10`, `expected_sample_count=10`, `complete=true`
  (`.../cache-backend-manifest.json:8-10`)
- backend `locomo-cache`, TiDB port `14000`, active memory count `7929`
  (`.../cache-backend-manifest.json:11-15`)

Lineage problem:

- Registry line 553 is a product-path `valid_product_revert` for
  `20260510T200341Z-548-carried-product-validation`, with changed file
  `server/internal/service/memory.go`, result
  `/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-10T16-42-56-655Z_mem0-style.json`,
  and score `66.67`.
- The learn for that same product run says the candidate family was
  `mem9/server` retrieval, the change-under-test was
  `server/internal/service/memory.go`, and the run was rejected/reverted
  (`/home/ec2-user/Documents/Dev/harness/learns/entity_confirmed_keyword_product_revert_20260510T164239Z_548.md:7-27`).
- The reverted product run's own backend manifest has the same cache sha and
  `cache_created_at=2026-05-10T16:42:56.710Z`
  (`/home/ec2-user/Documents/Dev/harness/results/20260510T200341Z-548-carried-product-validation/log_bundle/cache-backend-manifest.json:5-7`).
- Registry line 555 later records a cached no-change control on that same cache
  sha as `valid_same_cache_control`, but this only proves the cache was complete
  and runnable; it does not prove clean producer lineage.

Conclusion: **do not trust current `last-ingest-cache.json` for clean
comparisons or authoritative ER0 attribution.** It must be invalidated or rebuilt
from clean no-change code before it is used as a live backend/candidate-pool
source.

## 4. Cache Lineage Decision

Cache lineage is **not clean enough**.

Evidence summary:

| Cache | Registry evidence | Status |
|---|---|---|
| `2026-05-10T12:26:48.358Z`, sha `90a7...` | registry line 551 `valid_control_cache_recovery`, line 552 `valid_same_cache_control` | historical clean cache/control, later superseded |
| `2026-05-10T16:42:56.710Z`, sha `3a40...` | registry line 553 product-path revert; line 555 cached control on same cache | current cache is complete but lineage-contaminated |

Current live processes also point at the current cache/backend lineage:

- `tiup playground ... --tag locomo-cache --db.port=14000`
- `/home/ec2-user/locomo-logs/20260510T204450/mnemo-server`

This process state was inspected only with `ps`; no server was started or
stopped.

## 5. Controls That Need Rebuild

Before any candidate comparison:

1. Rebuild or restore a clean product-path/cache-rehydration control from clean
   no-change code. The current `last-ingest-cache` should not be used.
2. If the next work uses retrieval/ranking/context-only cached analysis, rebuild
   a clean same-cache control on the rebuilt clean cache.
3. For any later promotion comparison, record control variance. The audit matrix
   requires at least 3 clean product-path controls and at least 3 same-cache
   controls for retrieval-only work
   (`/home/ec2-user/git/mem9/docs/mem9_harness_experiment_matrix.md:14`).

Baseline doc caveat:

- The active baseline doc says there is no cached-retrieval same-cache control
  yet for the accepted baseline cache
  `last-ingest-cache created_at=2026-05-10T02:50:01.599Z`
  (`/home/ec2-user/git/mem9/benchmark/BASELINE.md:48-53`).
- Therefore, the accepted baseline result is usable as a product-framework
  baseline, but not as a ready live cached-control environment.

## 6. Baseline And Gate Usability

Baseline/gate is usable as policy.

Source of truth:

- `/home/ec2-user/git/mem9/benchmark/BASELINE.md`
- `/home/ec2-user/Documents/Dev/harness/state/mem9_locomo_baseline_lock.json`

Accepted active-framework baseline:

- Result:
  `/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-10T02-50-01-542Z_mem0-style.json`
  (`/home/ec2-user/git/mem9/benchmark/BASELINE.md:14-23`)
- Overall LLM micro: `68.29%`
  (`/home/ec2-user/git/mem9/benchmark/BASELINE.md:31-34`, `:75-80`)
- Promotion gate: `69.29%`
  (`/home/ec2-user/git/mem9/benchmark/BASELINE.md:31-38`)
- Expected clean-run denominator shape: 1,985 F1 rows and 1,539 LLM-judged rows
  due one provider `DataInspectionFailed`
  (`/home/ec2-user/git/mem9/benchmark/BASELINE.md:42-46`)

State lock check:

- `mem9_locomo_baseline_lock.json` currently reports
  `overall_llm_micro=68.29` and `promotion_gate_llm_micro=69.29`.
- `mem9_locomo_harness_state.json` currently reports `status=stopped`,
  `baseline_llm_micro=68.29`, and `keep_threshold_llm_micro=69.29`.

Usability caveat:

- This gate should not be used as single-run proof. The audit states that future
  work needs pairwise row-level movement, fixed denominator accounting, and
  separated pipeline-stage measurements
  (`/home/ec2-user/git/mem9/docs/mem9_harness_retrospective.md:157-176`,
  `:215-222`).

## 7. Blockers Before Experiment #1

Experiment #1 is ER0 storage-vs-retrieval attribution. Its own plan says:

- no code change;
- no full benchmark;
- use read-only trace/query tooling against a clean backend only;
- classify at least 50 Cat1/Cat4 ER0 failures;
- produce row-level evidence including stored candidate status and first rank
  (`/home/ec2-user/git/mem9/docs/mem9_harness_next_5_experiments.md:21-68`).

Current blockers:

1. **Clean live backend is not available.** The current backend/cache has
   lineage from the reverted iteration 548 candidate.
2. **Current cache must be invalidated.** It is structurally complete but not a
   clean producer-lineage source.
3. **Accepted baseline cache is not current `last-ingest-cache`.** The baseline
   doc points to a different accepted run/cache and explicitly says no
   same-cache control exists yet for that accepted baseline cache.
4. **Control variance is not rebuilt in the post-retrospective environment.**
   The audit requires multiple clean controls before candidate comparisons.
5. **Registry rows after the gate change contain historical `promotion_gate=68.59`
   values.** Treat rows 551-556 as historical evidence only; current formal gate
   is `69.29`.

Non-blockers:

- Current git dirty state is clean across all three repos.
- Active baseline/gate values are coherent between baseline docs and runtime
  state.
- Existing artifacts are sufficient for offline row inventory and denominator
  checks.

## 8. GO / NO-GO For Read-Only ER0 Attribution

Recommendation: **NO-GO for authoritative Experiment #1 until a clean backend is
rebuilt or restored.**

Rationale:

- Experiment #1 requires classifying ER0 rows by stored-memory status and
  candidate-pool rank. Querying the current `locomo-cache` backend would mix the
  analysis with a reverted candidate's memory/ranking state.
- Running only against the accepted baseline result JSON can identify ER0 rows
  and questions, but cannot determine whether the relevant facts are absent from
  storage or merely absent from final top-20 retrieval.

Permitted preparatory work without changing this recommendation:

- Build an offline ER0 row inventory from the accepted baseline result:
  `/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-10T02-50-01-542Z_mem0-style.json`
- Record row ids, category, speaker bucket, question, answer, evidence ids,
  retrieved-context evidence status, and denominator metadata.
- Do not query live storage/candidate pools until the clean backend/cache issue
  is resolved.

Required next action before GO:

- Rebuild or restore a clean no-change backend/cache for the active framework,
  then record a clean cache/backend manifest and same-cache control identity.
  Only after that should Experiment #1 perform live read-only storage and
  candidate-pool attribution.

