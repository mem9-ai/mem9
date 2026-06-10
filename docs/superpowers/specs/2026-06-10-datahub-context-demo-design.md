# DataHub Context Demo Design

Date: 2026-06-10
Area: `demos/datahub-context`, `server/internal/service`, `server/internal/handler`
Status: Approved for spec review

## Goal

Build a complete 10-12 minute demo for the DataHub June 25, 2026 online town hall.

The core message is:

> mem9 pulls DataHub context to enrich what an agent remembers.

The demo should show how PR #341 lets mem9 return normal long-term memory and DataHub-derived external context together at recall time. It should be reliable enough for a live town hall, recordable as a promo clip, and technical enough to show the actual `external_context` payload shape.

## Current State

PR #341, `Add DataHub MCP recall context`, is open against `mem9-ai/mem9`.

The active local branch is `codex/datahub-mcp-context`, tracking `King-Dylan/mem9:codex/datahub-mcp-context`. Because the PR is not merged, demo work should stay on this branch or another branch based on it.

The PR adds a read-only DataHub MCP external context provider in `server/internal/service/datahub_context.go`. The provider calls DataHub MCP tools:

- `search`
- `get_entities`
- `get_lineage`

The handler in `server/internal/handler/memory.go` attaches optional `external_context` to `GET /v1alpha2/mem9s/memories?q=...` responses. The request can force or suppress retrieval with `include_datahub` or `include_external_context`.

The sibling `mem9-node` repository is not present in this workspace. This demo should not depend on dashboard backend code from `mem9-node`.

## Audience

The audience is DataHub's town hall attendees. The demo should be accessible to DevRel, product, and engineering viewers.

The primary presenter should be able to say, in one sentence:

> DataHub remains the source of truth for data assets and lineage. mem9 remains the source of truth for agent memory. At recall time, the agent can use both.

## Story

Use one realistic synthetic incident:

> "Why is the Executive Revenue dashboard wrong today?"

The agent is investigating a high-priority revenue dashboard. With mem9 alone, the agent remembers team history and preferences. With DataHub context attached, the agent also sees the current data-asset graph and can propose a concrete investigation path.

### mem9 memory fixtures

Seed remembered context such as:

- Finance Analytics treats `Executive Revenue` as executive-facing and high priority.
- Last month a delayed Snowflake load caused stale dashboard numbers.
- The team prefers checking freshness and lineage before rewriting SQL.
- Owner handoff should include impacted assets and likely upstream cause.

### DataHub context fixtures

Use DataHub-shaped synthetic catalog entries:

- Dashboard: `Executive Revenue`
  - type: `DASHBOARD`
  - owner: `Finance Analytics`
  - link: demo DataHub URL
- Certified dataset: `mart.revenue`
  - type: `DATASET`
  - owner/freshness/quality metadata
  - freshness check failed after an upstream delay
- Upstream lineage:
  - `raw.orders`
  - optional `stripe.payments`
- Downstream lineage:
  - `Executive Revenue`

The enriched answer should clearly improve over mem9-only recall: it should combine remembered team context with the current lineage path `raw.orders -> mart.revenue -> Executive Revenue`.

## Options Considered

### Option A: Live story plus recorded fallback

Run a credible live flow and keep screenshots/raw JSON for fallback.

Pros:

- Best fit for a 10-12 minute town hall spotlight.
- Shows the product boundary clearly.
- Lets the audience see the actual enriched recall shape.

Cons:

- Requires a demo harness and fallback path.

### Option B: Polished promo clip only

Record a polished video and avoid live execution.

Pros:

- Lowest presentation risk.
- Good for later promo reuse.

Cons:

- Less convincing as an integration proof.
- Harder for technical viewers to inspect payloads.

### Option C: Technical proof only

Focus on MCP initialization, tool calls, handler behavior, and raw payloads.

Pros:

- Strong engineering credibility.
- Closest to the PR implementation.

Cons:

- Too code-heavy for the town hall format.
- Weaker product story.

## Decision

Choose Option A.

Build a browser demo surface plus raw JSON output. The default mode should be self-contained and reliable, backed by a local fixture DataHub MCP server. The same harness should support server-backed and live DataHub modes through configuration.

## Architecture

Add a focused demo package under `demos/datahub-context/`.

The demo should have three layers:

1. Demo browser surface and helper scripts
   - Presents the story.
   - Runs mem9-only and DataHub-enriched flows.
   - Shows the aggregated answer and raw JSON.
2. mem9 PR #341 recall API
   - Server-backed mode calls `GET /v1alpha2/mem9s/memories?q=...`.
   - The response includes normal `memories` plus optional `external_context`.
3. DataHub MCP provider
   - Fixture mode runs a local DataHub MCP-compatible server.
   - Live mode points `MNEMO_DATAHUB_MCP_URL` at a real DataHub MCP endpoint.

Production server code should not be reshaped for the demo. The demo package should wrap and showcase the PR behavior.

## Runtime Modes

### Fixture mode

Fixture mode is the default. It should work without external credentials or a live DataHub instance.

It should provide:

- local DataHub MCP fixture responses
- sample mem9 memories
- raw enriched response JSON
- demo browser surface
- screenshots or saved fallback output

This mode is the town hall safety net.

### Server-backed mode

Server-backed mode uses a running mem9 server from the PR branch.

Expected configuration:

- `MEM9_DEMO_BASE_URL`
- `MEM9_DEMO_API_KEY`
- `MEM9_DEMO_AGENT_ID`
- `MNEMO_DATAHUB_MCP_ENABLED=true`
- `MNEMO_DATAHUB_MCP_URL` pointing to the fixture MCP server or live DataHub MCP

The demo should be able to run a before/after comparison:

- `include_datahub=false`
- `include_datahub=true`

The enriched response should include `external_context`.

### Live DataHub mode

Live DataHub mode is optional. It should use the same demo surface and server-backed path, but point at a real DataHub MCP endpoint if DataHub provides one.

If live credentials or catalog data are not ready, the demo should stay in fixture mode.

## Demo Surface

The primary surface should be a small browser demo, not only a terminal script.

Layout:

- left panel: prompt and run controls
- middle panel: aggregated context
  - mem9 memories
  - DataHub context
- right panel: agent output
- raw JSON panel for the `external_context` response

The first-screen workflow should make the contrast obvious:

1. Run without DataHub.
2. Show mem9-only remembered context.
3. Run with DataHub.
4. Show memory plus DataHub context.
5. Show the improved agent answer.

The UI should be quiet and work-focused. It should look like an investigation console, not a marketing landing page.

## Talk Track

Suggested timing:

- 0:00-1:00: Problem setup
  - Agents often remember prior work or query the data catalog, but not both in one recall moment.
- 1:00-3:00: mem9-only recall
  - The agent remembers prior revenue dashboard incidents and team preferences.
- 3:00-6:00: DataHub-enriched recall
  - mem9 calls DataHub MCP and attaches `external_context`.
  - Show dashboard, dataset, owner/freshness context, and lineage.
- 6:00-9:00: Aggregated agent answer
  - The agent combines history and current asset graph into a concrete diagnosis path.
- 9:00-11:00: Architecture boundary
  - DataHub stays source of truth for data assets.
  - mem9 stays source of truth for agent memory.
  - No DataHub copy into mem9 is required.
- 11:00-12:00: Next step
  - Future optional publish path from curated mem9 observations back to DataHub.

## Error Handling

The demo should degrade gracefully:

- If the mem9 server is unavailable, use fixture mode and label it clearly.
- If DataHub MCP fails, show the mem9-only result and an "external context unavailable" state.
- If live DataHub credentials are absent, keep fixture mode active.
- If browser demo fails, use saved raw JSON and screenshots.

The demo should avoid silent failures. Every fallback state should make the missing dependency visible.

## Testing

Minimum verification before presenting:

- Fixture MCP smoke test starts and serves `search`, `get_entities`, and `get_lineage` responses.
- Demo smoke test proves the mem9-only answer differs from the enriched answer.
- Enriched output includes `external_context` items for:
  - dashboard
  - dataset
  - upstream lineage
  - downstream lineage
- Browser smoke test verifies the demo page renders non-empty and text does not overlap.
- Raw JSON fixture validates as JSON.
- Existing PR validation remains available:
  - targeted DataHub MCP Go tests
  - handler tests covering `external_context`
  - `make test` when feasible

## Out Of Scope

This demo will not:

- Build a permanent dashboard product feature.
- Require `mem9-node`.
- Publish mem9 observations back into DataHub.
- Store DataHub catalog data inside mem9.
- Depend on a live DataHub endpoint for the main town hall path.
- Change PR #341 production behavior unless implementation finds a demo-blocking bug.

## Approved Direction

Build the demo as a reliable browser plus JSON experience:

- self-contained fixture DataHub MCP first
- optional server-backed PR #341 mode
- optional live DataHub endpoint mode
- revenue dashboard incident story
- explicit before/after contrast between mem9-only and DataHub-enriched recall
