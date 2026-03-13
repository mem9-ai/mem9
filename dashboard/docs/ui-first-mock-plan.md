# mem9 Dashboard UI-First Mock Plan

Status: draft  
Date: 2026-03-13  
Audience: frontend, AI agents, product

## 1. Purpose

The current goal is to make the dashboard core UI testable, demoable, and ready for iteration.

- Use mock data first and get the full UI flow working
- Write real API glue when useful, but keep unfinished capabilities disabled by default
- Keep page components unaware of whether the data source is mock or real
- Prioritize UI validation before backend completion

AI agents should use this structure when reshaping the app.  
The target is to keep the current pages, make mock mode fully usable, make real mode connectable, and hide unfinished capabilities cleanly.

### 1.1 Source-of-truth order for implementation

Use the docs in this order during the current sprint:

1. `ui-first-mock-plan.md` for implementation shape, feature gating, and local workflow
2. `data-contract.md` for request, response, and portable JSON contracts
3. `information-architecture.md` for page structure, interaction rules, and cut line
4. `dashboard-mvp-spec.md` for product scope and launch framing

If two docs disagree, follow this order and patch the lower-priority doc in the same change.

## 2. Current Baseline

Already present in the codebase:

- [x] React SPA scaffold
- [x] `Connect` page
- [x] `Your Memory` page
- [x] base UI for `stats / list / detail / add / edit / delete`
- [x] mixed mock/real client in `src/api/client.ts`
- [x] TanStack Query hooks
- [x] i18n
- [x] theme support

Still missing, or not a good place to keep extending:

- [ ] `Space Tools` menu
- [ ] `Export Dialog`
- [ ] `Import Dialog / Import Status`
- [ ] time-range control
- [ ] topic strip / facet labels
- [ ] clear feature gating for unfinished APIs
- [ ] cleaner data-provider separation

Notes:

- `dashboard/app/.env` currently sets `VITE_USE_MOCK=false`
- For UI-first local work, switch back to mock mode through `.env.local` or a command-line override instead of editing the shared `.env`

## 3. Preconditions

Prepare these inputs before expanding the UI.

### 3.1 Local environment variables

Use `dashboard/app/.env.local.example` as the single reference for local mock work.

Recommended values:

```env
VITE_USE_MOCK=true
VITE_API_BASE=/your-memory/api
VITE_ENABLE_MANUAL_ADD=true
VITE_ENABLE_TIME_RANGE=true
VITE_ENABLE_FACET=true
VITE_ENABLE_TOPIC_SUMMARY=true
```

Rules:

- do not edit the shared `.env`
- keep local overrides in `.env.local`
- keep `VITE_API_BASE` as the same relative path in both mock and real modes
- preview and production should use deploy-time environment variables, not local files

### 3.2 Add the file skeleton first

Before adding more logic to the current `client.ts`, create these files:

- `src/config/features.ts`
- `src/api/provider.ts`
- `src/api/provider-mock.ts`
- `src/api/provider-http.ts`
- `src/api/contracts.ts`
- `src/api/adapters.ts`
- `src/api/import-export.ts`
- `src/types/import.ts`
- `src/types/time-range.ts`

If time is tighter, the minimum acceptable split is:

- split `src/api/client.ts` into `provider-mock.ts` and `provider-http.ts`
- add `src/config/features.ts`
- add `src/types/import.ts` and `src/types/time-range.ts`

### 3.3 Mock data requirements

The mock layer needs enough shape to validate the launch interactions.

At minimum include:

- both `pinned` and `insight`
- multiple `updated_at` ranges so `7D`, `30D`, `90D`, and `All time` show visible differences
- `metadata.facet` examples for topic chips
- import-task examples for `pending`, `processing`, `done`, and `failed`
- one sample export file that follows `mem9.memory_export.v1`
- empty list, no-result search, and long-content examples
- import failure fixtures for invalid JSON and oversized files

Current `src/api/mock-data.ts` only covers the memory list.  
Facet samples, import-task samples, and export fixtures still need to be added in this UI-first pass.

### 3.4 Current code constraints

- `src/api/client.ts` is only the current entry point; do not keep adding large logic there
- UI components should continue to read data only through query hooks
- router search params should expand only after the time-range types exist
- `src/types/memory.ts` still lacks `updated_from` / `updated_to`, `facet`, import-task, topic-summary, and time-range types
- `MemoryUpdateInput` still lacks `metadata`; add it when facet editing becomes part of the UI model

### 3.5 UI state ownership

Keep one stable state split so agents do not move the same concern across URL state, component state, and query state.

| State | Owner | Notes |
| --- | --- | --- |
| `space ID` | `sessionStorage` | Use `src/lib/session.ts`. Never put it in the URL. |
| `q`, `type`, `range`, `facet` | router search params | `range` and `facet` can land after `src/types/time-range.ts` and the matching feature flags exist. |
| selected `memoryId` | page-local UI state | Keep it out of the URL in MVP. Desktop and mobile share the same selected record model. |
| dialog open state | page-local UI state | `Add`, `Edit`, `Delete`, `Export`, and `Import` stay local. |
| import task polling | TanStack Query | Key by `spaceId` plus `taskId`. Reuse the same hook for dialog and status list. |
| feature availability | `src/config/features.ts` | Components should read derived booleans, not raw env strings. |

### 3.6 Dependency baseline

The current dependency set is enough for the UI-first MVP pass.

- stay on the existing React, TanStack Query, TanStack Router, i18n, Tailwind, and shadcn stack
- use browser APIs for export and import helpers: `Blob`, `URL.createObjectURL`, `FormData`, `File`
- use existing time handling first; add a date helper only if a concrete bug appears
- do not add a new state-management, form, or upload library in the first pass

## 4. Recommended Development Shape

Use three layers during the UI-first phase.

### 4.1 UI layer

Responsibilities:

- pages, components, interactions, and state presentation only
- call query hooks only
- never build API paths directly
- never embed mock logic in components

Code area:

- `src/pages/*`
- `src/components/*`

### 4.2 Query / use-case layer

Responsibilities:

- manage TanStack Query
- expose stable hooks to the UI
- handle cache refresh, mutation, and polling
- use feature flags to decide whether actions are visible or callable

Code area:

- `src/api/queries.ts`
- new `src/config/features.ts`

### 4.3 Data-provider layer

Responsibilities:

- expose one dashboard data interface
- switch between mock and real providers
- adapt paths, request bodies, and response shapes

Code area:

- new `src/api/provider.ts`
- new `src/api/provider-mock.ts`
- new `src/api/provider-http.ts`
- gradually shrink `src/api/client.ts`; do not keep expanding it

## 5. Recommended Provider Interface

Do not let the UI depend on whether a backend route is ready on a given day.  
Define the dashboard-facing provider interface first:

```ts
export interface DashboardProvider {
  verifySpace(spaceId: string): Promise<SpaceInfo>;
  listMemories(spaceId: string, params: MemoryListParams): Promise<MemoryListResponse>;
  getStats(spaceId: string, params?: TimeRangeParams): Promise<MemoryStats>;
  getMemory(spaceId: string, memoryId: string): Promise<Memory>;
  createMemory(spaceId: string, input: MemoryCreateInput): Promise<Memory>;
  updateMemory(spaceId: string, memoryId: string, input: MemoryUpdateInput, version?: number): Promise<Memory>;
  deleteMemory(spaceId: string, memoryId: string): Promise<void>;
  exportMemories(spaceId: string): Promise<MemoryExportFile>;
  importMemories(spaceId: string, file: File): Promise<ImportTask>;
  getImportTask(spaceId: string, taskId: string): Promise<ImportTask>;
  listImportTasks(spaceId: string): Promise<ImportTaskList>;
  getTopicSummary?(spaceId: string, params?: TimeRangeParams): Promise<TopicSummary>;
}
```

`MemoryListParams` should start including `updated_from` and `updated_to` now.  
Reserve `facet` in the same interface now, even if real API mode keeps it disabled at launch.  
Lock the interface shape first, then fill in implementations.

## 6. Feature-Flag Plan

Recommended file:

`src/config/features.ts`

```ts
export const features = {
  useMock: import.meta.env.VITE_USE_MOCK === "true",
  enableManualAdd: import.meta.env.VITE_ENABLE_MANUAL_ADD === "true",
  enableTimeRange: import.meta.env.VITE_ENABLE_TIME_RANGE === "true",
  enableFacet: import.meta.env.VITE_ENABLE_FACET === "true",
  enableTopicSummary: import.meta.env.VITE_ENABLE_TOPIC_SUMMARY === "true",
};
```

Recommended defaults for UI-first local work:

```env
VITE_USE_MOCK=true
VITE_ENABLE_MANUAL_ADD=true
VITE_ENABLE_TIME_RANGE=true
VITE_ENABLE_FACET=true
VITE_ENABLE_TOPIC_SUMMARY=true
```

Recommended defaults for real API integration work:

```env
VITE_USE_MOCK=false
VITE_ENABLE_MANUAL_ADD=false
VITE_ENABLE_TIME_RANGE=false
VITE_ENABLE_FACET=false
VITE_ENABLE_TOPIC_SUMMARY=false
```

Rules:

- with `VITE_USE_MOCK=true`, the UI can show import, export, manual add, time range, and facet flows
- with `VITE_USE_MOCK=false`, only backend-ready capabilities should be enabled
- unfinished capabilities may have real provider code, but their UI entry stays hidden by default
- current code only reads `VITE_USE_MOCK`; the other flags are part of this UI-first refactor and still need implementation
- `useMock` takes precedence over the other flags for local development
- in live API mode, a flag does not force-enable a backend-incomplete feature

## 7. Real API Glue That Can Exist Before Launch

### 7.1 Safe to write now

- `POST /memories/batch`
  - used for `Add memory`
  - the backend route is still not registered
  - write the client path in `provider-http.ts`
  - keep the UI hidden with `enableManualAdd=false`

- `/imports` upload and task polling
  - already available on the backend
  - safe to wire to the real API
  - if time is short, finish the mock import flow first and enable real integration after that

- `/summary` or topic summary
  - the backend path does not exist yet
  - only the provider method and mock data need to exist for now
  - keep it off in real mode

- time range
  - mock provider should support `updated_from` and `updated_to` first
  - mock `getStats`, mock `listMemories`, and mock `getTopicSummary` should use the same time params
  - real mode enables it only after `/memories` supports those params

### 7.2 Do not hard-wire these into visible UI yet

- any route that does not exist and is not guarded by a feature flag
- any fallback that breaks the intended product meaning

Do not connect `Add memory` to `POST /memories`.

Reasons:

- it returns asynchronously
- current service semantics create `insight`
- that breaks the product rule that manual add means `Saved by you` / `pinned`

## 8. Recommended File Split

Suggested structure for AI agents:

| File | Role |
| --- | --- |
| `src/config/features.ts` | UI capability gates |
| `src/api/provider.ts` | provider interface and provider selection |
| `src/api/provider-mock.ts` | mock implementation |
| `src/api/provider-http.ts` | real API implementation |
| `src/api/contracts.ts` | raw backend contract types |
| `src/api/adapters.ts` | mapping raw contract to UI model |
| `src/api/import-export.ts` | export JSON assembly, download, and import parsing helpers |
| `src/types/memory.ts` | memory types used by the UI |
| `src/types/import.ts` | import-task types |
| `src/types/time-range.ts` | time-range presets and query params |

If time is extremely tight, do not force the full split in one go.  
The minimum target is splitting mock and real branches out of `client.ts` so the file stops growing.

## 9. Page Wireframes

## 9.1 Connect

```text
┌─────────────────────────────────────┐
│ [Theme] [中文/EN]                   │
│                                     │
│               mem9                  │
│                                     │
│            Your Memory              │
│      Enter your memory space        │
│                                     │
│  [ Space ID input                ]  │
│           [ Enter space ]           │
│                                     │
│  Space ID is sensitive. Do not      │
│  share it.                          │
│                                     │
│  How mem9 works                     │
│  · agents build long-term memory    │
│  · this page shows stored memory    │
└─────────────────────────────────────┘
```

## 9.2 Your Memory

```text
┌─────────────────────────────────────────────────────────────┐
│ mem9  space:a1b2…    [Space Tools] [Theme] [Lang] [Exit]    │
├─────────────────────────────────────────────────────────────┤
│ [Total] [Saved by you] [Learned from chats]                 │
│ [Topic chips, if enabled]                                   │
│                                                             │
│ [Search....................] [Time range] [Tabs] [Add]      │
├────────────────────────────────┬────────────────────────────┤
│ memory list                    │ detail panel               │
│                                │                            │
│ card                           │ full content               │
│ card                           │ tags                       │
│ card                           │ source / agent / time      │
│                                │ edit / delete              │
└────────────────────────────────┴────────────────────────────┘
```

## 9.3 Space Tools

```text
Space Tools
- Export JSON
- Import JSON
- View import status
```

Do not spread these actions across the header for launch.

## 10. Implementation Order for AI Agents

### Step 1. Split provider logic and add feature flags

Goal:

- keep current UI behavior unchanged
- move mock/real selection out of one large client file

Done means:

- the app still runs
- `queries.ts` no longer depends directly on an oversized `client.ts`

### Step 2. Add product types

Add or complete:

- `MemoryFacet`
- `MemoryExportFile`
- `ImportTask`
- `ImportTaskStatus`
- `ImportTaskList`
- `ImportTaskListStatus`
- `TopicSummary`
- `TimeRangePreset`
- `TimeRangeParams`

Done means:

- import/export and topic strip stop relying on temporary object shapes
- time-range params and preset types are fixed

### Step 3. Build Space Tools in mock mode first

Goal:

- complete the full UI flow for `Export JSON`
- complete the full UI flow for `Import JSON`
- complete `Import Status`
- complete time range
- complete topic strip

Done means:

- the flow does not depend on the real API
- users can complete the full demo path in mock mode
- time range drives mock `getStats`, mock `listMemories`, and mock `getTopicSummary` together
- mock data clearly separates `7D`, `30D`, `90D`, and `All time`
- mock import covers `pending`, `processing`, `done`, `failed`, invalid JSON, and oversized file states

### Step 4. Add real provider glue and enable only ready capabilities

Suggested order:

1. `verifySpace`
2. `listMemories`
3. `getStats`
4. `getMemory`
5. `updateMemory`
6. `deleteMemory`
7. `importMemories`
8. `getImportTask`
9. `listImportTasks`
10. add `updated_from` / `updated_to` support in the real provider
11. `createMemory` code may exist, but keep the UI off by default
12. `getTopicSummary` may stay empty, and the UI stays off by default

### Step 5. Finish the real-mode gating matrix

Example:

- mock mode
  - Add memory on
  - Import/Export on
  - Time range on
  - facet/topic on

- real mode
  - Edit/Delete on
  - Import based on backend readiness
  - Time range on only after `/memories` supports it
  - Add memory off
  - topic strip off

## 11. Acceptance Criteria

### UI-first acceptance

- when `VITE_USE_MOCK=true`, both pages are fully demoable
- in mock mode, Add / Edit / Delete / Export / Import / Time range / Topic strip are visible and usable
- page components do not contain hardcoded branches that depend on the real backend

### Real API acceptance

- when `VITE_USE_MOCK=false`, Connect, list, search, detail, edit, and delete work against the real API
- unfinished capabilities do not show broken clickable entries
- when `/memories` lacks `updated_from` / `updated_to`, time range does not render
- when `POST /memories/batch` is unavailable, Add memory does not render
- when `/summary` is unavailable, topic strip does not render

## 12. Explicit Requirements for AI Agents

- do not write `if (mock) ... else ...` inside page components
- do not wire nonexistent real APIs into visible buttons
- do not use `POST /memories` as a stand-in for manual add
- keep all user copy in i18n
- keep all data entry points exposed to the UI through query hooks
- keep feature flags centralized in `src/config/features.ts`
- use the exact task status strings from `data-contract.md`
