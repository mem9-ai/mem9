# mem9 Dashboard MVP Development Tasks

Status: draft  
Date: 2026-03-13

## 1. Delivery Assumptions

- app shape: React + Vite SPA
- deploy path: `/your-memory`
- route baseline: `/your-memory`, `/your-memory/space`
- API access: always through `/your-memory/api/{spaceID}/...`
- launch must include export and import
- launch does not depend on SSR

This document covers the current delivery work.

### 1.1 Authoritative document order

Use the docs in this order for the current build:

1. `ui-first-mock-plan.md`
2. `data-contract.md`
3. `information-architecture.md`
4. `dashboard-mvp-spec.md`

If two docs disagree, follow this order and patch the lower-priority doc in the same change.

### 1.2 Current repo baseline

- [x] React + Vite SPA scaffold exists
- [x] `/your-memory` and `/your-memory/space` routes exist
- [x] Connect and Your Memory pages exist
- [x] base Add / Edit / Delete dialogs exist
- [x] mock/real mixed client exists in `src/api/client.ts`
- [x] TanStack Query, i18n, and theme wiring exist
- [x] `.env.local.example` exists for local mock work
- [ ] provider split is still pending
- [ ] `src/config/features.ts` is still pending
- [ ] time-range types and router params are still pending
- [ ] import/export types and fixtures are still pending
- [ ] facet/topic fixtures and filter state are still pending

## 2. Current Priority Order

### P0. Prepare the local UI-first baseline

- create `dashboard/app/.env.local` from `.env.local.example`
- keep shared `.env` unchanged
- add `src/config/features.ts` before wiring more gated UI
- add `src/types/time-range.ts` and `src/types/import.ts` before expanding router state and dialogs
- make sure mock data covers time buckets, `metadata.facet`, and import task states

Done means:

- local `pnpm dev` can start in mock mode without touching shared env
- mock mode can validate time range and Space Tools without real API dependency
- real-mode visibility depends on feature flags instead of page-level branching

### P0. Make preview deployment work first

- verify `base`, router basepath, and Netlify rewrites are aligned
- verify both `/your-memory` and `/your-memory/space` open directly in preview
- verify local dev and preview both use the same relative API path
- verify a real space supports Connect, list, search, detail, and delete

Done means:

- preview can open `/your-memory`
- refresh on `/your-memory/space` does not 404
- real API integration works

### P0. Finish the launch core flow

- Connect page is stable
- Your Memory includes stats, time range, search, type tabs, list, and detail
- delete works
- Chinese and English work
- empty, error, and loading states exist
- desktop and mobile both work

### P0. Finish portability

- frontend exports current `active` memories to JSON
- import dialog uploads a JSON file
- import status polls and shows success, processing, and failure
- post-import refresh and user feedback are complete

This is higher priority than more decorative UI polish.

## 3. Frontend Workstreams

### Track A. Deployment path and real API

- verify `base` in `vite.config.ts`
- verify router basepath
- verify `_redirects` for API rewrite and SPA fallback
- verify `API_BASE` stays `/your-memory/api`
- run one full flow with a real space ID

### Track B. Core pages

- Connect: input, validation, error copy, session storage, timeout disconnect
- Your Memory: stats, time range, search, type tabs, list, detail panel
- Detail panel: delete entry, collapsed technical fields, mobile overlay
- i18n: `zh-CN` and `en`
- theme: light, dark, system

### Track C. Export and import

- Export Dialog explains that export covers current `active` memories
- frontend paginates all data and builds the export JSON
- Import Dialog handles file select, upload, and task state
- Import Status shows processing, done, and failed
- if launch still lacks timestamp preservation, the UI says so explicitly

### Track C2. Time range

- add a time-range control with `All time` as default
- launch starts with short presets such as `7D`, `30D`, and `90D`
- stats, list, and topic strip share the same selected time params
- validate the full interaction in mock mode first

### Track D. Manual management actions

- enable `Add memory` only when `/memories/batch` is available
- refresh stats and list immediately after add
- expose `Edit memory` only for `pinned`
- keep delete as a confirmed action

## 4. Backend Workstreams

| Priority | Task | Notes |
| --- | --- | --- |
| P0 | Register `POST /memories/batch` | Required so manual add really creates `pinned` |
| P0 | Add `updated_from` / `updated_to` to `/memories` | Required so time range affects list and stats |
| P1 | Register `GET /info` | Removes Connect fallback logic |
| P1 | Preserve `created_at` and `updated_at` on import | Improves backup and migration fidelity |
| P1 | Define `metadata.facet` | Unifies category data |
| P1 | Add `/summary` or equivalent | Supports the topic strip |
| P1 | Add `updated_from` / `updated_to` to `/summary` | Keeps topic strip aligned with the current time range |

Under same-origin proxy deployment, CORS is not part of the current P0 list.  
If deployment changes to direct cross-origin browser calls, add CORS middleware.

## 5. Feature Cut Line

### Must be done for launch

- Connect
- stats, time range, search, list, detail
- `Edit pinned memory`
- delete
- `Export JSON`
- `Import JSON`
- i18n
- responsive layout

### Include when dependencies are ready

- `Add memory`
- facet labels
- `Browse by topic`

### After launch

- more complete auth and session model
- multi-space switching
- batch actions
- graph view
- external connectors

## 6. Acceptance Checklist

- preview opens `/your-memory`
- real `space ID` reaches `/your-memory/space`
- list, time range, search, and delete work against the real API
- if the real API still lacks `updated_from` / `updated_to`, hide the time-range entry
- exported file can be imported into another space
- imported `memory_type`, tags, and metadata are preserved
- if `metadata.facet` exists, labels render correctly
- language switching does not break current page state
- refresh behavior matches the intended session rules
