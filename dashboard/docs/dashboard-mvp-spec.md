# mem9 Dashboard MVP Draft Spec

Status: draft  
Date: 2026-03-13  
Audience: mem9 product, design, frontend, backend

## 1. Product Judgement

`mem9.ai` should provide an official web dashboard as one of mem9's main product interfaces.

Its job is to provide a stable user surface for viewing, understanding, and lightly managing memory. Plugins and `Save Room` keep their own roles.

Corresponding judgements:

- `Dashboard` is the main product
- `Save Room` is Labs / onboarding / propagation layer
- MVP focuses on the formal dashboard first; do not anchor the main entry point on creative projects

## 2. Why Now

mem9 already has a fairly complete memory foundation:

- Persistent memory server
- Space-level shared memory
- Hybrid search
- Multi-agent / multi-plugin integration
- Auto recall, auto-capture, compact/reset lifecycle integration

But users still lack a formal control surface:

- Users cannot see "what is actually remembered right now"
- Users do not know "which are explicitly saved by me, which are system-extracted"
- Users have no viewing entry point more natural than API, CLI, or config files
- Users cannot conveniently back up, export, or move their memories
- Users only see a flat list and cannot tell what the memory space is mostly about
- Users still have limited visibility into what memory currently contains

The dashboard's goal is to translate mem9's value into a product interface users can directly understand and trust.

## 3. Product Boundary Based on Current mem9 Capabilities

This spec is grounded in mem9's current capabilities and does not assume new platform features.

Capabilities that can be directly relied on today:

- Memory CRUD and search
- Filtering by `memory_type`, `state`, `source`, `agent_id`, `session_id`
- Memory base fields: `content`, `tags`, `metadata`, `created_at`, `updated_at`
- Async file import (`/imports` plus task status polling)
- Two memory types: `pinned` and `insight`
- State model: `active` / `paused` / `archived` / `deleted`
- OpenClaw / OpenCode / Claude Code auto-write and auto-recall capabilities

Capabilities that should NOT be assumed today:

- Full web login system
- Dashboard-specific recall telemetry
- Per-turn "why this answer" event stream
- Stable export endpoint
- Semantic memory facet classification and summary endpoint
- Multi-space organizational control plane
- Stable account system for end users

This implies the MVP should be:

- Single space
- Read-first
- Light management
- Strong explainability

## 4. Target Users

### 4.1 Primary Users

- Users who have already integrated mem9 in OpenClaw, OpenCode, Claude Code, or custom agents
- Agent owners / builders who want to view and manage their own or team memory space
- People with some tolerance for config and API, but who do not want to understand memory through the terminal every day

### 4.2 Secondary Users

- Collaborators in small teams sharing the same memory space
- Product/design/ops colleagues who want to confirm "why the agent didn't forget"

### 4.3 Users Not Served in MVP

- Enterprise administrators
- People who need multi-org, multi-permission, multi-project backends
- Pure consumer users with no concept of space ID

## 5. Competitive Landscape and Industry Judgement

Memory-related product GUIs today roughly fall into three categories:

### 5.1 Letta

Characteristics:

- Memory is highly inspectable and configurable
- Emphasizes visibility of agent state and memory structure
- Product form is developer-workbench oriented

Takeaways:

- Users need visibility into how memory works
- The product form is developer-workbench oriented and does not directly map to a homepage for ordinary users

### 5.2 Zep

Characteristics:

- Strong graph / episode / debugging / observability
- Product form is graph and debugging console oriented

Takeaways:

- Auditability, provenance tracking, and event visibility are important
- This product category does not map directly to a homepage for ordinary users

### 5.3 OpenMemory / Mem0

Characteristics:

- Closest to "unified memory dashboard / workspace"
- Emphasizes shared memory entry across agents, projects, and tools

Takeaways:

- Users do need a centralized memory management panel
- This proves the dashboard form is viable, not just an internal developer tool

### 5.4 Opportunity Judgement for mem9

mem9 does not need to become all of the following at MVP stage:

- Agent IDE
- Graph platform
- Enterprise control plane

mem9 needs a memory dashboard for day-to-day use, covering viewing, filtering, organizing, backup, and migration.

## 6. Product Positioning

`mem9 Dashboard is the formal entry point for users to enter their memory space, used to view, search, understand, organize, back up, and move long-term memory.`

It must first answer five questions:

1. What does it remember right now?
2. Where did these memories come from?
3. Can I manage it without touching API and config files?
4. Can I export these memories for backup or move them into another space?
5. What are these memories mostly about?

## 7. MVP Goals

MVP does not aim to turn memory into a full product matrix.

V1 only needs to prove six things:

1. mem9 has a formal user interface, not just API and plugins
2. Users can understand what is actually in a memory space
3. Users can distinguish "explicitly saved" from "system-extracted"
4. Users can perform basic control actions
5. Users can export and import their memories and do not feel trapped by one space
6. The product has a defined path for understanding memory by topic, not only as a flat list

## 8. MVP Product Form

Recommended form:

- Formal page within the official site system
- Working name: `your-memory`
- Entry form: `mem9.ai/your-memory` or `app.mem9.ai/your-memory`

The MVP uses a single-space, single-main-task memory panel structure.

MVP adopts a **two-page approach**:

- `/your-memory`
  - Connect / Onboarding
- `/your-memory/space`
  - Your Memory

`Your Memory` is the only functional page, containing:

- Top lightweight stats
- Search
- Time range
- Type switching
- Topic summary / chips when category data is available
- Memory list
- Detail side panel
- Light management actions
- Export / import entry points

MVP user journey:

1. Enter `your-memory`
2. Enter one's own `space ID`
3. Enter `Your Memory`
4. See memory count and recent content in the current space at a glance
5. Understand specific memories through search, type switching, and detail side panel
6. Narrow the current window through time range
7. Complete basic actions such as add and delete

## 9. MVP Core Capabilities

### 9.1 Connect / Onboarding

Goals:

- Let users enter their memory space
- Explain what `space ID` is
- Lower first-use comprehension cost

Terminology: In this document, `space ID` refers to `tenant ID` in the system—the unique identifier users obtain when configuring the mem9 plugin.

MVP must provide:

- Input field for `space ID`
- Direct entry to `Your Memory` after successful access validation
- Clear explanation that this is a sensitive identifier and should not be shared
- Brief explanation of how mem9 works
- Language switch entry (Chinese / English)
- Theme toggle button (Sun/Moon/Monitor icons), cycling light / dark / follow system, placed next to language switch

Security strategy (MVP transition approach):

MVP accepts Space ID as the sole credential to enter the dashboard. Since the dashboard is a browser-facing web product, minimal security measures are needed:

- Space ID is stored only in `sessionStorage`; it expires when the tab is closed
- Connection is automatically disconnected after 30 minutes of idle time
- Space ID is not exposed in the URL
- Security notice displayed prominently on the page

A formal auth / session system will be implemented in post-MVP versions.

MVP does not need to provide:

- Full account registration and login
- Multi-space switcher
- Organization member management

### 9.2 Your Memory

Goals:

- Let users immediately know "what does this space remember right now" upon entry
- Put overview, list, and detail into one continuous experience

MVP must provide:

- Top lightweight stats
  - Total count
  - `Saved by you` (🔖) count
  - `Learned from chats` (✨) count
- When category data is available, show a `Browse by topic` row below the stats
  - Example topics: `Preferences`, `Plans`, `Important People`
  - Each topic shows a count and can filter the list when clicked
- Single search box
  - Based on mem9 hybrid search
  - User can input natural language
- Time-range filter
  - Default is `All time`
  - Launch should provide a short preset set such as `7D`, `30D`, and `90D`
  - The selected range applies to stats, `Browse by topic`, and list together
  - UI-first work validates this interaction in the mock provider first
  - Real mode enables it after `/memories` supports `updated_from` and `updated_to`
- Type switching
  - `All`
  - `Saved by you` (🔖)
  - `Learned from chats` (✨)
- Search, time range, and type can be combined
- Memory list default sorted by update time, newest first
- Desktop right-side detail panel / mobile overlay detail
- When a memory card is clicked, the card shows prominent highlight (ring + shadow) to indicate its correspondence with the right-hand detail panel
- Type legend (when memories exist): Inline explanation directly below the stats card, always visible, format: "🔖 Saved by you — explicitly asked to remember · ✨ Learned from chats — AI-extracted from conversations"
- Type color scheme: pinned uses warm, low-saturation gold tones; insight uses cool, low-saturation slate blue tones; both harmonize with neutral grays; auto-adapt in dark mode
- A brief `How mem9 works` explanation

MVP does not need to provide:

- Dedicated `Overview` page
- Dedicated `Memory Detail` page
- state / source / agent multi-filter
- Dedicated navigation bar

Information hierarchy requirements:

- Memory content takes precedence over technical fields
- `type` answers "how this memory was created"
- `category` / `facet` answers "what this memory is about"
- `source / agent / session / metadata` belong to the evidence layer; they should not overwhelm the main content
- Users see only `active` memories by default; non-active state management is not exposed
- Export covers all current `active` memories in the space by default; it does not follow the page time range

Empty state handling:

- Explain how memories are produced
- Guide users back to agent conversation, or manually add the first memory
- Provide complete `How mem9 works` explanation

### 9.3 Memory Portability

Goals:

- Let users know the memory belongs to them, not to one locked space
- Support the three most direct user scenarios: backup, restore, and migration

Product decision:

- `Export JSON` and `Import JSON` both belong in launch V1
- They are launch V1 capabilities
- Export and import should use the same portable data format

V1 must provide:

- Export `active` memories from the current space as a JSON file
- Put the export entry in the `Space Tools` menu
- Ensure the exported file can be imported by the mem9 dashboard later
- Preserve `memory_type`, `tags`, `metadata`, time fields, and `facet` when present
- Import a JSON file exported by mem9
- Import into the current space, so the same file can be used for migration into another space
- Use direct file upload plus async task status. Do not add a mapping or confirmation step in V1.
- Show import task states: uploading, processing, done, failed
- Refresh the list and stats after import completes
- Preserve original `memory_type`; do not turn imported `pinned` memories into `insight`

This stage does not need:

- CSV / Notion / Google Docs / Slack connectors
- One-click space-to-space copy wizard
- Dedup, merge, or conflict-resolution UI
- Scheduled backup automation

Key constraints:

- The export file is designed for user backup and migration
- Export and import must share one contract

### 9.4 Semantic Categories

Goals:

- Let users understand what the memory space is mostly about, not only scroll a flat list
- Give normal users a more stable browsing structure than tags

Terminology:

- User-facing term: `category`
- Backend term: `facet`
- `type` answers "how was this memory created"
- `facet` answers "what is this memory about"

Recommended first taxonomy:

| System value | User-facing label | Meaning |
|--------------|-------------------|---------|
| `about_you` | About You | Identity, background, stable personal facts |
| `preferences` | Preferences | Likes, dislikes, style preferences |
| `important_people` | Important People | Family, friends, pets, frequently mentioned people |
| `experiences` | Experiences | Projects, work, skills, past experience |
| `plans` | Plans | Upcoming tasks, commitments, goals |
| `routines` | Routines | Recurring habits and regular patterns |
| `constraints` | Boundaries | Hard requirements, allergies, sensitive topics, non-negotiables |
| `other` | Other | Everything else |

Product form:

- Show a category label on memory cards and in the detail panel when `facet` exists
- Keep category as the second layer of organization; it does not replace `Saved by you / Learned from chats`
- Add a `Browse by topic` row below the stats and let users filter the list by category
- Topic counts and examples follow the current time range
- If the backend provides summary examples, show one or two examples in hover or expanded state

Scope decision:

- Category support now enters the product spec and is no longer a vague future idea
- It matters for ordinary users, but still comes after import/export in priority
- If the backend lands `metadata.facet` and `/summary` before launch, category labels plus topic strip go into V1
- If the backend does not land in time, V1 still reserves the copy model and hierarchy, and the first increment adds the full feature

### 9.5 Light Management

Goals:

- Give users basic sense of control
- Make the dashboard more than a passive viewing page

MVP recommends exposing only a small number of safe, easy-to-understand actions:

- Manually add one `Saved by you` memory
- Delete one memory
- Edit `Saved by you` (pinned) memory content and tags (via dialog in the detail panel, pinned type only)

MVP does not recommend forcing in:

- Full lifecycle control of pause / archive / restore
- Batch edit or batch delete

Critical prerequisite:

- "Manually add" must semantically create `pinned` in product terms
- If the backend cannot guarantee "manually add = pinned," remove it from MVP and do not substitute `insight`

### 9.6 Trust Layer

This layer is in MVP.

Even without full telemetry, the dashboard must improve visibility.

MVP must at least:

- Clearly distinguish "Saved by you" from "Learned from chats"
- When categories are available, clearly distinguish "how it was created" from "what it is about"
- Explain where auto-extracted memory comes from
- Show provenance and update time
- Let users know the page shows stored memories; per-turn reasoning logs are outside the current scope

### 9.7 Dark Mode

Dark mode support is in MVP. Implementation aligns with the main site mem9.ai dark theme (`html[data-theme='dark']` color scheme).

- Three modes: light / dark / follow system
- Theme toggle button cycles: light → dark → follow system
- Preference stored in localStorage

### 9.8 Bilingual Support

Chinese-English bilingual support is in MVP, not a follow-up patch.

MVP must provide:

- Complete interface copy in `zh-CN` and `en`
- Auto-select on first visit based on browser language
- Provide a visible manual switch entry for users
- Remember user's language preference

Bilingual scope:

- Connect page copy
- `Your Memory` page copy
- Buttons, tabs, empty states, error states, toast, dialog
- `How mem9 works` explanation

Bilingual does not include:

- User's own memory content
- User-original content in tags and metadata
- Raw field values returned by API

Product constraints:

- Routes are not split by language; keep `/your-memory` and `/your-memory/space`
- Language preference and Space session are stored separately
- All user-facing type, state, and action copy must be mapped through i18n keys; no hardcoding in components

## 10. MVP Explicitly Does NOT Do

To ensure release cadence, the following are explicitly out of scope for this V1:

- `Save Room` main flow integration
- Per-turn recall trace
- Precise evidence chain of "why this answer cited this memory"
- Knowledge graph view
- Multi-space management
- Team permission system
- Connector-style imports from Notion / Slack / Docs and similar tools
- Dedup, merge, and conflict-resolution center
- Scheduled backup center
- Full activity center
- Account system for general consumers

## 11. Backend Capability Prerequisites for MVP

As a browser-facing web product, the Dashboard depends on the following mem9 backend capabilities. These are product-side requirements; specific technical approaches are defined in engineering docs.

Must have (P0):

- Stable memory API routes accessible behind a same-origin proxy
- Dashboard receives synchronous result when creating memory — Current create endpoints all return asynchronously; dashboard manual add needs immediate feedback
- Dashboard can page through current `active` memories for JSON export
- Dashboard can obtain total count and both memory type counts via list endpoint for top stats
- `/memories` supports optional `updated_from` / `updated_to` for time-range filtering

Should have (P1):

- Space info query — After user enters Space ID, need to validate validity and fetch basic info
- Memory stat aggregation — Top stats bar ideally provided by backend via dedicated stats endpoint
- Specify memory type on create — Support dashboard creating `pinned` type memory (current create endpoint defaults to `insight`)
- Import task endpoint and status query — current `/imports` can be the starting point, but needs a dashboard-friendly memory file contract
- Stable JSON contract shared by export and import, preserving `memory_type`, `tags`, `metadata`, and `facet`
- `metadata.facet` field plus write-time classification
- `/summary` or equivalent aggregation endpoint returning facet counts and examples
- `/summary` supports `updated_from` / `updated_to` so topic strip and list stay aligned
- UI-first work validates time range in the mock provider first; real mode shows the control only after backend support is ready

Bilingual-related notes:

- Current backend does not need to provide locale parameter
- Internationalization is done on the dashboard frontend
- API continues to return raw enum values; frontend maps to localized copy

## 12. Information Architecture

MVP recommends keeping minimal information architecture:

- Connect
- Your Memory
- Space Tools Menu
- Time Range Filter
- Add Memory Modal
- Edit Memory Dialog (pinned only, triggered from detail panel)
- Delete Confirm Dialog
- Export Dialog
- Import Dialog / Import Status

`Your Memory` page consolidates stats, list, detail, and explanation; no separate `Overview` or `Memory Detail` pages.

## 13. Product Principles

- Show the core information clearly
- Keep the single-space, single-page core flow first
- Improve clarity and visibility first
- Keep the dashboard as a product surface
- Keep `Save Room` on its own track

## 14. Success Criteria for Launch Version

The launch version meets MVP if it satisfies:

- User can enter their memory space within 1 minute
- User can answer "what does mem9 remember right now" without CLI / API
- User can distinguish explicit memory from system-extracted memory
- User can complete view, search, filter by time range, open detail, and delete in one page
- User can delete a clearly wrong or unwanted memory
- User can export current `active` memories as JSON for backup or migration
- User can import a mem9 JSON memory file into the current space
- User can complete the same main tasks in Chinese or English interface
- User can directly inspect and manage memory

## 15. Most Reasonable Extension Order After MVP

1. More stable auth / session model
2. Semantic categories (`facet`) and `/summary`
3. Recall / save / reset / compact event visualization
4. More complete memory lifecycle operations
5. Multi-space / team management
6. `Save Room` as Labs / onboarding experience

## 16. Locked Launch Decisions

- Launch path is `mem9.ai/your-memory`
- zh/en fallback language is `en`
- `Export JSON` and `Import JSON` live in `Space Tools`
- `Import JSON` uses direct file upload and async task status in V1
- MVP includes edit for pinned memory
- `facet` stays in the product model; launch UI shows it only when backend data is ready
- MVP uses the Space ID + `sessionStorage` transition model described in 9.1
- `Recent Activity` is not a separate module; recent memory stays inside `Your Memory`
- MVP keeps the two-page approach: Connect + Your Memory

## 17. Conclusion

This dashboard MVP has a direct definition:

`Give users a way to enter their memory space and view, filter, understand, organize, back up, and move long-term memory.`

## References

Local materials:

- `README.md`
- `site/src/content/site.ts`
- `openclaw-plugin/README.md`
- `opencode-plugin/README.md`
- `docs/design/smart-memory-pipeline-proposal.md`

External references:

- Letta Docs: https://docs.letta.com/guides/core-concepts/memory/memory-blocks
- Letta Docs: https://docs.letta.com/letta-code/memory/
- Zep Docs: https://help.getzep.com/v2/quickstart
- Zep Docs: https://help.getzep.com/docs/building-searchable-graphs/debugging
- Mem0 Docs: https://docs.mem0.ai/
- OpenMemory Quickstart: https://docs.mem0.ai/openmemory/quickstart
