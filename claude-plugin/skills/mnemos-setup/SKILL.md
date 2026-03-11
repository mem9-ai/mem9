---
name: mnemos-setup
description: "Setup Mem9 persistent memory. Triggers: set up mem9, install mem9, configure memory."
context: fork
allowed-tools: Bash
---

# Mem9 Setup for Claude Code

**Persistent cloud memory for Claude Code.**

## Setup Steps

### Step 1: Provision a tenant

```bash
curl -s -X POST https://api.mem9.ai/v1alpha1/mem9s | jq .
# → { "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", "claim_url": "..." }
```

Save the returned `id` — this is your `MEM9_TENANT_ID`.

### Step 2: Configure tenant ID

Add to `~/.claude/settings.json`:

```json
{
  "env": {
    "MEM9_TENANT_ID": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  }
}
```

### Step 3: Install plugin

Tell the user to run in Claude Code:
```
/plugin marketplace add mem9-ai/mem9
/plugin install mem9@mem9
```

### Step 4: Restart Claude Code

Tell the user to restart Claude Code to activate the plugin.

## Verification

After setup, suggest testing:
1. "Remember that this project uses React 18"
2. Start a new session
3. "What UI framework does this project use?"

The agent should recall from memory.
