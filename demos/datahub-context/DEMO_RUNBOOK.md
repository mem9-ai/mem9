# DataHub Town Hall Demo Runbook

Target slot: 10-12 minutes.

## Preflight

For the real EC2 demo path, use the live DataHub tenant. The local MCP fixture is only for offline or workstation-only rehearsals.

Local rehearsal:

```bash
cd /Users/dylanliu/AI_assistant/mem9/demos/datahub-context
npm run doctor
npm run mcp -- --port 8787
```

Start mem9 from the PR branch with DataHub MCP enabled against the local fixture:

```bash
cd /Users/dylanliu/AI_assistant/mem9
MNEMO_DATAHUB_MCP_ENABLED=true \
MNEMO_DATAHUB_MCP_URL=http://127.0.0.1:8787 \
MNEMO_DATAHUB_MCP_MAX_RESULTS=5 \
MNEMO_DSN="<demo-dsn>" \
make run
```

Real DataHub rehearsal:

```bash
cd /Users/dylanliu/AI_assistant/mem9/demos/datahub-context
npm run doctor

cd /Users/dylanliu/AI_assistant/mem9
MNEMO_DATAHUB_MCP_ENABLED=true \
MNEMO_DATAHUB_MCP_URL="https://<your-datahub-domain>/integrations/ai/mcp" \
MNEMO_DATAHUB_MCP_TOKEN="<datahub-access-token>" \
MNEMO_DATAHUB_MCP_MAX_RESULTS=5 \
MNEMO_DSN="<demo-dsn>" \
make run
```

Seed the demo space:

```bash
cd /Users/dylanliu/AI_assistant/mem9/demos/datahub-context
MEM9_DEMO_BASE_URL=http://127.0.0.1:8080 \
MEM9_DEMO_API_KEY="<demo-space-api-key>" \
npm run reset-seed

MEM9_DEMO_BASE_URL=http://127.0.0.1:8080 \
MEM9_DEMO_API_KEY="<demo-space-api-key>" \
npm run doctor
```

Open the panel:

```bash
MEM9_DEMO_BASE_URL=http://127.0.0.1:8080 \
MEM9_DEMO_API_KEY="<demo-space-api-key>" \
npm run dev
```

## Presenter Flow

0:00-1:00: Set the scene.

Say: "The Slack agent has one urgent question: why is the Executive Revenue dashboard wrong today?"

Slack input:

```text
/ask-data-agent Why is the Executive Revenue dashboard wrong today?
```

1:00-3:00: Run `mem9 only`.

Point at the mem9 memory lane: priority, previous freshness incident, and handoff preference are remembered. Say: "This is useful history, but it still cannot prove which data asset is stale."

3:00-6:00: Run `mem9 + DataHub`.

Point at the DataHub lane: `mart.revenue`, `Executive Revenue`, upstream lineage, downstream lineage. Say: "DataHub stays the source of truth for assets and lineage. mem9 attaches it at recall time instead of copying catalog state into memory."

6:00-9:00: Show the agent answer.

Say: "The answer now combines remembered team behavior with current catalog evidence: check `raw.orders` and `stripe.payments`, verify `mart.revenue` freshness, then hand off Finance Analytics with impacted assets."

9:00-11:00: Open `external_context JSON`.

Show the payload shape: normal `memories` plus `external_context`. Say: "The integration boundary is simple: the agent asks mem9 once and gets memory plus read-only DataHub context."

11:00-12:00: Close.

Say: "The next product step is optional publishing of curated observations back to DataHub. This demo is only the read path."

## Recovery

If the mem9 server fails, run fixture mode:

```bash
cd /Users/dylanliu/AI_assistant/mem9/demos/datahub-context
npm run dev
```

If DataHub MCP fails, keep the panel open and run `mem9 only`; the DataHub lane will show an unavailable state.

If the demo space has noisy history:

```bash
MEM9_DEMO_BASE_URL="<server-url>" \
MEM9_DEMO_API_KEY="<demo-space-api-key>" \
npm run reset-seed
```

## EC2 Deployment Notes

The current demo stack shape uses:

- repo roots under `/opt/mem9-datahub-demo-stack/`
- mem9 server env at `/opt/mem9-datahub-demo-stack/env/mem9-server.env`
- demo UI env at `/opt/mem9-datahub-demo-stack/mem9-datahub-demo/.env.local`
- Slack agent env at `/opt/mem9-datahub-demo-stack/mem9-datahub-demo/apps/slack-agent/.env`
- systemd units `mem9-demo-tidb`, `mem9-demo-server`, `mem9-demo-ui`, and `mem9-demo-slack-agent`
- `mem9-demo-datahub-mcp` is retired from the EC2 demo path and should stay disabled unless you explicitly want local fixture behavior on the host

Use the real EC2 host and SSH key from the deployment environment. Keep these commands as the shape of the operation, not as hard-coded production truth:

```bash
rsync -az --delete \
  --exclude .git \
  --exclude 'server/bin/' \
  /Users/dylanliu/AI_assistant/mem9/ \
  <ec2-host>:/opt/mem9-datahub-demo-stack/mem9/

ssh <ec2-host> 'cd /opt/mem9-datahub-demo-stack/mem9 && make build-linux'
ssh <ec2-host> 'sudo systemctl restart mem9-demo-server && sudo systemctl status --no-pager mem9-demo-server'
ssh <ec2-host> "cd /opt/mem9-datahub-demo-stack/mem9/demos/datahub-context && MEM9_DEMO_BASE_URL=http://127.0.0.1:8080 MEM9_DEMO_API_KEY=\"\$MEM9_DEMO_API_KEY\" npm run doctor"
```

Do not use this EC2 path unless it matches the actual host setup.
