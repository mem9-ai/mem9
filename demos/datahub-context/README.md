# DataHub Context Demo

This package is a self-contained town hall demo for PR #341: mem9 recall can return normal long-term memories plus read-only DataHub MCP context in the same response.

## Quick Start

```bash
cd demos/datahub-context
npm run doctor
npm run dev
```

Open `http://127.0.0.1:4179`.

Without `MEM9_DEMO_API_KEY`, the demo runs from fixtures. With a configured mem9 server, it proxies the real `/v1alpha2/mem9s/memories` recall API.

## Server-Backed Mode

```bash
export MEM9_DEMO_BASE_URL="http://127.0.0.1:8080"
export MEM9_DEMO_API_KEY="<demo-space-api-key>"
export MEM9_DEMO_AGENT_ID="slack-datahub-demo"
export MEM9_DEMO_APP_ID="datahub-townhall-slack"

npm run reset-seed
npm run doctor
npm run dev
```

For DataHub-enriched recall in local-only development, start the fixture MCP server before starting mem9:

```bash
cd demos/datahub-context
npm run mcp -- --port 8787
```

Then run `mnemo-server` with:

```bash
MNEMO_DATAHUB_MCP_ENABLED=true
MNEMO_DATAHUB_MCP_URL=http://127.0.0.1:8787
MNEMO_DATAHUB_MCP_MAX_RESULTS=5
```

For the real EC2 demo path, point `MNEMO_DATAHUB_MCP_URL` at the live DataHub tenant MCP endpoint and set `MNEMO_DATAHUB_MCP_TOKEN` instead of starting the fixture server.

## Scripts

- `npm run mcp` starts a local DataHub MCP-compatible fixture server for local development only.
- `npm run reset-seed` deletes existing demo-tagged memories for the demo agent and recreates the canonical Slack memories.
- `npm run doctor` validates fixtures and optionally checks a configured mem9 server.
- `npm run dev` starts the browser evidence panel.
- `npm run smoke` checks the fixture page plus fixture recall payload.
- `npm run smoke:server` requires `MEM9_DEMO_API_KEY` and verifies the browser panel stays server-backed with live `external_context`.
