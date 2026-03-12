# mem9 Dashboard Data Contract

Status: draft  
Date: 2026-03-12  
Audience: frontend, backend

## 1. Document Purpose

Map the 2 pages + 2 interaction layers defined in [information-architecture.md](./information-architecture.md) to mem9’s existing APIs and required backend changes.

Answer 3 questions:

- Which APIs each page calls, what parameters it passes, and what it receives
- What backend changes are needed to support the dashboard MVP
- Which data requires frontend aggregation or fallback handling

On IA version: This document aligns with the v2 two-page design (Connect + Your Memory) and no longer corresponds to the v1 four-page structure.

## 2. Backend Changes Overview

### 2.1 Current State

The following code is implemented but not yet registered as routes:

| Handler | File | Status |
|---------|------|------|
| `bulkCreateMemories` | `handler/memory.go` | Implemented, synchronous response, creates `pinned` type |
| `getTenantInfo` | `handler/tenant.go` | Implemented, returns `TenantInfo` (including `memory_count`) |

The following capabilities are missing:

| Capability | Status |
|------|------|
| CORS support | None |
| Statistics by type | No dedicated endpoint (can work around with existing list endpoint) |

### 2.2 Change List

#### P0 — Dashboard unusable without these

**1. Add CORS middleware**

The server currently has no CORS configuration. If the dashboard is deployed with the browser calling `api.mem9.ai` or another separate API domain, requests will be blocked by the browser.

If the final deployment uses the same origin or reverse proxy to the same origin, this can be de-prioritized.

Location: `handler/handler.go` Router method

Required configuration:

- Allowed Origins: dashboard deployment domain(s)
- Allowed Methods: GET, POST, PUT, DELETE, OPTIONS
- Allowed Headers: Content-Type, X-Mnemo-Agent-Id, If-Match
- Exposed Headers: ETag

Dependency: Add `github.com/go-chi/cors` (chi’s official CORS package).

**2. Register `bulkCreateMemories` route**

Synchronous path for the dashboard to create pinned memories. Code exists; only route registration is needed.

Location: `handler/handler.go` Router method, within tenant-scoped routes

```go
r.Post("/memories/batch", s.bulkCreateMemories)
```

Behavior:
- Returns creation result synchronously (including full Memory object)
- Created `memory_type` is always `pinned`
- Supports tags, metadata
- Supports single item (one element in the array)

#### P1 — Not blocking launch but strongly recommended

**3. Register `getTenantInfo` route**

Connect page validates space ID and fetches basic space info. Code exists; only route registration is needed.

Location: `handler/handler.go` Router method, within tenant-scoped routes

```go
r.Get("/info", s.getTenantInfo)
```

Response:

```json
{
  "tenant_id": "uuid",
  "name": "",
  "status": "active",
  "provider": "tidb_zero",
  "memory_count": 42,
  "created_at": "2025-..."
}
```

**4. Memory statistics aggregation**

The stats bar needs counts for pinned and insight separately. There is no dedicated endpoint today.

MVP fallback: Frontend issues two list requests to obtain each `total` (see Section 6.2.1).

A dedicated stats endpoint from the backend would be preferable but does not block launch.

## 3. API Default Behavior Reference

Below are the API defaults relevant for dashboard development:

| Behavior | Description |
|------|------|
| state default filtering | When `state` is omitted, API filters to `active`. Pass `state=all` to see all states |
| Sorting | list defaults to `updated_at DESC` |
| Pagination | `limit` default 50, max 200; `offset` default 0 |
| Search | `q` parameter triggers hybrid search (vector + keyword + RRF); omit `q` for plain list |
| Search filter limits | With `q`, `source` and `session_id` filters do not apply in current implementation |
| Single-item read limit | `GET /memories/{id}` currently returns only `active` memories |
| Single-item write limit | `PUT /memories/{id}` and `DELETE /memories/{id}` currently apply only to `active` memories |
| Agent identification | `X-Mnemo-Agent-Id` header; dashboard can set to `"dashboard"` |

## 4. API Base

Backend API base URLs:

- Production: `https://api.mem9.ai`
- Local: `http://localhost:{port}`
- Path prefix: `/v1alpha1/mem9s/{spaceID}`

All tenant-scoped requests include `spaceID` (i.e., `tenantID`) in the path.

### 4.1 Frontend API Proxy

The dashboard does not call the backend directly across origins. All API calls go through a same-origin proxy to avoid CORS:

| Environment | Proxy mechanism | Frontend request path | Actual target |
|------|---------|-------------|-------------|
| Development | Vite dev server proxy | `/your-memory/api/{spaceID}/...` | `https://api.mem9.ai/v1alpha1/mem9s/{spaceID}/...` |
| Production | Netlify rewrite (status 200) | `/your-memory/api/{spaceID}/...` | `https://api.mem9.ai/v1alpha1/mem9s/{spaceID}/...` |

Frontend `API_BASE` is fixed at `/your-memory/api` (relative path), same for dev and production.

Configuration files:

- Vite proxy: `dashboard/app/vite.config.ts` → `server.proxy`
- Netlify rewrite: `dashboard/app/public/_redirects`

## 5. Shared Conventions

### 5.1 Authentication

The dashboard uses Space ID as the sole credential. Usage:

- Space ID in URL path: `/v1alpha1/mem9s/{spaceID}/...`
- Agent identity via `X-Mnemo-Agent-Id: dashboard` header

### 5.2 Error Format

```json
{ "error": "error message" }
```

| HTTP Status | Meaning |
|-------------|------|
| 400 | Request validation failure |
| 404 | Resource not found (or invalid space ID) |
| 409 | Version conflict |
| 503 | Write conflict or database unavailable |

### 5.3 Generic Memory Object

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

`score` is returned only for search results. `metadata` may be `null` or arbitrary JSON.

### 5.4 Internationalization Conventions

The dashboard initially supports `zh-CN` and `en`.

Conventions:

- No locale parameter in APIs
- Routes are not split by language
- Backend continues to return raw enum values such as `pinned`, `insight`, `active`
- Frontend maps raw enums to localized copy
- Language preference persisted separately; `localStorage` is recommended

Content the frontend must localize:

- memory type
- state
- Empty states, error states, toasts, dialogs
- All button and description copy on Connect and Your Memory

Content that is not auto-translated:

- `content`
- `tags`
- `metadata`
- Other user-written data

## 6. Page → API Mapping

v2 has two pages: Connect and Your Memory. The following maps APIs by page and functional area.

### 6.1 Connect

**Validate Space ID**

Option A (when `getTenantInfo` route exists):

```
GET /v1alpha1/mem9s/{spaceID}/info
```

- Success (200) → Space valid, navigate to Your Memory
- Failure (404) → Space not found, show error
- Failure (403) → Space inactive, show error

Option B (fallback when `getTenantInfo` route is missing):

```
GET /v1alpha1/mem9s/{spaceID}/memories?limit=1
```

- Success (200) → Space valid
- Failure (404) → Space not found

Option A is preferable: fetches basic Space info in one call and avoids extra requests.

### 6.2 Your Memory Home

This is the only functional page in the dashboard, with stats bar, list, search, and detail panel. The following describes API usage by area.

#### 6.2.1 Stats Bar

The three numbers at the top: total, 🔖 Saved by you count, ✨ Learned from chats count.

```
GET /memories?limit=1                        → total (active total)
GET /memories?memory_type=pinned&limit=1     → total (pinned count)
GET /memories?memory_type=insight&limit=1    → total (insight count)
```

Three requests, can be run in parallel. Each uses the list endpoint’s `total` field, all scoped to `active`.

Notes:

- Do not use `getTenantInfo.memory_count` for the total; it counts all records (including non-active)
- Do not infer total as pinned + insight; if more memory types are added later, the metric will be wrong

#### 6.2.2 Memory List

**Default list**

```
GET /memories?limit=50&offset=0
```

Defaults: `updated_at DESC`, `state=active`; no extra parameters required.

**Type tab filter**

The dashboard exposes a single filter dimension: memory type.

```
All:                  GET /memories?limit=50&offset=0
🔖 Saved by you:      GET /memories?memory_type=pinned&limit=50&offset=0
✨ Learned from chats: GET /memories?memory_type=insight&limit=50&offset=0
```

No state / source / agent filters. Rationale:

- Dashboard shows only active memories; state filter is unnecessary
- source / agent are less important for typical users, and source does not apply in search mode
- Reduces cognitive load; MVP keeps only the most impactful dimension

**Search**

```
GET /memories?q={user input}&limit=50&offset=0
```

`q` triggers hybrid search (vector + keyword + RRF fusion). Users can enter natural language.

Search can be combined with type tabs:

```
GET /memories?q={user input}&memory_type=pinned&limit=50&offset=0
```

Note: When `q` is present, the current implementation ignores `source` and `session_id`. Because the dashboard does not expose these filters, UX is unaffected.

**Pagination**

```
GET /memories?limit=50&offset=50
```

Response format:

```json
{
  "memories": [Memory, ...],
  "total": 142,
  "limit": 50,
  "offset": 0
}
```

`total` is used to determine if more results exist. The dashboard uses a "Load more" pattern.

#### 6.2.3 Detail Panel

When the user clicks a memory in the list, a side panel shows full details.

```
GET /memories/{id}
```

Currently only guarantees return of `active` memories. Non-active memories may return 404. Because the list only shows active memories, this should not occur in normal use.

#### 6.2.4 Delete

Delete action inside the detail panel.

```
DELETE /memories/{id}
```

Returns 204 No Content. Soft delete; memory is marked as `deleted`.

#### 6.2.5 Edit

Only for 🔖 Saved by you memories. Included in MVP.

```
PUT /memories/{id}
Content-Type: application/json

{
  "content": "updated content",
  "tags": ["new-tag"]
}
```

Returns the updated Memory object. Optimistic locking supported via `If-Match: {version}` header; conflicts return 409.

### 6.3 Add Memory

Modal interaction, not a separate page.

**Synchronous create (requires batch route)**

```
POST /memories/batch
Content-Type: application/json
X-Mnemo-Agent-Id: dashboard

{
  "memories": [
    {
      "content": "User-entered content",
      "tags": ["user-created"]
    }
  ]
}
```

Response:

```json
{
  "ok": true,
  "memories": [Memory]
}
```

Created memories are always `pinned` (🔖 Saved by you) and `active`. Single-element array supported.

**Fallback (when batch route is not available)**

```
POST /memories
Content-Type: application/json
X-Mnemo-Agent-Id: dashboard

{
  "content": "User-entered content"
}
```

Response: `{"status": "accepted"}`. Asynchronous creation, type is `insight`.

Fallback cost:
- Creation result is not visible immediately
- Created type is `insight` instead of `pinned`

If the batch route is unavailable, remove the "Add memory" feature from MVP instead of using the fallback. Reason: the user expects a saved memory (🔖) but would actually get an `insight` (✨), violating the Trust Layer principle.

### 6.4 Disconnect

Client-only: clear Space ID from `sessionStorage` and navigate back to Connect. No API call.

## 7. Async Visibility Handling

| Operation | Sync/Async | Dashboard handling |
|------|-----------|----------------|
| Search / list | Sync | Normal display |
| Fetch single | Sync | Normal display |
| Create (batch) | Sync | Refresh list after success |
| Delete | Sync | Remove from list after success |
| Update | Sync | Refresh current memory after success |

If the batch route is available, all dashboard operations in MVP are synchronous; there is no async visibility concern.

## 8. Frontend Technical Decisions Reference

The following decisions are confirmed:

| Decision | Choice |
|--------|------|
| Framework | Vite + React 19 + TypeScript (SPA only, no SSR) |
| Deployment | `mem9.ai/your-memory`, co-deployed with Astro main site on Netlify |
| CSS | Tailwind CSS 4 + shadcn/ui |
| Relation to site | Same repo, separate build, build output merged for deployment |
| i18n | i18next + react-i18next, JSON dictionaries, browser language detection, localStorage persistence |
| API proxy | Vite proxy for dev / Netlify rewrite for prod; frontend always uses relative paths |
| Mock mode | `VITE_USE_MOCK` env; default mock in dev, real API in prod |
