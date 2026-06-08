# mem9 AppID Isolation Plan

## Goal

Add an optional `appId` isolation dimension under the same mem9 API key. `appId` does not change authentication, quota, tenant ownership, or metering. It only scopes memory/session writes and optional query filters.

## Semantics

- External API field: `appId`.
- Internal database column: `app_id`.
- Default/global appId is stored as `""`, not SQL `NULL`.
- Write normalization:
  - omitted, `null`, empty string, or whitespace-only `appId` writes `app_id = ""`;
  - non-empty values are trimmed and limited to 100 characters.
- Query semantics:
  - omitted `appId`: search across all appIds;
  - `appId=<value>`: exact appId search;
  - `appId=null` or `appId=`: search only default/global (`app_id = ""`).
- `app_id` is accepted as an input alias where compatibility is useful, but public docs use `appId`.

## Server Changes

- Add `AppID` to `domain.Memory`, `domain.Session`, create-memory request, ingest request, session-message response, and import JSON file structs.
- Add `MemoryFilter.AppID *string`:
  - `nil` means no appId filter;
  - `ptr("")` means default/global only;
  - `ptr("value")` means exact appId only.
- Add `app_id VARCHAR(100) NOT NULL DEFAULT ''` to tenant `memories` and `sessions`.
- Add app indexes on `memories.app_id` and `sessions.app_id`.
- Change session dedup from `(session_id, content_hash)` to `(app_id, session_id, content_hash)`.
- Ensure existing tenant schemas idempotently receive the new columns and indexes.
- On first service resolution for an existing tenant, synchronously ensure the memory/session appId schema before repositories run queries or writes.
- Scope reconciliation, near-duplicate search, existing-memory gathering, update/archive decisions, raw session saves, and session tag patching by appId.
- Support appId in:
  - `POST /memories` direct create;
  - `POST /memories` smart/raw ingest;
  - raw session persistence;
  - JSON import files;
  - `GET /memories`;
  - `GET /session-messages`;
  - both `v1alpha1` tenant routes and `v1alpha2` API-key routes.
- Update `docs/api/openapi.json` and `site/src/content/site.ts`.

## Import Format

Multipart import task creation keeps the existing form fields. JSON file contents can carry appId:

```json
{
  "appId": "docs",
  "memories": [
    { "content": "Project uses PostgreSQL 15" },
    { "content": "CLI uses Go", "appId": "cli" }
  ]
}
```

```json
{
  "appId": "docs",
  "session_id": "ses-001",
  "messages": [
    { "role": "user", "content": "We use PostgreSQL 15" }
  ]
}
```

## Validation

- `go test ./internal/handler ./internal/service`
- `go test ./internal/repository/tidb`
- `cd site && npm run build`
- Manual API checks:
  - create memory with omitted/null/empty/specific appId;
  - list memories with omitted, `appId=value`, `appId=null`, and `appId=`;
  - ingest the same `session_id` under two appIds and verify session-message filtering does not mix rows;
  - reconcile similar facts under different appIds and verify update/archive decisions do not cross app boundaries.

## Out Of Scope

- appId-based permissioning or quota.
- appId editing after memory creation.
- Persisted default appId preferences in clients.
- Form-level appId for multipart import task metadata; JSON import payloads carry appId for this version.
