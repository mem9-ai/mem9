---
title: E2E Tests
---

End-to-end tests against a live mnemo-server instance. Server API smoke scripts
use `MNEMO_BASE`; CRDT user/space scripts use `MNEMO_TEST_BASE` and
`MNEMO_TEST_USER_TOKEN`.

## Server API Smoke

| Script | What it tests |
|--------|--------------|
| `api-smoke-test-space-chain.sh` | Space Chain management/runtime happy path: create chain, validate nodes and bindings, write/read/update/delete through a `chain_` key, and cleanup |

```bash
MNEMO_BASE=https://api.mem9.ai POLL_TIMEOUT_S=60 bash e2e/api-smoke-test-space-chain.sh
```

## Prerequisites

- mnemo-server running (`MNEMO_BASE` for server API smoke scripts;
  `MNEMO_TEST_BASE` defaults to `127.0.0.1:18081` for CRDT scripts)
- `MNEMO_TEST_USER_TOKEN` env var set to a valid user token (see below)
- Python 3.8+ or bash (no extra dependencies — stdlib only)
- `jq` installed (for bash script)

## CRDT Scripts

| Script | What it tests |
|--------|--------------|
| `crdt-e2e-tests.sh` | Core CRDT server behavior: LWW fast path, dominating/dominated writes, concurrent tie-break, tombstone, write_id idempotency, bootstrap endpoint (8 tests) |
| `plugin-crdt-e2e.py` | Plugin Option C clock strategy: simulates `ServerBackend.store()` read-increment-write flow, verifies clock propagation end-to-end (6 tests) |
| `crdt-server-merge-e2e.py` | Server-side section merge: two agents write disjoint sections concurrently, server merges atomically via `X-Mnemo-Merged`, both agents read identical final content (13 tests) |
| `concurrent-real-doc-test.py` | End-to-end with a real-document-like memory: creates a 10-section proposal document, then two agents concurrently edit disjoint sections, server merges atomically (13 tests) |

## Running

```bash
# 1. Provision a user token (one-time, no auth required)
curl -s -X POST http://127.0.0.1:18081/api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"e2e-test"}' | jq .
# → { "ok": true, "user_id": "...", "api_token": "mnemo_..." }

# 2. Export the token
export MNEMO_TEST_USER_TOKEN="mnemo_..."  # from step 1
# export MNEMO_TEST_BASE="http://127.0.0.1:18081"  # optional, this is the default

# 3. Run tests
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
