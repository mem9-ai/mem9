---
title: e2e — Live end-to-end scripts
---

## Overview

This directory contains live end-to-end tests for server and CRDT behavior. These scripts hit a running mnemo-server and are not hermetic unit tests.

## Commands

```bash
# Original tenant API smoke tests
bash e2e/api-smoke-test.sh
bash e2e/api-smoke-test-round2.sh

# CRDT / user-space model tests
bash e2e/crdt-e2e-tests.sh
python3 e2e/plugin-crdt-e2e.py
python3 e2e/crdt-server-merge-e2e.py
python3 e2e/concurrent-real-doc-test.py
```

## Prerequisites

- Running mnemo-server (`MNEMO_TEST_BASE` defaults to `http://127.0.0.1:18081`)
- `MNEMO_TEST_USER_TOKEN` exported for CRDT/user-space scripts
- Python 3.8+
- `jq` for bash scripts

## API surfaces

- `api-smoke-test*.sh` use the original `/v1alpha1/mem9s/{tenantID}/memories` tenant API.
- `crdt-*` and `plugin-crdt-*` use the CRDT branch `/api/users`, `/api/spaces/provision`, `/api/memories` surface.
- Check the server branch/API shape before mixing the two sets.

## Where to look

| Script | Focus |
|--------|-------|
| `api-smoke-test.sh` | Original CRUD smoke on tenant API |
| `api-smoke-test-round2.sh` | Original API round-2 flow (`If-Match`, update/delete) |
| `crdt-e2e-tests.sh` | Core CRDT server behavior |
| `plugin-crdt-e2e.py` | Plugin clock propagation |
| `crdt-server-merge-e2e.py` | Section merge regression |
| `concurrent-real-doc-test.py` | Real-document concurrent edit flow |

## Local conventions

- Each script provisions its own workspace / keys; runs should be repeatable.
- These scripts validate live behavior, so failures may be env/data issues rather than local code regressions.
- `crdt-server-merge-e2e.py` is the primary regression signal for section merge logic.
- `MNEMO_TEST_USER_TOKEN` is a one-time setup input for the CRDT scripts; those scripts provision spaces afterward.

## Anti-patterns

- Do NOT treat these as offline unit tests.
- Do NOT hardcode long-lived tokens into scripts.
- Do NOT change API paths casually; scripts double as executable documentation.
- Do NOT mix old tenant-API assumptions into CRDT scripts or vice versa.
