# mem9 Dashboard Data Contract

Status: draft  
Date: 2026-03-13  
Audience: frontend, backend

## 1. Scope

This document answers three things:

- which existing APIs the dashboard launch uses
- what already works and what still needs backend work
- which JSON contract export and import should share

This aligns with the two-page IA and the current MVP spec. Default deployment assumptions:

- the dashboard lives at `mem9.ai/your-memory`
- browser requests go through a same-origin proxy at `/your-memory/api/...`
- under that default architecture, the dashboard does not require backend CORS

If deployment later changes to direct cross-origin browser calls to `api.mem9.ai`, CORS becomes P0 again.

## 2. Current Backend Reality

| Capability | Current state | Conclusion |
| --- | --- | --- |
| `GET /memories` list and search | Available | Can support list, search, and stats now |
| `GET /memories/{id}` | Available | Can support detail refresh |
| `PUT /memories/{id}` | Available | Can support edit, but frontend should expose it only for `pinned` |
| `DELETE /memories/{id}` | Available | Can support delete |
| `POST /memories` | Available, but async `202` and semantically insight-oriented | Do not use for dashboard manual add |
| `POST /memories/batch` | Handler and service exist, route is not registered | This is the correct path for dashboard manual `pinned` creation |
| `GET /info` | Handler exists, route is not registered | Preferred for Connect; fallback exists if it stays missing |
| `POST /imports` plus task polling | Available | Can support JSON import and progress/status |
| Export endpoint | Missing | Launch should export client-side by paginating current memories |
| `/memories` `updated_from` / `updated_to` | Missing | Time-range filtering cannot ship in real API mode yet |
| `metadata.facet` | No stable contract yet | Needs a documented convention; backend can start with pass-through |
| `/summary` or equivalent aggregation | Missing | Topic strip depends on it; hide that UI when not ready |

## 3. Path and Proxy Rules

### 3.1 Frontend request path

The frontend should always call:

`/your-memory/api/{spaceID}/...`

Use the same relative path in both dev and production. The actual target is:

`https://api.mem9.ai/v1alpha1/mem9s/{spaceID}/...`

### 3.2 Config locations

- Dev proxy: `dashboard/app/vite.config.ts`
- Production rewrite: `dashboard/app/public/_redirects`

## 4. Shared Object Model

### 4.1 Memory

Core fields returned by the service today:

```json
{
  "id": "uuid",
  "content": "string",
  "memory_type": "pinned | insight",
  "source": "string",
  "tags": ["string"],
  "metadata": {},
  "agent_id": "string",
  "session_id": "string",
  "state": "active | paused | archived | deleted",
  "version": 1,
  "updated_by": "string",
  "created_at": "2025-01-01T00:00:00Z",
  "updated_at": "2025-01-01T00:00:00Z",
  "score": 0.85
}
```

Rules:

- the dashboard consumes only `active` records
- `score` appears only in search results
- `metadata.facet` is the reserved category field
- the frontend maps `memory_type` into user-facing copy

### 4.2 User copy mapping

| System value | User copy |
| --- | --- |
| `pinned` | `Saved by you` / `你保存的` |
| `insight` | `Learned from chats` / `对话中学到的` |

`type` answers how a memory was created.  
`facet` answers what a memory is about.

## 5. Page to API Mapping

### 5.1 Connect

Preferred path:

`GET /v1alpha1/mem9s/{spaceID}/info`

Current response shape:

```json
{
  "tenant_id": "uuid",
  "name": "",
  "status": "active",
  "provider": "tidb_zero",
  "memory_count": 42,
  "created_at": "2025-03-01T00:00:00Z"
}
```

If `/info` is still not routed, fall back to:

`GET /v1alpha1/mem9s/{spaceID}/memories?limit=1`

Connect only needs to know whether the space is accessible.

### 5.2 Stats row

Do not use `memory_count` as the page total. It is tenant-level and not guaranteed to mean active-only.

Launch stats should use three list calls:

```text
GET /memories?limit=1
GET /memories?memory_type=pinned&limit=1
GET /memories?memory_type=insight&limit=1
```

Run them in parallel and read `total` from each response.

When the page has a selected time range, all three requests should include the same `updated_from` and `updated_to`.

### 5.3 List, search, and type tabs

Default list:

`GET /memories?limit=50&offset=0`

Type tabs:

```text
GET /memories?memory_type=pinned&limit=50&offset=0
GET /memories?memory_type=insight&limit=50&offset=0
```

Search:

`GET /memories?q={query}&limit=50&offset=0`

Search can be combined with type:

`GET /memories?q={query}&memory_type=pinned&limit=50&offset=0`

With time range, the request shape becomes:

`GET /memories?q={query}&memory_type=pinned&updated_from={iso}&updated_to={iso}&limit=50&offset=0`

Current service behavior to remember:

- when `q` is present, `source` and `session_id` filters are ignored
- the dashboard does not expose those filters anyway, so this does not block launch

### 5.3.1 Reserved facet filter contract

Reserve `facet` in `MemoryListParams` now.

Rules:

- `facet` maps to `metadata.facet`
- mock mode should support `facet` filtering in `listMemories`
- real API mode keeps the topic strip hidden until summary data and list filtering are both ready
- when a facet key has no localized label, the UI renders the raw key instead of inventing a fallback value

### 5.4 Time-range filtering

The page-level time range uses `updated_at`.

Suggested params:

| Param | Meaning |
| --- | --- |
| `updated_from` | start time, ISO 8601 |
| `updated_to` | end time, ISO 8601 |

Rules:

- omitting both params keeps current behavior
- stats, list, and topic summary use the same pair of params
- time range can be combined with `q` and `memory_type`
- page default is `All time`
- the mock contract treats both bounds as inclusive

### 5.4.1 UI-first mock contract

The mock provider should implement time range with the same contract.

Rules:

- the mock provider accepts `updated_from` and `updated_to`
- mock stats, list, and topic summary share the same time params
- `All time` means omitting both params
- filtering always uses `updated_at`
- mock data must span multiple time buckets so `7D`, `30D`, `90D`, and `All time` produce visible differences

### 5.5 Detail, edit, and delete

The detail panel can reuse list item data first. If it needs a fresh version, call:

`GET /memories/{id}`

Edit uses:

`PUT /memories/{id}`

Request body:

```json
{
  "content": "updated text",
  "tags": ["tag-a"],
  "metadata": {
    "facet": "preferences"
  }
}
```

Concurrency control should keep using `If-Match` and `ETag`.

Product rule:

- the backend currently allows updates on any `active` memory
- the dashboard should expose edit only for `pinned`

Delete uses:

`DELETE /memories/{id}`

### 5.6 Manual add memory

The dashboard should not use `POST /memories`. Reasons:

- it returns asynchronously, so the UI does not get an immediate created record
- current service behavior creates `insight`, which breaks the product rule that manual add means `Saved by you`

The required path is:

`POST /memories/batch`

Request body:

```json
{
  "memories": [
    {
      "content": "User prefers dark mode",
      "tags": ["preference"],
      "metadata": {
        "facet": "preferences"
      }
    }
  ]
}
```

Current service logic writes these records as `pinned` and returns full Memory objects synchronously.

If this route is not registered before launch, hide `Add memory`. Do not silently switch to `POST /memories`.

### 5.7 Export JSON

Launch does not need a backend export endpoint. The frontend can export by paginating all current `active` memories and generating the file locally.

Recommended flow:

1. Fetch the first page with `limit=200`
2. Increment `offset` until all `total` records are collected
3. Build the export JSON
4. Trigger a browser download

Launch exports only `active` memories, not archived or deleted records.

Page-level time range does not change export scope. Export covers all current `active` memories in the space by default.

### 5.8 Import JSON

Import should reuse the existing async task flow:

`POST /imports`

Form fields:

| Field | Value |
| --- | --- |
| `file` | user-selected JSON file |
| `agent_id` | `dashboard` |
| `file_type` | `memory` |

Create response:

```json
{
  "id": "task-id",
  "status": "pending"
}
```

Poll with:

`GET /imports/{id}`

The import center can also list recent tasks via:

`GET /imports`

### 5.8.1 Import task response contract

Single-task response shape:

```json
{
  "id": "task-id",
  "file": "mem9-export.json",
  "status": "processing",
  "total": 3,
  "done": 1,
  "error": ""
}
```

Task status enum:

| Status | Meaning |
| --- | --- |
| `pending` | accepted, waiting for worker pickup |
| `processing` | worker is running |
| `done` | import finished successfully |
| `failed` | import finished with an error |

Polling rule:

- poll until status becomes `done` or `failed`
- treat `pending` and `processing` as in-progress states
- `total=0` plus `done` means the file was accepted but contained zero importable records

### 5.8.2 Import task list contract

List response shape:

```json
{
  "status": "processing",
  "tasks": [
    {
      "id": "task-id",
      "file": "mem9-export.json",
      "status": "processing",
      "total": 3,
      "done": 1,
      "error": ""
    }
  ]
}
```

List-level status enum:

| Status | Meaning |
| --- | --- |
| `empty` | no tasks yet |
| `processing` | at least one task is still running and none has failed |
| `partial` | at least one task failed |
| `done` | all listed tasks completed successfully |

### 5.8.3 Import file validation rules

- UI accepts JSON files only
- UI applies the same 50 MB limit as the backend before upload
- upload always sends `agent_id=dashboard`
- upload always sends `file_type=memory`
- invalid multipart forms or oversized files fail on request creation
- invalid JSON or invalid memory-file structure should surface as task-level `failed`

### 5.9 Topic Summary (planned)

If the backend adds `/summary`, the dashboard should drive the topic strip with the same time-range params used by the page.

Suggested request:

`GET /summary?updated_from={iso}&updated_to={iso}`

Suggested response:

```json
{
  "counts": {
    "total": 216,
    "pinned": 75,
    "insight": 141
  },
  "facets": [
    {
      "key": "preferences",
      "count": 38,
      "examples": [
        "Prefers short replies",
        "Does not like very spicy food"
      ]
    }
  ]
}
```

Rules:

- `counts` follows the current time range
- `facets` aggregate within the current time range
- `examples` feed hover or expanded topic-strip UI

## 6. Portable JSON Contract

### 6.1 Launch contract

The export file should be both a user backup file and the import input format.

Recommended shape:

```json
{
  "schema_version": "mem9.memory_export.v1",
  "exported_at": "2026-03-13T12:00:00Z",
  "source_space_id": "space-id",
  "agent_id": "dashboard",
  "memories": [
    {
      "content": "User prefers dark mode",
      "source": "openclaw",
      "tags": ["preference"],
      "metadata": {
        "facet": "preferences"
      },
      "memory_type": "pinned",
      "created_at": "2026-03-01T09:00:00Z",
      "updated_at": "2026-03-10T10:00:00Z"
    }
  ]
}
```

### 6.2 Compatibility with current `/imports`

Today the import worker actually reads only:

- top level: `agent_id`, `memories`
- per memory: `content`, `source`, `tags`, `metadata`, `memory_type`

That means:

- `schema_version`, `exported_at`, and `source_space_id` are ignored, but do not break import
- `metadata.facet` can already round-trip because it is part of `metadata`
- `created_at` and `updated_at` are currently ignored, so imported records get import-time timestamps

Conclusion:

- V1 can already support export, import, and migration
- but without backend changes, launch should not market it as full-fidelity restore

### 6.3 User-facing import notice

If backend support for original timestamps is still missing at launch, the UI must say clearly:

- import preserves content, type, tags, and metadata
- category data is preserved through `metadata.facet`
- original created and updated timestamps are not preserved yet

## 7. Backend Work Needed Before Launch

| Priority | Item | Why |
| --- | --- | --- |
| P0 | Register `POST /memories/batch` | Required for manual `pinned` creation |
| P0 | Add `updated_from` / `updated_to` to `/memories` | Required for consistent time-range filtering in list and stats |
| P1 | Register `GET /info` | Cleaner Connect flow, less fallback logic |
| P1 | Preserve `created_at` and `updated_at` on import | Makes export/import close to a real backup |
| P1 | Define `metadata.facet` write contract | Unifies the category field |
| P1 | Add `/summary` or equivalent aggregation | Supports the topic strip |
| P1 | Add `updated_from` / `updated_to` to `/summary` | Keeps topic strip aligned with list and stats |

Under the same-origin proxy architecture, CORS is not a launch blocker.  
If deployment changes to direct cross-origin browser calls, raise CORS back to P0.
