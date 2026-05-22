---
title: "Space Chain PRD"
status: draft
created: 2026-05-13
---

# Space Chain PRD

## 1. Summary

Space Chain is a first-class open-source mem9/server capability for sharing
memory through an ordered chain of Spaces. A Space Chain has its own API keys
with the `chain_` prefix. When a client uses a `chain_` key, mem9/server resolves
the chain, reads its nodes in order, and searches each underlying Space until a
high-quality recall result is found. The behavior is intentionally similar to
JavaScript prototype-chain lookup: search starts at the first node and proceeds
up the chain only when the earlier nodes do not satisfy the query.

The runtime source of truth lives in mem9/server. mem9-console-server keeps a
lightweight mirror only for project ownership, UI listing, permission checks,
and delete-impact confirmation. mem9-console-fe talks only to
mem9-console-server through the generated console API client.

## 2. Goals

- Let users compose multiple existing Spaces into one ordered recall chain.
- Let agents use one `chain_` key instead of choosing a single Space key.
- Preserve predictable chain semantics: earlier Spaces get the first chance to
  answer.
- Still allow cross-Space recall when earlier nodes are weak or empty.
- Keep Space Chain available to open-source mem9/server users without requiring
  the closed-source console stack.
- Give console users safe management flows, including duplicate-node prevention
  and warnings when deleting a Space affects existing chains.

## 3. Non-goals

- Do not solve the existing console issue where one Space can currently have
  multiple mem9 API keys. This PRD assumes the intended model is effectively
  Space:API key = 1:1. In V1, node editing may pick one active key.
- Do not implement arbitrary graph traversal. V1 supports only an ordered linear
  chain of Spaces.
- Do not allow Space Chain nodes to point to other Space Chains. Nodes are
  Spaces only.
- Do not make mem9-console-server part of the runtime query path.

## 4. Data Model

### 4.1 mem9/server source of truth

mem9/server adds three control-plane tables.

`space_chains`:

| Column | Notes |
|---|---|
| `id` | Primary key. |
| `project_id` | Opaque external project id. mem9/server stores but does not authorize against it. |
| `name` | Human-readable chain name. |
| `description` | Optional description. |
| `created_by_user_id` | Opaque external user id. |
| `deleted_at` | Soft-delete timestamp. |
| `deleted_by_user_id` | Opaque external user id for deletion. |
| `created_at`, `updated_at` | Timestamps. |

`space_chain_bindings`:

| Column | Notes |
|---|---|
| `id` | Primary key. |
| `chain_id` | References `space_chains.id`. |
| `chain_api_key` | Unique active API key with `chain_` prefix. |
| `created_by_user_id` | Opaque external user id. |
| `disabled` | Boolean flag. Defaults to `0`; disabled keys remain visible but cannot be used. |
| `disabled_at`, `disabled_by_user_id` | Disable metadata. |
| `created_at` | Timestamp. |

`space_chain_nodes`:

| Column | Notes |
|---|---|
| `id` | Primary key. |
| `chain_id` | References `space_chains.id`. |
| `tenant_id` | Existing mem9 tenant/API key that identifies the underlying Space at runtime. |
| `external_space_id` | Opaque console Space id for duplicate prevention and delete-impact lookup. |
| `display_name` | Optional snapshot for management UI and logs. |
| `position` | 0-based ordered position. |
| `created_at`, `updated_at` | Timestamps. |

Required constraints:

- Active `chain_api_key` values are globally unique and always begin with
  `chain_`.
- A chain cannot contain duplicate `tenant_id`.
- A chain cannot contain duplicate `external_space_id` when it is present.
- A chain node cannot point to another `chain_` key.
- Chain deletion is soft delete.
- Key disable is soft disable: disabled bindings stay visible and are rejected by mem9/server.

### 4.2 mem9-console-server mirror

mem9-console-server keeps a lightweight mirror for project-level UX and
permission checks:

- Mirror `space_chains` linked to console `project_id`.
- Mirror chain bindings storing `chain_` keys returned by mem9/server.
- Optional cached node metadata for fast list views and delete-impact previews.

The mirror is not runtime truth. mem9/server remains the source for chain
resolution, node order, key validity, and chain recall behavior.

## 5. API Requirements

### 5.1 mem9/server management API

mem9/server exposes OpenAPI-documented management endpoints for:

- Create Space Chain and return the first `chain_` key.
- Get/update/soft-delete a Space Chain.
- Replace or reorder chain nodes.
- Create/list/disable chain key bindings.
- Validate `chain_` key status through the existing status shape.

Creation follows existing provision semantics: the create endpoint can bootstrap
a new chain and return the initial `chain_` key. Subsequent management calls for
that chain are authorized by the chain API key itself.

`GET /v1alpha2/status` must accept both normal mem9 keys and `chain_` keys and
return the existing active/inactive response shape. It should not require clients
to call a separate status endpoint only for chains.

### 5.2 mem9-console-server API

mem9-console-server exposes project-scoped APIs for:

- List, create, get, update, and soft-delete Space Chains in a project.
- Create/list/disable chain keys.
- Read and replace ordered chain nodes.
- Preview Space deletion impact, including impacted Space Chains and node
  positions.
- Confirm Space deletion and propagate node removal to mem9/server.

mem9-console-server owns user, org, and project authorization. It then calls
mem9/server Space Chain management APIs using the relevant `chain_` key and
updates its local mirror.

### 5.3 mem9-console-fe API usage

mem9-console-fe must not call mem9/server Space Chain management endpoints
directly. It should use generated console API client methods after
mem9-console-server OpenAPI is updated.

## 6. Runtime Behavior

### 6.1 Key resolution

When `X-API-Key` starts with `chain_`, mem9/server resolves it as a Space Chain
binding instead of a single tenant key.

Resolution failures:

- Unknown or disabled `chain_` key: invalid API key.
- Deleted chain: invalid API key.
- Active chain with no active nodes: explicit empty-chain error.
- Deleted or inactive node tenant: skip only when the node was removed as part
  of an expected Space deletion; otherwise surface an operational error with
  enough logging to diagnose stale chain configuration.

### 6.2 Recall order and short-circuiting

For query-based recall:

1. Load active nodes ordered by `position`.
2. Search node 1 using the existing memory/session recall path.
3. Add node 1 candidates to the visited candidate set.
4. If the query is stop-eligible and node 1's top normalized confidence is
   greater than or equal to `MNEMO_CHAIN_RECALL_STOP_SCORE`, stop.
5. Otherwise continue to node 2, and repeat.
6. If no node reaches the threshold, all nodes are visited.
7. Return a final reranked result set built from all visited nodes.

Configuration:

- `MNEMO_CHAIN_RECALL_STOP_SCORE`
- Default: `0.8`

Raw search `score` values are not used for stopping because FTS scores are not
normalized and may exceed 1.0. Single-token keyword queries and enumeration
queries are not stop-eligible, so they visit all chain nodes and rerank the
aggregate candidate set.

The final result set must merge facts and raw session results across visited
nodes. Existing per-node recall behavior, type weighting, session recall, and
fallback search behavior should be reused rather than reimplemented.

### 6.3 Non-query list behavior

For list operations without a query, a `chain_` key aggregates active nodes in
chain order. Results should preserve the existing list response shape while
including chain provenance metadata. Pagination should be deterministic and
documented by implementation; V1 may use merged timestamp ordering after
fetching from each node.

### 6.4 Writes through chain keys

Space Chain keys support write behavior so agents can operate with a single key:

- Create memory: write to the first active node.
- Import/session ingest: write to the first active node.
- Get/update/delete memory by id: locate the memory by checking nodes in chain
  order, then operate on the node where the memory exists.
- Batch delete: apply by locating each id across nodes.

If the chain has no active nodes, all write operations fail with the empty-chain
error.

### 6.5 Provenance

Results returned through a `chain_` key include provenance metadata per item.
The field name should be `chain_source` unless implementation discovers a
stronger local naming convention.

Suggested shape:

```json
{
  "chain_source": {
    "chain_id": "chain-id",
    "node_position": 1,
    "tenant_id": "tenant-id",
    "external_space_id": "console-space-id"
  }
}
```

Provenance appears only for chain responses. Normal single-Space key responses
must remain unchanged.

## 7. Console UX

### 7.1 Navigation

mem9-console-fe adds a `Space Chain` item under the main Space area. The page is
project-scoped, matching the existing project Space page.

### 7.2 List and detail page

The Space Chain page supports:

- List chains in the active project.
- Create chain with name and optional description.
- Show chain key count and node count.
- Open a chain detail/editor view.
- Soft-delete a chain.

### 7.3 Chain editor

The editor supports:

- Add Space nodes from active Spaces in the project.
- Reorder nodes.
- Remove nodes.
- Prevent duplicate Space nodes.
- Show each node's display name and key status.
- Save changes as one ordered node replacement.

Current V1 assumption: console Space and mem9 API key are intended to be 1:1.
If multiple active keys exist for a Space during the transition period, the UI
may pick one active key explicitly.

### 7.4 Chain key management

The editor supports minimal multi-key management:

- List active chain keys.
- Create a new chain key.
- Disable an active chain key without removing it from the visible key list.
- Mask key values by default, following existing Space key UX.

### 7.5 Space deletion impact

When a user deletes a Space, console must check whether the Space is used in any
Space Chain.

If no chains are affected, deletion follows the existing Space delete flow.

If chains are affected:

- Show a second confirmation prompt.
- Include impacted chain names and node positions.
- Explain that deleting the Space will remove that node from each impacted
  chain.
- On confirmation, soft-delete the Space in console, update console mirrors, and
  call mem9/server to remove the corresponding nodes.

Example copy:

> This Space is used by 2 Space Chains. Deleting it will remove the Space from
> those chains. Chain recall will skip this Space and continue to the next node.

## 8. Error Handling

Required user-facing errors:

- Empty chain: "Space Chain has no nodes."
- Duplicate node: "This Space is already in the chain."
- Disabled chain key: existing invalid key error behavior.
- Deleted chain: existing invalid key error behavior.
- Node tenant unavailable: service unavailable with server logs identifying
  chain id, node position, tenant id, and underlying connection error.

Required logging:

- chain id
- chain key fingerprint or redacted key marker, never raw key
- visited node count
- stop reason: threshold hit, exhausted chain, or error
- stop score when threshold hit
- per-node tenant id and position

## 9. Acceptance Criteria

### mem9/server

- Can create a Space Chain and receive a `chain_` key.
- `chain_` key status returns active/inactive through existing status response.
- Duplicate nodes are rejected.
- Empty chain reads and writes return a clear error.
- Recall visits nodes in order and stops when top normalized confidence is at least
  `MNEMO_CHAIN_RECALL_STOP_SCORE`.
- If no node reaches the threshold, recall searches all nodes and reranks the
  aggregate candidate set.
- Returned chain results include `chain_source`.
- Normal key responses are unchanged.
- Create/import/session ingest with a `chain_` key writes to the first active
  node.
- Get/update/delete by id locates the target node in chain order.

### mem9-console-server

- Users can list only chains mirrored in projects they can access.
- Chain creation calls mem9/server, persists the mirror, and stores the returned
  `chain_` key.
- Node edits reject duplicate Spaces before calling mem9/server.
- Key create/list/disable flows stay in sync with mem9/server.
- Space deletion preview returns impacted chains and positions.
- Confirmed Space deletion removes affected nodes from mem9/server and mirror
  state.

### mem9-console-fe

- Sidebar includes Space Chain under Space activity.
- Project Space Chain page lists chains and supports create/delete.
- Chain editor can add, remove, and reorder unique Space nodes.
- Chain key UI supports create/list/disable with masked key display and keeps disabled keys visible.
- Space delete modal shows second confirmation when chains are affected.

## 10. Test Plan

### mem9/server tests

- Unit tests for chain key parsing and binding resolution.
- Repository tests for `space_chains`, `space_chain_bindings`, and
  `space_chain_nodes` constraints.
- Handler tests for chain create/status/node/key management.
- Recall tests:
  - first node hits threshold and later nodes are not queried;
  - first node misses and second node hits;
  - all nodes miss threshold and all visited candidates rerank together;
  - facts and sessions can both appear in the final result set;
  - provenance appears only for chain responses.
- Write tests:
  - create writes to first node;
  - update/delete locates target memory by id;
  - empty chain write fails.

### mem9-console-server tests

- Service tests for project-scoped chain list authorization.
- Service tests for create-chain sync and mirror persistence.
- Duplicate node validation tests.
- Key create/disable sync tests.
- Delete-impact preview and confirmed cleanup tests.

### mem9-console-fe tests

- Route/path tests for Space Chain navigation.
- Pure helper tests for node ordering and duplicate prevention.
- Component-level smoke coverage for chain editor states where practical.

## 11. Rollout Notes

- Ship mem9/server schema and OpenAPI first.
- Add console-server mirror and sync APIs after mem9/server management APIs are
  available.
- Regenerate mem9-console-fe API client from console-server OpenAPI.
- Gate console UI with backend capability checks if deployment order can vary.
- Monitor chain recall latency, visited node count, threshold stop rate, and
  empty-chain errors.

## 12. Open Questions

- Exact `chain_source` placement: top-level field on each memory/session result
  or nested under metadata. Default recommendation is a top-level field to avoid
  mutating user metadata.
- Exact pagination semantics for non-query chain list. Default recommendation
  is merged timestamp ordering after per-node fetch.
- Whether V1 should expose chain-specific metrics in Prometheus or only logs.
