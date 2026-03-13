# mem9 Dashboard IA v2

Status: draft  
Date: 2026-03-13  
Audience: product, design, frontend, backend

## 1. Decision Summary

- The dashboard uses a single-space memory workspace model.
- MVP keeps only two routes: `/your-memory` and `/your-memory/space`.
- `Your Memory` is the only functional page. Stats, search, list, detail, light management, import, and export all happen there.
- Users see only `active` memories. Do not expose paused / archived / deleted in V1.
- User-facing labels for memory type are fixed:
  - `Saved by you`
  - `Learned from chats`
- `Export JSON` and `Import JSON` are launch features, not post-launch extras.
- `facet` / category belongs in the product model, but the topic strip enters launch only if the backend provides stable data in time.

## 2. Routes

| Route | Page | Purpose |
| --- | --- | --- |
| `/your-memory` | Connect | Enter a `space ID` and establish the current browser session |
| `/your-memory/space` | Your Memory | View, search, understand, organize, import, and export memories in the current space |

Do not keep backend-style routes such as `/overview`, `/memories`, or `/memories/:id`.

## 3. Connect

### 3.1 Goal

- Explain what `space ID` is
- Let the user enter their memory space safely
- Make it clear this is a space connection page

### 3.2 Required Blocks

- `mem9` brand
- Title: `Your Memory`
- A short description that says this is the entry point for a memory space
- `space ID` input and primary button
- Security notice that `space ID` is sensitive and should not be shared
- Short `How mem9 works`
- Language switch
- Theme switch

### 3.3 Interaction Rules

- `space ID` never appears in the URL
- Store it only in `sessionStorage`
- On success, navigate to `/your-memory/space`
- Use a 30-minute idle timeout in MVP
- Any pointer, keyboard, scroll, or route-change activity resets the idle timer
- On idle timeout, clear the session and return to this page
- Opening `/your-memory/space` without a valid session immediately redirects here
- Prefer `GET /info` to validate the space; fall back to `GET /memories?limit=1` when `/info` is not routed

### 3.4 Page States

| State | Handling |
| --- | --- |
| Initial | Empty input, primary button visible |
| Validating | Button shows loading, prevent duplicate submit |
| Validation failed | Show a clear error and keep the input value |
| Session expired | Return here and ask the user to reconnect |
| Direct open without session | Redirect here immediately |

## 4. Your Memory

### 4.1 Page Role

This is the main dashboard page. It answers five questions:

1. What is remembered right now
2. Which memories were explicitly saved and which were learned from chats
3. What these memories are mostly about
4. Whether the user can correct obviously wrong memory
5. Whether the user can back up or import memories without leaving the page

### 4.2 Page Structure

#### Top bar

- `mem9` brand
- Title: `Your Memory`
- Masked current `space ID`
- `Space Tools` menu
- Language switch
- Theme switch
- `Disconnect`

`Space Tools` is where space-level actions live without crowding the main workflow.

#### Stats row

- Total memories
- `Saved by you` count
- `Learned from chats` count

This replaces a dedicated Overview page.

#### Topic strip

When category data exists, show `Browse by topic` below the stats:

- `Preferences`
- `Plans`
- `Important People`
- Other facets

Each chip shows a count and filters the list. If backend data is not ready, hide the whole row.

Interaction rules:

- V1 supports one selected facet at a time
- facet selection combines with search, type, and time range
- clicking the active chip clears the facet filter
- when a facet key has no localized label, render the raw key

#### Primary actions row

- Search field
- Time range
- Type tabs: `All`, `Saved by you`, `Learned from chats`
- `Add memory`

Do not add source / agent / state multi-filters in V1.

Use short presets for time range, with `All time` as the default.  
The selected range applies to stats, `Browse by topic`, and list together.
Show and validate the full interaction in mock mode first. Hide the control in real mode until backend params are ready.

#### Memory list

Each card shows:

- Type marker
- Content preview
- Relative time
- Optional category label
- Secondary source information

Pagination uses `Load more`. No infinite scroll.

#### Detail panel

Desktop uses a right-side panel. Mobile uses an overlay.

The panel shows:

- Type label
- Full content
- Category label when present
- Tags
- Updated time
- Secondary technical fields: source, agent, session, metadata

Technical fields should be collapsed or visually secondary.

#### Footer explanation

When memories exist, keep a fixed inline explanation near the list or stats:

`Saved by you` means the user explicitly asked the agent to remember it.  
`Learned from chats` means the system extracted it from conversations.

## 5. Interaction Layers

| Interaction layer | Entry point | Rule |
| --- | --- | --- |
| Add Memory Dialog | Primary action area | Must create `Saved by you` / `pinned` only |
| Edit Memory Dialog | Detail panel | Available only for `pinned` |
| Delete Confirm | Detail panel | Always confirm before delete |
| Export Dialog | `Space Tools` | Export current `active` memories |
| Import Dialog / Status | `Space Tools` | Upload JSON and show task progress / result |

## 6. Product Rules

- “Manually add memory” must semantically create `pinned`. If the backend cannot guarantee that, hide the action in launch.
- Edit is available only for `pinned`. Treat `insight` as system-derived memory and do not expose direct rewrite in V1.
- Delete applies to current `active` memories. Use copy such as “Remove from this space”.
- `type` answers how the memory was created.
- `facet` answers what the memory is about.
- `source / agent / session / metadata` belong to the evidence layer.
- Export covers all current `active` memories in the space by default; it does not follow the page time range.
- Time range code belongs in launch. In live API mode, visibility still follows backend readiness and feature gating.

## 7. Launch Cut Line

### 7.1 Required for launch

- Connect
- Stats, time range, search, type tabs, list, detail
- `Edit pinned memory`
- Delete memory
- `Export JSON`
- `Import JSON` plus task status
- Chinese and English
- Desktop and mobile usability

### 7.2 Include when dependencies are ready

- `Add memory`
- facet labels
- `Browse by topic`

`Add memory` depends on a backend path that returns synchronously and always creates `pinned`.  
facet UI depends on stable `metadata.facet` write support plus an aggregation source.

### 7.3 Explicitly out of launch

- Multi-space switching
- non-active memory management
- Batch edit and batch delete
- External connectors
- Graph view
- Conflict merge center
- Making Save Room the primary entry point
