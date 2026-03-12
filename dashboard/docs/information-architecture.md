# mem9 Dashboard IA — Two-Page Design

Status: draft  
Date: 2026-03-12  
Audience: mem9 product, design, frontend

## 1. Core Changes

v1 approach: 4 pages + 2 interaction layers  
v2 approach: **2 pages** + 2 interaction layers

Changes:

- Remove standalone Overview page → merge stats into top of main page
- Remove standalone Memory Detail page → implement detail as side panel
- No inter-page navigation bar needed

## 2. Why This Change

v1’s four-page flow (Connect → Overview → Memories List → Memory Detail) follows a typical admin dashboard pattern: view overview first, then list, then click for details. Three hops.

But mem9 dashboard users are not backend admins. They come with one goal: **see what my agent has remembered**.

ProxyCast validates this: it shows stats and memory list on the same screen. Users see content immediately; they don’t need to pass through a separate “dashboard” first.

v2 design principles:

- **One step** to see memories after entering a space
- Stats are auxiliary, not a standalone entry
- Detail stays in the list context, no new page
- No need to learn a navigation structure

## 3. Page Structure

```
/your-memory          → Connect (enter space)
/your-memory/space    → Your Memory (stats + search + list + detail side panel)
```

Only two routes. No nav bar.

### 3.1 Language Strategy

MVP supports:

- `zh-CN`
- `en`

Conventions:

- Do not split routes by language; same URL set for all locales
- On first visit, follow browser language
- User can switch language manually
- Language preference is stored separately, not shared with `space ID` storage

### 3.2 Theme Strategy

Dark mode is in scope for MVP. Implementation matches main site mem9.ai (`html[data-theme='dark']` color scheme).

- Three modes: light / dark / follow system
- Theme toggle cycles: light → dark → follow system
- Preference stored in localStorage

## 4. User-Facing Labels for Memory Types

| System value | Chinese | English | Icon | Description |
|--------------|------|---------|------|-------------|
| `pinned` | 你保存的 | Saved by you | 🔖 | You explicitly asked the agent to remember this |
| `insight` | 对话中学到的 | Learned from chats | ✨ | AI automatically extracted this from conversations |

Do not expose `pinned` / `insight` as technical terms to users anywhere in the product.

## 5. Only Show Active Memories

The dashboard only shows memories in `active` state; no state filter is provided.

Reasons:

- Non-active memories are infra concepts (paused / archived / deleted); regular users don’t need to manage them
- Current API GET / PUT / DELETE only act on active; showing non-active but blocking actions would be confusing
- For users, “memory” means “what’s remembered now,” so deleted items are naturally excluded

## 6. Page 1 — Connect

Route: `/your-memory`

### 6.1 Goal

Let users enter their memory space. A calm, direct entry point.

### 6.2 Layout

```
┌─────────────────────────────────────┐
│                                     │
│           [ Theme ] [ 中文 / EN ]   │
│                                     │
│            mem9 logo                │
│                                     │
│         Your Memory                 │
│   Enter your memory space           │
│                                     │
│   ┌─────────────────────────────┐   │
│   │  Space ID                   │   │
│   └─────────────────────────────┘   │
│         [ Enter space ]             │
│                                     │
│   🔒 Space ID is your private ID    │
│      Do not share it with others    │
│                                     │
│   ─────────────────────────────     │
│   How mem9 works                    │
│   · Your agent accumulates memory   │
│     automatically during chats      │
│   · You can also ask the agent      │
│     to remember specific things     │
│   · This dashboard shows stored     │
│     memories                        │
│                                     │
└─────────────────────────────────────┘
```

### 6.3 Interaction

- Space ID does not appear in the URL
- Stored only in sessionStorage
- On idle timeout, return to this page
- Validation failure: `Cannot access this Space. Please check the ID and try again`
- Theme toggle (Sun / Moon / Monitor icons) and language toggle in top-right; stay on current page after switching

### 6.4 Acceptance Criteria

- User understands what to enter within 30 seconds
- Does not confuse it with account login
- Knows Space ID should not be shared
- On success, goes directly to Your Memory main page

## 7. Page 2 — Your Memory

Route: `/your-memory/space`

This is the core of the dashboard and the only functional page. Overview, list, and detail are all on this single page.

### 7.1 Overall Layout

```
┌──────────────────────────────────────────────────────────────┐
│  mem9    Your Memory    space:a1b2…    [ Disconnect ]        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  42 memories    🔖 12 Saved by you    ✨ 30 Learned from chats│
│                                                              │
│  ┌──────────────────────────────────────┐  [ + Add memory ]  │
│  │  🔍 Search your memories…            │                    │
│  └──────────────────────────────────────┘                    │
│                                                              │
│  [ All ]  [ 🔖 Saved by you ]  [ ✨ Learned from chats ]     │
│                                                              │
├────────────────────────────────┬─────────────────────────────┤
│  Memory list                   │  Detail panel               │
│                                │                             │
│  🔖 I prefer TypeScript        │  🔖 Saved by you             │
│     2 hours ago                │                             │
│                                │  I prefer TypeScript,       │
│  ✨ User is building an AI     │  not Java                    │
│     memory project             │                             │
│     yesterday                  │  Source: openclaw            │
│                                │  agent: agent               │
│  ✨ Prefers dark theme         │  Time: 2025-03-10 14:30      │
│     3 days ago                 │                             │
│                                │  Tags: preference, language │
│  🔖 Project codename mem9      │                             │
│     1 week ago                 │  ────────────────           │
│                                │  [ Delete this memory ]     │
│  ...                           │                             │
│                                │                             │
│  [ Load more ]                 │                             │
│                                │                             │
├────────────────────────────────┴─────────────────────────────┤
│  🔖 Saved by you — you explicitly asked to remember · ✨ Learned from chats — AI extracted from conversations │
└──────────────────────────────────────────────────────────────┘
```

### 7.2 Section Descriptions

#### 7.2.1 Header

Fixed at top:

- mem9 logo
- Page title `Your Memory`
- Current Space ID (masked, e.g. `a1b2…c3d4`)
- Theme toggle (Sun / Moon / Monitor icons, cycles light / dark / follow system), next to language switch
- Language switch
- `Disconnect` button

#### 7.2.2 Stats Bar

Lightweight inline stats, not a separate block:

- Total count
- 🔖 Saved by you count
- ✨ Learned from chats count

This row replaces v1’s entire Overview page. Users see the numbers at a glance without a separate page.

#### 7.2.3 Search Bar

- Single search field, centered or near top
- Placeholder: `Search your memories…`
- Enter to search; clear restores default list
- Uses mem9 hybrid search under the hood; user doesn’t need to know

Place `+ Add memory` button to the right of (or above) the search bar.

#### 7.2.4 Type Tabs

```
[ All ]  [ 🔖 Saved by you ]  [ ✨ Learned from chats ]
```

This is the only filter dimension. v1’s state / source / agent filters are removed.

Rationale:

- State filter confirmed unnecessary (only active shown)
- Source / agent have limited value for typical users; source cannot be combined with search anyway
- MVP keeps only the dimension that most affects understanding: who produced the memory

A “more filters” collapsible area can be added later if needed.

#### 7.2.5 Memory List

Each memory card shows:

- Type icon (🔖 or ✨)
- Content preview (2–3 lines, truncated)
- Relative time (just now / 2 hours ago / yesterday / 3 days ago / date)
- Source (e.g. `via openclaw`, as secondary text)

Click any card → detail panel opens on the right; selected card has clear highlight (ring + shadow) to show its link to the detail panel.

Pagination: `Load more` button, no infinite scroll.

#### 7.2.6 Detail Panel

When the user clicks a memory in the list, detail appears on the right (desktop) or bottom / full screen (mobile):

Required:

- Type label (🔖 Saved by you / ✨ Learned from chats)
- Full content
- Last updated time
- Source (user-friendly copy)
- Tags

Collapsible:

- Created time
- Agent ID
- Session ID
- raw metadata JSON

Actions:

- Delete (with confirmation dialog)
- Edit (only 🔖 Saved by you; edit content and tags in a dialog; included in MVP)

#### 7.2.7 Type Legend and Color

Trust-layer explanation of the two memory types.

**Legend placement**: Compact inline legend right below the stats row, always visible when there is content. Format: `🔖 Saved by you — you explicitly asked to remember · ✨ Learned from chats — AI extracted from conversations`. Do not use an expandable “Learn about memory types” area at the bottom of the page.

**Type colors**: pinned (Saved by you) uses warm low-saturation gold tones; insight (Learned from chats) uses cool low-saturation slate blue; both harmonize with neutral grays. Automatically adapt in dark mode.

### 7.3 Empty State

When the space has 0 memories:

```
┌──────────────────────────────────────────────┐
│                                              │
│  mem9    Your Memory    space:a1b2…          │
│                                              │
│  0 memories                                 │
│                                              │
│         🫙                                   │
│                                              │
│   This space has no memories yet             │
│                                              │
│   Memories build up as you chat with         │
│   the agent. You can also add your first     │
│   one manually now                           │
│                                              │
│         [ + Save first memory ]              │
│                                              │
│   ─────────────────────────────              │
│   🔖 Saved by you — you explicitly asked the agent to remember │
│   ✨ Learned from chats — AI extracted from conversations     │
│   Only stored memories are shown here, not inference          │
│                                              │
└──────────────────────────────────────────────┘
```

### 7.4 No Search Results

```
No matching memories found
Try different keywords, or clear the search to see all
```

### 7.5 Required States

- Page loading (skeleton)
- Empty space (0 memories)
- Has memories but no search results
- API errors
- Create in progress (button loading)
- Delete in progress (confirm → loading → done)
- Session expired (return to Connect)
- Language switch (brief non-blocking refresh)

### 7.6 Acceptance Criteria

- Within 5 seconds of entering, user knows “how many memories in this space and of what types”
- User can find a target memory via search
- User can distinguish “saved by me” vs “learned by AI”
- User can view full content of any memory without leaving the page
- User can add a memory and see immediate feedback
- User can delete a memory and see immediate feedback
- User can complete the same core tasks in both Chinese and English

## 8. Key Interactions

### 8.1 Add Memory

Entry: `+ Add memory` button next to the search bar. Raised to primary CTA in empty state.

Form: Modal.

```
┌─────────────────────────────────┐
│  Add a memory                   │
│                                 │
│  What do you want the agent     │
│  to remember?                   │
│  ┌─────────────────────────┐    │
│  │                         │    │
│  │  (text input area)       │    │
│  │                         │    │
│  └─────────────────────────┘    │
│                                 │
│  Tags (optional)                │
│  ┌─────────────────────────┐    │
│  │  e.g. preference, project│    │
│  └─────────────────────────┘    │
│                                 │
│       [ Cancel ]   [ Save ]     │
│                                 │
│  This will be marked 🔖 Saved   │
│  by you                         │
└─────────────────────────────────┘
```

On success: close modal → new memory appears at top of list → success toast.

### 8.2 Delete Memory

Entry: `Delete this memory` button at bottom of detail panel.

Form: Confirm dialog.

```
┌─────────────────────────────────┐
│  Delete this memory?             │
│                                 │
│  "I prefer TypeScript,           │
│   not Java"                     │
│                                 │
│  After deletion the agent will  │
│  no longer remember this         │
│                                 │
│       [ Cancel ]   [ Delete ]    │
└─────────────────────────────────┘
```

On success: close dialog → collapse detail panel → remove item from list → success toast.

### 8.3 Disconnect

`Disconnect` button in header → clear sessionStorage → return to Connect.

### 8.4 Language Switch

Entry:

- Top-right on Connect page
- Header on Your Memory page

Behavior:

- Toggle between `zh-CN` / `en`
- Keep current route and current `space` session
- Text updates immediately

Not changed by switch:

- Original user memory content
- Tags, raw metadata content

## 9. Responsive

- **Desktop** (≥1024px): Two-column layout (list + detail panel on right)
- **Tablet / narrow** (768–1023px): List full width; clicking a memory slides detail in from the right to overlay
- **Mobile** (<768px): List full width; clicking a memory shows detail full-screen overlay with back button at top

## 10. v1 vs v2 Comparison

| Dimension | v1 (4 pages) | v2 (2 pages) |
|-----------|--------------|--------------|
| Route count | 4 | 2 |
| Nav bar needed | Yes (Overview / Memories) | No |
| Hops to see memories | Enter → Overview → Memories | Enter → see directly |
| Detail view | Navigate to new page | Side panel, stays on list |
| Overview stats | Separate page | One row at top |
| Filter complexity | type + state + source + agent | Only type (2 options) |
| Dev effort | 4 page components + nav | 2 page components |
| Target users | More technical / admin mindset | General users / product mindset |

## 11. Cut-Scope Rules

If time is very tight, prioritize keeping:

- Can enter space
- Can see memory list + stats
- Can search
- Can view single memory detail
- Can add + delete

Can cut:

- Detail panel → fallback to clicking to expand card content
- Type tabs → fallback to show all, use icons to differentiate
- Stats bar → fallback to total count only
- Responsive → desktop-only first

Must not cut:

- Visible distinction between 🔖 and ✨
- Search capability
- Space ID safety messaging
- Empty and error states
