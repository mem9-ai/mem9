---
title: e2e — Live end-to-end scripts
---

## Overview

This directory contains live end-to-end tests for server and CRDT behavior. These scripts hit a running mnemo-server and are not hermetic unit tests.

## Smoke tests — quick reference

`api-smoke-test.sh` and `api-smoke-test-round2.sh` support v1alpha1 and v1alpha2
via `MNEMO_API_VERSION`. Default is `v1alpha1`.

```bash
DEV=http://<dev-alb-endpoint>

# v1alpha1 only
MNEMO_BASE=$DEV bash e2e/api-smoke-test.sh
MNEMO_BASE=$DEV POLL_TIMEOUT_S=60 bash e2e/api-smoke-test-round2.sh

# v1alpha2 only
MNEMO_BASE=$DEV bash e2e/api-smoke-test-v1alpha2.sh
MNEMO_BASE=$DEV POLL_TIMEOUT_S=60 bash e2e/api-smoke-test-round2-v1alpha2.sh

# Session storage tests (both API versions)
MNEMO_BASE=$DEV POLL_TIMEOUT_S=60 bash e2e/api-smoke-test-sessions.sh
MNEMO_BASE=$DEV MNEMO_API_VERSION=v1alpha2 POLL_TIMEOUT_S=60 bash e2e/api-smoke-test-sessions.sh

# Existing-tenant backward-compat check (requires a pre-existing tenant ID)
MNEMO_BASE=$DEV MNEMO_EXISTING_TENANT_ID=<id> POLL_TIMEOUT_S=60 bash e2e/api-smoke-test-existing-tenant.sh

# Full smoke suite
for script in \
  "e2e/api-smoke-test.sh" \
  "e2e/api-smoke-test-v1alpha2.sh" \
  "POLL_TIMEOUT_S=60 e2e/api-smoke-test-round2.sh" \
  "POLL_TIMEOUT_S=60 e2e/api-smoke-test-round2-v1alpha2.sh" \
  "POLL_TIMEOUT_S=60 e2e/api-smoke-test-sessions.sh"; do
  eval "MNEMO_BASE=$DEV bash $script"
done
MNEMO_BASE=$DEV MNEMO_EXISTING_TENANT_ID=<id> POLL_TIMEOUT_S=60 bash e2e/api-smoke-test-existing-tenant.sh
```

## Smoke test coverage

### Round 1 (`api-smoke-test.sh`)

Focuses on **write paths and search**. Each test uses a freshly provisioned tenant;
per-ID tests (9-11) are skipped if the async ingest pipeline has not yet materialised
any memories by the time the list runs.

| # | Case | What is verified |
|---|------|-----------------|
| 1 | Healthcheck | `GET /healthz` returns 200 with `status=ok` |
| 2 | Provision tenant | `POST /v1alpha1/mem9s` returns 201 with an `id` field |
| 3 | Ingest via messages | `POST /memories` with `messages[]` returns 202 `accepted` |
| 4 | Ingest via content | `POST /memories` with `content` field returns 202 `accepted` |
| 5 | Validation errors | `content+messages` → 400; `content+tags` → 202; empty body → 400 |
| 6 | List memories | `GET /memories` returns 200 with `memories` array and `total` field; `relative_age` non-empty on first memory (if any) |
| 7 | Search by query | `GET /memories?q=TiDB` and no-match query both return 200; `confidence` non-empty on first result (if any) |
| 8 | Search by tags | `GET /memories?tags=tidb` returns 200 with `memories` array |
| 9 | Get by ID | `GET /memories/{id}` returns 200 with matching `id` field |
| 10 | Update memory | `PUT /memories/{id}` returns 200, version bumps, tag change reflected |
| 11 | Delete + verify 404 | `DELETE /memories/{id}` returns 204; subsequent GET returns 404 |

### Round 2 (`api-smoke-test-round2.sh`)

Focuses on **per-ID lifecycle** with deterministic state. Writes one known memory,
polls until it materialises, then runs all mutations sequentially on that ID.
Version checks use `>` (version advanced) rather than exact equality to tolerate
concurrent async ingest bumps.

| # | Case | What is verified |
|---|------|-----------------|
| 1 | Provision fresh tenant | `POST /v1alpha1/mem9s` returns 201 with an `id` field |
| 2 | Write known memory | `POST /memories` with `content` + `tags` returns 202 `accepted` |
| 3 | Poll until materialised | `GET /memories` polled until a memory appears (up to `POLL_TIMEOUT_S`) |
| 4 | Get by ID | `GET /memories/{id}` returns 200, ID matches, `content` field present |
| 5 | Update memory | `PUT /memories/{id}` returns 200, version advanced, content and tag updated |
| 6 | Stale If-Match (LWW) | `PUT` with outdated `If-Match` still returns 200 — LWW always wins, no hard rejection |
| 7 | Delete | `DELETE /memories/{id}` returns 204 |
| 8 | Get after delete | `GET /memories/{id}` returns 404 |
| 9 | Idempotent re-delete | Second `DELETE` on already-deleted ID returns 204 (no-op, not 404) |

### Session storage (`api-smoke-test-sessions.sh`)

Regression tests for raw session storage (PR #103). Provisions a fresh tenant,
ingests messages, and verifies all session-specific behaviors: session exclusion from
unified recall, `memory_type` filtering, metadata projection, no-query exclusion, and deduplication.
Supports both v1alpha1 and v1alpha2 via `MNEMO_API_VERSION`.

| # | Case | What is verified |
|---|------|-----------------|
| 1 | Provision tenant | `POST /v1alpha1/mem9s` returns 201 |
| 2 | Session write via messages | `POST /memories {messages}` returns 202 `accepted` |
| 3 | Poll until sessions appear | `GET /memories?memory_type=session&q=` polled until results appear |
| 4 | Unified search includes sessions | `GET /memories?q=` returns `memory_type=session` rows via confidence recall (PR #202) |
| 5 | `memory_type=session` filter | All results have `memory_type=session`; no other types |
| 6 | `memory_type=insight` excludes sessions | No `memory_type=session` rows when insight filter applied |
| 7 | Session metadata projection | First session result has `role`, `seq`, `content_type` in `metadata` |
| 8 | No-query list excludes sessions | `GET /memories` (no `?q=`) returns no `memory_type=session` rows |
| 9 | `session_id` scoped filter | All results belong to the expected `session_id` |
| 10 | Deduplication | Re-sending identical messages does not increase row count |
| 11 | Existing tenant: session write | `POST /memories {messages}` on pre-existing tenant returns 202 (requires `MNEMO_EXISTING_TENANT_ID`) |
| 12 | Existing tenant: lazy migration | Poll + retry writes until sessions appear — proves `EnsureSessionsTable` creates table in flight |
| 13 | Existing tenant: filter after migration | `memory_type=session` filter works correctly after lazy migration |

### Existing-tenant compat (`api-smoke-test-existing-tenant.sh`)

Backward-compatibility check: exercises a **pre-existing tenant** (created before the
current deployment) to verify that old data and auth remain fully functional after an
upgrade. Requires `MNEMO_EXISTING_TENANT_ID` pointing to a real tenant with stored
memories. Covers both v1alpha1 and v1alpha2 auth in every operation.

| # | Case | What is verified |
|---|------|-----------------|
| 1 | v1alpha1 list | `GET /memories` returns 200, tenant has pre-existing memories |
| 2 | v1alpha2 list | `X-API-Key` header returns same total as v1alpha1 |
| 3 | v1alpha1 GET by ID | 200, ID matches, `content` field present |
| 4 | v1alpha2 GET by ID | 200, same ID returned |
| 5 | v1alpha1 search | `?q=memory` returns 200 |
| 6 | v1alpha2 search | `?q=memory` returns 200 |
| 7 | v1alpha1 tag filter | `?tags=smoke` returns 200 with memories array |
| 8 | v1alpha1 PUT update | 200, version advanced, `compat-check` tag applied |
| 9 | v1alpha2 PUT update | 200, version advanced, `compat-check` tag applied |
| 10 | v1alpha1 new write | `POST /memories` returns 202 accepted |
| 11 | v1alpha2 new write | `POST /memories` returns 202 accepted |
| 12 | Poll materialise | New writes appear in `?tags=compat-check` within `POLL_TIMEOUT_S` |

## Commands

```bash
# CRUD smoke tests
bash e2e/api-smoke-test.sh
bash e2e/api-smoke-test-round2.sh

# Session storage regression tests
bash e2e/api-smoke-test-sessions.sh

# Existing-tenant backward-compat check
MNEMO_EXISTING_TENANT_ID=<id> bash e2e/api-smoke-test-existing-tenant.sh

# CRDT / user-space model tests
bash e2e/crdt-e2e-tests.sh
python3 e2e/plugin-crdt-e2e.py
python3 e2e/crdt-server-merge-e2e.py
python3 e2e/concurrent-real-doc-test.py
```

## Prerequisites

- Running mnemo-server (`MNEMO_BASE` defaults to `https://api.mem9.ai`; dev ALB URL above)
- `MNEMO_EXISTING_TENANT_ID` exported for the existing-tenant compat script (any active tenant ID from the metadb)
- `MNEMO_TEST_USER_TOKEN` exported for CRDT/user-space scripts
- Python 3.8+
- `jq` for bash scripts

## API surfaces

- `api-smoke-test.sh` / `api-smoke-test-v1alpha2.sh` — CRUD smoke, ingest, search, tag filter (tests 1–11)
- `api-smoke-test-round2.sh` / `api-smoke-test-round2-v1alpha2.sh` — per-ID ops: GET, PUT, If-Match LWW, DELETE, idempotent re-delete (tests 1–9)
- `api-smoke-test-sessions.sh` — session storage: write, dedup, unified search, type filter, metadata, no-query exclusion, lazy migration (tests 1–13; tests 11–13 require `MNEMO_EXISTING_TENANT_ID`)
- `api-smoke-test-existing-tenant.sh` — backward-compat: pre-existing tenant read/write/search across v1alpha1 and v1alpha2 (tests 1–12)
- `crdt-*` and `plugin-crdt-*` use the CRDT branch `/api/users`, `/api/spaces/provision`, `/api/memories` surface.
- Check the server branch/API shape before mixing the two sets.

## Env vars

| Variable | Default | Used by |
|----------|---------|---------|
| `MNEMO_BASE` | `https://api.mem9.ai` | all smoke scripts |
| `MNEMO_API_VERSION` | `v1alpha1` | `api-smoke-test.sh`, `api-smoke-test-round2.sh`, `api-smoke-test-sessions.sh` |
| `POLL_TIMEOUT_S` | `20` (round2), `30` (sessions) | `api-smoke-test-round2*.sh`, `api-smoke-test-sessions.sh`, `api-smoke-test-existing-tenant.sh` |
| `MNEMO_EXISTING_TENANT_ID` | — | `api-smoke-test-existing-tenant.sh`, `api-smoke-test-sessions.sh` (tests 11–13) |
| `MNEMO_TEST_BASE` | `http://127.0.0.1:18081` | CRDT scripts |
| `MNEMO_TEST_USER_TOKEN` | — | CRDT scripts |

## Where to look

| Script | API version | Focus |
|--------|-------------|-------|
| `api-smoke-test.sh` | v1alpha1 (default) or v1alpha2 | CRUD smoke: ingest, list, search, tag filter, per-ID |
| `api-smoke-test-v1alpha2.sh` | v1alpha2 | One-liner wrapper — sets `MNEMO_API_VERSION=v1alpha2` |
| `api-smoke-test-round2.sh` | v1alpha1 (default) or v1alpha2 | Per-ID ops: GET, PUT, If-Match LWW, DELETE, idempotent re-delete |
| `api-smoke-test-round2-v1alpha2.sh` | v1alpha2 | One-liner wrapper — sets `MNEMO_API_VERSION=v1alpha2` |
| `api-smoke-test-sessions.sh` | v1alpha1 (default) or v1alpha2 | Session storage: write, dedup, unified search, type filter, metadata |
| `api-smoke-test-existing-tenant.sh` | v1alpha1 + v1alpha2 | Backward-compat: pre-existing tenant full lifecycle, both auth modes |
| `crdt-e2e-tests.sh` | CRDT branch | Core CRDT server behavior |
| `plugin-crdt-e2e.py` | CRDT branch | Plugin clock propagation |
| `crdt-server-merge-e2e.py` | CRDT branch | Section merge regression |
| `concurrent-real-doc-test.py` | CRDT branch | Real-document concurrent edit flow |

## Local conventions

- Each script provisions its own tenant / keys; runs are repeatable and isolated.
- These scripts validate live behavior, so failures may be env/data issues rather than local code regressions.
- `crdt-server-merge-e2e.py` is the primary regression signal for section merge logic.
- `api-smoke-test-sessions.sh` is the primary regression signal for raw session storage.
- `MNEMO_TEST_USER_TOKEN` is a one-time setup input for the CRDT scripts; those scripts provision spaces afterward.
- Version checks in round2 use `>` (version advanced), not exact equality — the async ingest pipeline may bump versions concurrently.

## Anti-patterns

- Do NOT treat these as offline unit tests.
- Do NOT hardcode long-lived tokens into scripts.
- Do NOT change API paths casually; scripts double as executable documentation.
- Do NOT mix old tenant-API assumptions into CRDT scripts or vice versa.
