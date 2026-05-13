# Space Chain Web Console Management Plan

## Summary

Add Space Chain management to `mem9-console-server` and `mem9-console-fe` with
`mem9/server` as the single source of truth for chain runtime state.
`mem9-console-server` stores only project/user ownership metadata and one active
management `chain_` key for proxying mem9/server OpenAPI calls. Nodes,
bindings, key status, and runtime chain details are always read from or changed
through mem9/server.

## Key Changes

### mem9/server Contract

- Ensure OpenAPI includes chain management endpoints for create/get/update/delete
  chain, get-by-key import, replace/list nodes, create/list/disable bindings,
  and status.
- Add or keep `GET /v1alpha2/space-chains/by-key`, authorized by
  `X-API-Key: chain_...`, so console can import an existing chain from only its
  key.
- Keep node positions 0-based. Chain nodes include `tenant_id`,
  `external_space_id`, `display_name`, and `position`.
- Chain key bindings are never deleted when disabled. Add a `disabled` field that
  defaults to `0`; when `disabled = 1`, mem9/server must reject that key for
  memory reads, writes, status-authenticated runtime access, and management
  calls. Disabled keys remain visible to console.
- Block disabling the final active `chain_` key so console cannot lose its
  management credential.

### mem9-console-server

- Add a minimal metadata table, not a node source of truth:
  - `space_chains`: local ownership mirror with `chain_id` from mem9/server,
    `project_id`, display `name`, `description`, `created_by_user_id`, one active
    management `chain_api_key`, soft-delete fields, and timestamps.
  - Do not store `space_chain_nodes`; node reads and writes always proxy
    mem9/server.
  - Do not treat local metadata as runtime truth.
- Use project-scoped authorization and record `created_by_user_id` from the Auth0
  user for audit and ownership metadata.
- Add `mem9client` methods for all mem9/server Space Chain OpenAPI calls.
- Add console APIs:
  - `GET /api/space-chains?project_id=...` lists local metadata; live counts may
    be fetched from mem9/server, not persisted.
  - `POST /api/space-chains` creates a chain in mem9/server, then stores the
    returned chain id and first `chain_` key locally.
  - `POST /api/space-chains/import` validates/imports an existing `chain_` key
    via the mem9/server by-key endpoint and stores local metadata.
  - `GET/PATCH/DELETE /api/space-chains/{id}` proxies canonical chain data from
    mem9/server while preserving local project/user metadata.
  - `GET/PUT /api/space-chains/{id}/nodes` proxies mem9/server list/replace
    nodes.
  - `GET/POST /api/space-chains/{id}/bindings`,
    `POST /api/space-chains/{id}/bind`, and
    `PATCH /api/space-chains/{id}/bindings/{bindingID}` proxy mem9/server key
    management. Disabling a binding sets `disabled = 1`; it does not delete or
    hide the key. The local management key is updated when needed.
  - `GET /api/spaces/{id}/delete-impact` checks local chains in the project, then
    queries mem9/server nodes for each chain and matches by
    `external_space_id == space.id` or by `tenant_id` in the Space's active keys.
- Temporary node tenant selection: when adding a Space node, choose the oldest
  active Space binding ordered by `created_at ASC, id ASC`; add a TODO noting
  this is a compatibility bridge until Space:key becomes 1:1.
- Space deletion: preview impacted chains; confirmed delete first calls
  mem9/server to remove matching nodes from each impacted chain, aborts if any
  proxy call fails, then soft-deletes Space locally.

### mem9-console-fe

- Add `/console/space-chains` list page and
  `/console/space-chains/$chainId` detail editor.
- Sidebar ACTIVITY adds `Space Chain` as a separate item under `Space`.
- List page supports create empty chain, import existing `chain_` key, edit
  metadata, open detail, and soft-delete.
- Detail editor reads nodes and bindings through the console-server proxy on
  page load/refetch.
- Node editor:
  - add only active Spaces that have at least one active key.
  - prevent duplicate Spaces client-side and rely on backend validation.
  - reorder with up/down icon buttons.
  - save nodes with one ordered replace request.
- Key manager:
  - list masked `chain_` keys, copy, create new key, bind existing key, and
    disable key.
  - show disabled keys with a disabled/inactive state instead of removing them.
  - prevent disabling the last active key in UI; backend enforces this too.
- API Keys page shows both Space keys and Space Chain keys with a resource
  type/owner column.
- Space delete modal calls delete-impact preview and shows impacted chain names
  and node positions before final confirmation.

## Test Plan

- mem9-console-server:
  - repository tests for local metadata CRUD and project/user authorization.
  - service tests for create/import sync, live node proxying, oldest active Space
    key selection, duplicate node validation, delete-impact matching,
    abort-on-node-removal-failure, disabled-key visibility, disabled-key runtime
    rejection, and last-key disable protection.
  - handler tests for all new routes and error mappings.
  - run `make test`.
- mem9-console-fe:
  - regenerate client with `pnpm api:generate`.
  - tests for route helpers, node filtering/reorder helpers, duplicate
    prevention, combined API key rows, and delete-impact display logic.
  - run `pnpm test`, `pnpm build`, and `pnpm lint`.
- Integration smoke:
  - create chain, import chain, add/reorder nodes, create/bind/disable keys,
    verify disabled keys remain visible but are rejected by mem9/server runtime
    access, reload detail page, delete impacted Space, and verify mem9/server
    nodes changed.

## Assumptions And Defaults

- mem9/server is the single source of truth for nodes, bindings, key status, and
  runtime chain data.
- mem9-console-server stores one usable `chain_` key in plain form as the
  management credential, with logging redaction.
- mem9-console-server metadata is project-scoped and creator-audited, not
  creator-private.
- Imported chains become console-managed; deleting them in console soft-deletes
  them in mem9/server.
- Existing imported chains without `external_space_id` can still be matched to
  Spaces by comparing node `tenant_id` to active Space keys.
