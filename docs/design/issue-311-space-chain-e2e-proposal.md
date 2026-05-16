---
title: "Issue 311 Space Chain E2E Proposal"
---

# Issue 311 Space Chain E2E Proposal

## Context

Issue #311, opened on 2026-05-15, asks for missing end-to-end coverage for the Space Chain feature. The issue acceptance criteria are:

1. E2E test exists for the Space Chain feature.
2. Test covers the primary happy path.
3. Test is wired into the existing e2e test workflow.
4. Required setup and cleanup are handled by the test.

PR #308 merged Space Chain runtime support on 2026-05-15. The implementation added server-side chain management, `chain_` key auth, ordered recall/write behavior, and provenance. The remaining gap is a live smoke script that proves those pieces work together against a running server.

## Current Evidence

1. The PRD defines Space Chain as an ordered chain of Spaces, queried with a `chain_` key, where earlier nodes get the first chance to answer. See [docs/design/space-chain-prd.md:11](space-chain-prd.md).
2. The server exposes management endpoints for create, get-by-key, nodes, bindings, and disable under `/v1alpha2/space-chains`. See [server/internal/handler/handler.go:192](../../server/internal/handler/handler.go).
3. Runtime memory routes already accept `X-API-Key` through `/v1alpha2/mem9s/...`. See [server/internal/handler/handler.go:225](../../server/internal/handler/handler.go).
4. Chain recall iterates nodes in order, applies `chain_source`, and stops on the configured threshold. See [server/internal/handler/chain_runtime.go:66](../../server/internal/handler/chain_runtime.go).
5. Chain get/update/delete locate the target memory across nodes in order. See [server/internal/handler/chain_runtime.go:116](../../server/internal/handler/chain_runtime.go).
6. Existing live e2e coverage is bash-based and documented in `e2e/AGENTS.md`; the full smoke suite is currently documented as individual script invocations, not as one central runner. See [e2e/AGENTS.md:39](../../e2e/AGENTS.md).

## Proposed Scope

Create a new live API e2e script:

```text
e2e/api-smoke-test-space-chain.sh
```

This should be a server/API e2e test, not a dashboard UI test. The current repo has Space Chain runtime and management APIs, but no Space Chain dashboard UI route. If console UI coverage is required later, it should be added where the console Space Chain frontend/backend lives.

## Happy Path

The script should run against `MNEMO_BASE` and create all state it needs:

1. Healthcheck `GET /healthz`.
2. Provision two fresh Spaces with `POST /v1alpha1/mem9s`.
3. Create a Space Chain with `POST /v1alpha2/space-chains`, capturing `chain.id`, `chain_api_key`, and `binding_id`.
4. Verify `GET /v1alpha2/status` returns `{"status":"active"}` for the `chain_` key.
5. Replace nodes with the two provisioned tenant IDs using `PUT /v1alpha2/space-chains/{chainID}/nodes`, authenticated by the `chain_` key.
6. Verify `GET /v1alpha2/space-chains/{chainID}/nodes` returns two nodes in positions `0` and `1`.
7. Write a deterministic memory through the `chain_` key to `POST /v1alpha2/mem9s/memories`.
8. Poll `GET /v1alpha2/mem9s/memories?limit=50` with the `chain_` key until the memory materializes.
9. Assert the returned memory includes `chain_source.chain_id == chainID`, `node_position == 0`, and `tenant_id == first tenant`.
10. Get the memory by id through the `chain_` key and verify the same provenance.
11. Update the memory by id through the `chain_` key and verify version advances and provenance remains first-node.
12. Delete the memory by id through the `chain_` key and verify a later chain get returns `404`.
13. Soft-delete the chain with `DELETE /v1alpha2/space-chains/{chainID}` as best-effort cleanup.
14. Verify the deleted chain key is no longer active by expecting `GET /v1alpha2/status` to return `404` for the chain key.

## Secondary Checks

Keep these in the same script if they stay simple:

1. `GET /v1alpha2/space-chains/by-key` returns the created chain before cleanup.
2. `GET /v1alpha2/space-chains/{chainID}/bindings` returns the initial binding and raw `chain_api_key`.
3. Duplicate node replacement returns `400`.
4. Empty chain runtime behavior returns `400` before nodes are added, if this can be checked without making the happy path noisy.

I would not add threshold/short-circuit scoring assertions in this e2e script. Those are better covered by handler/service tests because live semantic scoring is environment-dependent.

## Wiring

1. Add the script to `e2e/`.
2. Update [e2e/AGENTS.md](../../e2e/AGENTS.md) quick reference, coverage table, env var table, and full smoke suite snippet.
3. Update [e2e/README.md](../../e2e/README.md) if we want that file to continue documenting all e2e scripts, though it currently focuses on CRDT scripts.
4. Do not wire this into GitHub Actions unless a live server secret/environment is already available. Current workflows do not appear to run the live e2e smoke suite automatically.

## Test Design Notes

1. Use the same bash style as existing smoke scripts: `set -euo pipefail`, `curl_json`, `http_code`, `body`, `check`, and `check_contains`.
2. Use Python stdlib for JSON extraction to match existing scripts.
3. Use `X-Mnemo-Agent-Id` on all memory/runtime calls.
4. Use `X-API-Key: $CHAIN_API_KEY` for chain management after create and for runtime memory operations.
5. Keep `POLL_TIMEOUT_S` configurable, defaulting to `30` or `60` seconds. Space Chain writes still use the same async memory ingestion path as normal v1alpha2 writes.
6. Generate unique names and session IDs with timestamp suffixes so repeated runs do not collide.
7. Treat cleanup as best-effort in a `cleanup` trap because the main test result should report the real failing step.

## Risks

1. Live async ingest may not materialize within the default timeout on slow environments. Mitigation: expose `POLL_TIMEOUT_S` and document using `60` seconds for dev ALB runs.
2. Search behavior depends on vector/full-text readiness. Mitigation: the primary assertion should use non-query list/get after writing a known memory; avoid score-specific recall expectations.
3. Provisioned test Spaces are not deleted by existing APIs. Mitigation: isolate by fresh tenant IDs and clean up the Space Chain itself.
4. The issue mentions API/UI behavior, but this repo does not currently expose Space Chain UI. Mitigation: document API e2e as this repo's coverage and leave UI e2e to the console repo when UI exists.

## Validation

After implementation:

1. `bash -n e2e/api-smoke-test-space-chain.sh`
2. `MNEMO_BASE=$DEV POLL_TIMEOUT_S=60 bash e2e/api-smoke-test-space-chain.sh`
3. Optional local/server validation if a local server and DSN are available.

## Effort Estimate

~120-180 LoC.
