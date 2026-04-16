---
name: mem9-setup
description: |
  Set up mem9 persistent memory for Hermes Agent.
  Triggers: "set up mem9", "configure mem9", "install mem9 plugin",
  "enable memory", "configure memory plugin".
version: 0.1.0
---

# mem9 Setup for Hermes Agent

**Persistent cloud memory for Hermes.** This skill helps you configure mem9 memory integration.

## Step 1: Install the mem9 plugin

```bash
# Option A: Install from PyPI
pip install mem9-hermes

# Option B: Install from source (if in mem9 repo)
cd mem9/hermes-plugin
pip install -e .
```

## Step 2: Get your API key

You need a mem9 tenant API key. If you have a mem9 server:

```bash
# Auto-provision a new tenant
curl -s -X POST https://api.mem9.ai/v1alpha1/mem9s | python -m json.tool
# → { "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", ... }
```

Save the returned `id` - this is your API key.

## Step 3: Configure environment variables

Add to your `~/.hermes/.env` file:

```bash
export MEM9_API_KEY="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
export MEM9_API_URL="https://api.mem9.ai"  # optional, default is this
export MEM9_AGENT_ID="hermes"  # optional
```

Or set directly in your shell:

```bash
export MEM9_API_KEY="your-api-key-here"
```

## Step 4: Enable the mem9 toolset

```bash
hermes tools enable mem9
```

Verify it's enabled:

```bash
hermes tools list
# Should show mem9 toolset as enabled
```

## Step 5: Test the integration

Start a new Hermes session and try:

```
Store this memory: "The project uses TiDB"
Tags: database, infrastructure
```

Then search:

```
Search for memories about "database"
```

## Verification

After setup, test memory persistence:

1. Store a memory: "Remember that the API uses rate limiting of 100 req/min"
2. Start a new session: `/new`
3. Ask: "What do you know about the API rate limiting?"

The agent should recall the information from memory.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `MEM9_API_KEY not configured` | Set the environment variable in `~/.hermes/.env` |
| `Tool mem9 not found` | Run `hermes tools enable mem9` and `/reset` |
| `Connection refused` | Check `MEM9_API_URL` is correct |
| `Memory not persisted` | Verify API key is valid and server is running |

## Uninstall

```bash
pip uninstall mem9-hermes
hermes tools disable mem9
```
