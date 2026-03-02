---
title: E2E Tests
---

End-to-end tests for the CRDT branch with user/space model. All scripts run
against a live mnemo-server instance using the `user_space_test_01` database
with auto-embedding enabled.

## Prerequisites

- mnemo-server running on `127.0.0.1:18081` (see CLAUDE.md for startup)
- A user token provisioned in `user_space_test_01` (hardcoded in each script)
- Python 3.8+ or bash (no extra dependencies — stdlib only)
- `jq` installed (for bash script)

## Scripts

| Script | What it tests |
|--------|--------------|
| `crdt-e2e-tests.sh` | Core CRDT server behavior: LWW fast path, dominating/dominated writes, concurrent tie-break, tombstone, write_id idempotency, bootstrap endpoint (8 tests) |
| `plugin-crdt-e2e.py` | Plugin Option C clock strategy: simulates `ServerBackend.store()` read-increment-write flow, verifies clock propagation end-to-end (6 tests) |
| `crdt-server-merge-e2e.py` | Server-side section merge: two agents write disjoint sections concurrently, server merges atomically via `X-Mnemo-Merged`, both agents read identical final content (13 tests) |
| `concurrent-real-doc-test.py` | End-to-end with a real-document-like memory: creates a 10-section proposal document, then two agents concurrently edit disjoint sections, server merges atomically (13 tests) |

## Running

```bash
bash e2e/crdt-e2e-tests.sh
python3 e2e/plugin-crdt-e2e.py
python3 e2e/crdt-server-merge-e2e.py
python3 e2e/concurrent-real-doc-test.py
```

## Notes

- Each script provisions its own workspace via `POST /api/spaces/provision` — no hardcoded space tokens.
- Each run creates new keys with a timestamp suffix — safe to run multiple times.
- All scripts send `X-Mnemo-Agent-Id` header on every request.
- `crdt-server-merge-e2e.py` is the primary regression test for the section merge feature.
