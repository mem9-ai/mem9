# mem9 Dashboard MVP Draft Spec

Status: draft  
Date: 2026-03-12  
Audience: mem9 product, design, frontend, backend

## 1. Product Judgement

`mem9.ai` should provide an official web dashboard as one of mem9's main product interfaces.

Its responsibility is neither to replace plugins nor to replace `Save Room`, but to turn mem9 from "infrastructure capability" into "a product users can view, understand, and lightly manage."

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
- Users still easily experience memory as a black box

So the dashboard's goal is not "one more admin page," but to translate mem9's value into a product interface users can directly understand and trust.

## 3. Product Boundary Based on Current mem9 Capabilities

This spec must be grounded in mem9's existing capabilities, not in hypothetical new platform features.

Capabilities that can be directly relied on today:

- Memory CRUD and search
- Filtering by `memory_type`, `state`, `source`, `agent_id`, `session_id`
- Memory base fields: `content`, `tags`, `metadata`, `created_at`, `updated_at`
- Two memory types: `pinned` and `insight`
- State model: `active` / `paused` / `archived` / `deleted`
- OpenClaw / OpenCode / Claude Code auto-write and auto-recall capabilities

Capabilities that should NOT be assumed today:

- Full web login system
- Dashboard-specific recall telemetry
- Per-turn "why this answer" event stream
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
- Closer to agent IDE / developer surface

Takeaways:

- "Memory is not a black box" is correct
- But the product form leans toward a developer workbench, not a memory homepage from a normal user's perspective

### 5.2 Zep

Characteristics:

- Strong graph / episode / debugging / observability
- More like a memory and knowledge graph operations and debugging console

Takeaways:

- Auditability, provenance tracking, and event visibility are important
- But the product mindset leans toward graph platform, not "what my agent remembered"

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

mem9's opportunity is:

`Build the simplest, most trustworthy, and most aligned with real agent usage scenarios memory dashboard.`

That is:

- More product-like than pure infra
- More "my memory space" than a DB browser
- More suitable for daily use than a creative demo

## 6. Product Positioning

One-sentence positioning:

`mem9 Dashboard is the formal entry point for users to enter their memory space, used to view, search, understand, and lightly manage long-term memory.`

It must first answer three questions:

1. What does it remember right now?
2. Where did these memories come from?
3. Can I manage it without touching API and config files?

## 7. MVP Goals

MVP does not aim to turn memory into a full product matrix.

MVP only needs to prove four things:

1. mem9 has a formal user interface, not just API and plugins
2. Users can understand what is actually in a memory space
3. Users can distinguish "explicitly saved" from "system-extracted"
4. Users can perform basic control actions, not just passively accept

## 8. MVP Product Form

Recommended form:

- Formal page within the official site system
- Working name: `your-memory`
- Entry form: `mem9.ai/your-memory` or `app.mem9.ai/your-memory`

The MVP product structure is not "complex backend," but a single-space, single-main-task memory panel.

MVP adopts a **two-page approach**:

- `/your-memory`
  - Connect / Onboarding
- `/your-memory/space`
  - Your Memory

`Your Memory` is the only functional page, containing:

- Top lightweight stats
- Search
- Type switching
- Memory list
- Detail side panel
- Light management actions

MVP user journey:

1. Enter `your-memory`
2. Enter one's own `space ID`
3. Enter `Your Memory`
4. See memory count and recent content in the current space at a glance
5. Understand specific memories through search, type switching, and detail side panel
6. Complete basic actions such as add and delete

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
- Connection is automatically disconnected after idle timeout
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
- Merge overview, list, and detail into one continuous experience, rather than backend-style multi-page navigation

MVP must provide:

- Top lightweight stats
  - Total count
  - `Saved by you` (🔖) count
  - `Learned from chats` (✨) count
- Single search box
  - Based on mem9 hybrid search
  - User can input natural language
- Type switching
  - `All`
  - `Saved by you` (🔖)
  - `Learned from chats` (✨)
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
- `source / agent / session / metadata` belong to the evidence layer; they should not overwhelm the main content
- Users see only `active` memories by default; non-active state management is not exposed

Empty state handling:

- Explain how memories are produced
- Guide users back to agent conversation, or manually add the first memory
- Provide complete `How mem9 works` explanation

### 9.3 Light Management

Goals:

- Give users basic sense of control
- Make the dashboard more than a passive viewing page

MVP recommends exposing only a small number of safe, easy-to-understand actions:

- Manually add one `Saved by you` memory
- Delete one memory
- Edit `Saved by you` (pinned) memory content and tags (via dialog in the detail panel, pinned type only)

MVP does not recommend forcing in:

- Full lifecycle control of pause / archive / restore
- Batch operations
- Complex import/export

Critical prerequisite:

- "Manually add" must semantically create `pinned` in product terms
- If the backend cannot guarantee "manually add = pinned," it should be removed from MVP rather than quietly downgraded to `insight`

### 9.4 Trust Layer

This is critical for MVP, not optional.

Even without full telemetry, the dashboard must reduce the black-box feeling.

MVP must at least:

- Clearly distinguish "Saved by you" from "Learned from chats"
- Explain that auto-extracted memory is not user-written
- Show provenance and update time
- Let users know mem9 currently displays "memories that have been stored," not per-turn reasoning logs

### 9.5 Dark Mode

Dark mode support is in MVP. Implementation aligns with the main site mem9.ai dark theme (`html[data-theme='dark']` color scheme).

- Three modes: light / dark / follow system
- Theme toggle button cycles: light → dark → follow system
- Preference stored in localStorage

### 9.6 Bilingual Support

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

To ensure release cadence, the following are explicitly out of scope for this MVP:

- `Save Room` main flow integration
- Per-turn recall trace
- Precise evidence chain of "why this answer cited this memory"
- Knowledge graph view
- Multi-space management
- Team permission system
- Bulk import/export UI
- Full activity center
- Account system for general consumers

## 11. Backend Capability Prerequisites for MVP

As a browser-facing web product, the Dashboard depends on the following mem9 backend capabilities. These are product-side requirements; specific technical approaches are defined in engineering docs.

Must have (P0):

- Browser cross-origin access support — Dashboard calls mem9 API directly from the browser; backend must allow cross-origin requests from the dashboard domain
- Dashboard receives synchronous result when creating memory — Current create endpoints all return asynchronously; dashboard manual add needs immediate feedback
- Dashboard can obtain total count and both memory type counts via list endpoint for top stats

Should have (P1):

- Space info query — After user enters Space ID, need to validate validity and fetch basic info
- Memory stat aggregation — Top stats bar ideally provided by backend via dedicated stats endpoint
- Specify memory type on create — Support dashboard creating `pinned` type memory (current create endpoint defaults to `insight`)

Bilingual-related notes:

- Current backend does not need to provide locale parameter
- Internationalization is done on the dashboard frontend
- API continues to return raw enum values; frontend maps to localized copy

## 12. Information Architecture

MVP recommends keeping minimal information architecture:

- Connect
- Your Memory
- Add Memory Modal
- Edit Memory Dialog (pinned only, triggered from detail panel)
- Delete Confirm Dialog

`Your Memory` page consolidates stats, list, detail, and explanation; no separate `Overview` or `Memory Detail` pages.

## 13. Product Principles

- Explain first, then manage
- Single space first, then multi-space
- Read-first first, then write-heavy
- Single-page closed loop first, then extend to multiple pages
- Reduce black-box feeling first, then pursue fancy visualizations
- Establish bilingual framework first, then add more edge features
- Do not turn the dashboard into a database row browser
- Do not turn the dashboard into a graph platform
- Do not turn the dashboard into a replacement for `Save Room`

## 14. Success Criteria for Launch Version

The launch version meets MVP if it satisfies:

- User can enter their memory space within 1 minute
- User can answer "what does mem9 remember right now" without CLI / API
- User can distinguish explicit memory from system-extracted memory
- User can complete view, search, open detail, and delete in one page
- User can delete a clearly wrong or unwanted memory
- User can complete the same main tasks in Chinese or English interface
- User's understanding of mem9 improves from "black-box plugin" to "visible, searchable, controllable memory layer"

## 15. Most Reasonable Extension Order After MVP

1. More stable auth / session model
2. Recall / save / reset / compact event visualization
3. More complete memory lifecycle operations
4. Bulk import/export
5. Multi-space / team management
6. `Save Room` as Labs / onboarding experience

## 16. Open Questions

- Whether the launch entry is ultimately `mem9.ai/your-memory` or `app.mem9.ai/your-memory`
- Whether launch is pure beta style or official nav entry on the main site
- ~~Whether launch allows editing pinned memory~~ → MVP includes edit for pinned memory (content and tags)
- Which language to use as default fallback for zh/en copy

The following have been confirmed in this document:

- ~~Whether launch session model accepts transition approach~~ → MVP uses Space ID + sessionStorage transition approach (see 9.1)
- ~~Whether `Recent Activity` enters MVP~~ → Not a standalone module; recent memories appear directly in the main `Your Memory` list
- ~~Whether MVP still uses 4-page IA~~ → No; uses two-page approach (Connect + Your Memory)

## 17. Conclusion

This dashboard MVP should not be defined as "build an admin page."

A more accurate definition is:

`Advance mem9 from agent memory infrastructure into a product that users can truly enter, view, understand, and lightly manage.`

This is also mem9's first step from "works" to "trusted."

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
