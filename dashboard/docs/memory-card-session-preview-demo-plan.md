# mem9 Dashboard Memory Card Session Preview Demo Plan

Status: draft  
Date: 2026-03-19  
Worktree: `docs-memory-card-context`  
Related issue: `#110`  
Audience: dashboard, backend

## 1. Goal

The current dashboard already shows memory text, time, source, facet, and tags.

What it still lacks is thread context. A short `insight` often looks correct, but
the user cannot tell what conversation produced it.

This doc covers the next step:

- backend direction for a general session message read API
- dashboard demo work in this worktree
- mock-data-based UI validation before the real API is ready

This doc is an execution plan for this worktree only.

The dashboard-side `GET /memories` request rules defined here should be treated
as stable frontend contract, not as a demo-only workaround.

## 2. Backend Direction

The current API request is in issue `#110`.

Proposed API:

`GET /session-messages?session_id=a&session_id=b&limit_per_session=2`

Expected shape:

- `session_id` is repeatable
- response stays flat as `messages[]`
- each item includes `session_id`
- response can reuse the existing session message fields
- ordering is `created_at ASC, seq ASC, id ASC`

Why this shape:

- it maps cleanly to the current `sessions` table
- it is general-purpose
- it does not introduce a dashboard-only session summary resource
- clients can group by `session_id` on their own

## 3. Demo Scope In This Worktree

This step does not depend on the real API.

The demo will use:

- real memory cards from the existing mock memory dataset
- mock session messages keyed by `session_id`

UI goals:

- keep `pinned` cards close to their current shape
- add compact thread preview to `insight` cards that have `session_id`
- show a larger same-thread preview in the detail panel
- make the preview feel useful without turning the page into a chat transcript

## 4. Card And Detail Rules

For list cards:

- show preview only for `insight` with non-empty `session_id`
- render 1 to 2 short message excerpts
- keep the memory summary as the primary content
- treat the preview as context, not evidence

For the detail panel:

- show a larger message slice from the same `session_id`
- keep it as thread preview, not a full transcript view
- make role and message order easy to scan

## 5. Data Flow For The Demo

The demo should already follow the future API shape as much as possible.

- keep the existing memory list path unchanged
- always send `memory_type` when loading the dashboard memory list
- if the UI is filtering one type, send that type
- otherwise send `memory_type=pinned,insight`
- apply the same rule with and without `q`
- keep session preview out of the existing `useMemories` path
- collect unique `session_id` values from the current page of memories
- read session messages in one batch through a dedicated TanStack Query path
- keep the provider response flat as `messages[]`
- group the flat message list by `session_id` in the query or use-case layer
- let cards and the detail panel share the same grouped session data
- feed a short preview to cards and a longer preview to the detail panel

This keeps the UI work close to the later real integration.

This also avoids mixed `session` items from the current `/memories` search path.

## 6. State Rules

- `pinned` cards never show session preview
- `insight` without `session_id` stays as the current card UI without placeholder
- `insight` with `session_id` but no returned messages falls back silently to the
  current card UI
- session preview query failure must not block memory list rendering
- list cards may use a very light loading placeholder, but preview must stay
  visually secondary to the memory summary
- detail panel may show local preview loading, but the memory content must render
  immediately
- preview is context only, not evidence or exact provenance

## 7. Implementation Plan

- add session message mock types
- add mock session message data in `dashboard/app/src/api/mock-data.ts`
- add a provider method for batch session message read
- add one TanStack Query hook for session preview messages
- group session messages by `session_id` outside UI components
- update `memory-card.tsx`
- update `detail-panel.tsx`
- keep the current `GET /memories` path unchanged

## 8. Mock Coverage And Acceptance

Mock coverage:

- at least one `insight` with previewable `session_id`
- at least one `insight` with empty `session_id`
- at least one `insight` with `session_id` but no matching session messages
- at least one longer session slice to validate excerpt truncation
- both `user` and `assistant` roles
- multiple memories across different `session_id` values

Acceptance:

- dashboard memory list requests always send `memory_type`
- `All` uses `memory_type=pinned,insight`
- the same rule applies with and without `q`
- session preview loads through one batch query path
- card uses short preview and detail uses longer preview from the same grouped
  session data
- missing preview data or preview query failure does not break the main memory UI

## 9. Non-Goals

- no real backend API integration in this step
- no change to `/memories`
- no exact message-to-insight provenance
- no session messages mixed into the main memory list
- no full thread page
