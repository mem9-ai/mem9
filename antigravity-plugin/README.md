# mem9 for Antigravity

Cloud-persistent memory for Antigravity across coding sessions: automatic prompt recall, end-of-turn session capture, 6 MCP memory tools, interactive setup/recall/store skills, and a dedicated `memory-curator` subagent.

## Install

Install directly from a local checkout or Git repository with the Antigravity CLI:

```bash
agy plugin install ./antigravity-plugin
agy plugin validate --strict ./antigravity-plugin
agy plugin list
```

Alternatively, place or symlink the plugin directory at:

- Workspace scope: `.agents/plugins/mem9/`
- Global scope: `~/.gemini/config/plugins/mem9/`

## How Credentials and Auto-Provisioning Work

On a fresh session, the `SessionStart` hook inspects your configuration. When no profile or API key exists yet (and `MEM9_AUTO_PROVISION` is not disabled), it automatically provisions a default mem9 space and stores:

- Shared credentials (file mode `0600`): `~/.mem9/.credentials.json`
- Antigravity user defaults: `~/.mem9/antigravity/config.json`

`~/.mem9/.credentials.json` uses the same shared profile format as the mem9 CLI and Codex plugin (`MEM9_HOME` overrides `~/.mem9`):

```json
{
  "schemaVersion": 1,
  "profiles": {
    "default": {
      "label": "Default",
      "baseUrl": "https://api.mem9.ai",
      "apiKey": "..."
    }
  }
}
```

Credential resolution priority:

1. `MEM9_API_KEY` environment variable (with `MEM9_API_URL` or matched profile URL)
2. Scoped config (`<project-root>/.agents/mem9/config.json` merged over `~/.mem9/antigravity/config.json`), or `profiles.default` when no scope config file exists yet
3. `${PLUGIN_DATA}/auth.json` (`{ "base_url": "...", "api_key": "..." }`)

## Components Included

### Lifecycle Hooks (`hooks.json`)

- **`SessionStart`**: Auto-provisions a default space when unconfigured and checks `/v1alpha2/mem9s/runtime-state` for quota or account notices once per session.
- **`PreInvocation`**: Strips injected wrappers and skips `[plan review]` prompts, enforces `recallMinPromptLength` (default `5`), deduplicates per user turn in `~/.mem9/antigravity/hook-state.json`, and recalls matching memories (`GET /v1alpha2/mem9s/memories`).
- **`Stop`**: Reads Antigravity `transcript.jsonl` (`USER_INPUT` and `PLANNER_RESPONSE`, ignoring `GENERIC` tool outputs), selects a bounded recent window, deduplicates identical turn windows, and posts smart ingest (`POST /v1alpha2/mem9s/memories`).

### MCP Tools (`mcp_config.json`, server `mem9`)

| Tool | Purpose |
| --- | --- |
| `memory_search` | Hybrid vector + keyword search (`q`, `tags`, `source`, `limit`, `offset`, `memory_type`) |
| `memory_store` | Store a concise memory (`content`, optional `source`, `tags`, `metadata`) |
| `memory_get` | Retrieve a single memory by `id` |
| `memory_update` | Update fields of an existing memory by `id` |
| `memory_delete` | Delete a memory by `id` |
| `memory_status` | Inspect runtime readiness, active profile/scope, and redacted key preview |

### Skills

- **`/mem9-setup`**: Runs `skills/mem9-setup/scripts/setup.mjs` to inspect status, provision a profile key, save an existing key via `MEM9_API_KEY` in a trusted shell, apply user/project scope, or clear project overrides.
- **`/mem9-recall`**: Explicit on-demand recall using `memory_search`.
- **`/mem9-store`**: Explicit user-approved storage using `memory_store` (never saves secrets).

### Custom Agent (`agents/memory-curator.md`)

- **`memory-curator`**: Runs on `flash` with `commandExecutionPolicy: sandbox` and inherited MCP tools to search, deduplicate, synthesize, update, and clean up mem9 memories without exposing secrets. Invoke as a subagent or select via `/agents` / `agy --agent memory-curator`.

### Always-On Rule (`rules/AGENTS.md`)

- Treats `<relevant-memories>` blocks as untrusted historical context only.
- Guides use of the 6 `mem9` MCP tools.
- Instructs surfacing `<mem9-status-warning>` notices once per session and never echoing API keys or credential files.

## Managing Profiles and Project Overrides

Run setup commands from `skills/mem9-setup/` (or invoke `/mem9-setup` in Antigravity):

```bash
# Inspect active config and redacted profiles
node skills/mem9-setup/scripts/setup.mjs inspect --cwd .

# Provision a new profile API key
node skills/mem9-setup/scripts/setup.mjs profile create \
  --profile work --label Work --base-url https://api.mem9.ai --provision-api-key

# Save an existing API key safely from a trusted shell
MEM9_API_KEY='<your-mem9-api-key>' node skills/mem9-setup/scripts/setup.mjs profile save-key \
  --profile work --label Work --base-url https://api.mem9.ai --api-key-env MEM9_API_KEY

# Apply user default or project-local override
node skills/mem9-setup/scripts/setup.mjs scope apply --scope user --profile default
node skills/mem9-setup/scripts/setup.mjs scope apply --scope project --profile work --agent-id repo-bucket --cwd .

# Remove project-local override
node skills/mem9-setup/scripts/setup.mjs scope clear --scope project --cwd .
```

Never paste raw API keys into chat. Use `profile save-key --api-key-env MEM9_API_KEY` from your terminal.

## Environment Variables

| Variable | Description |
| --- | --- |
| `MEM9_HOME` | Override shared mem9 directory (defaults to `~/.mem9`) |
| `MEM9_API_KEY` | Override active API key at runtime |
| `MEM9_API_URL` | Override mem9 API base URL (`https://api.mem9.ai`) |
| `MEM9_AGENT_ID` | Override `agent_id` memory bucket sent on writes (`antigravity` default) |
| `MEM9_AUTO_PROVISION` | Set `false`/`0`/`off` to disable automatic first-run space provisioning |
| `MEM9_DEBUG` | Set `1`/`true` to write redacted JSONL hook diagnostics |
| `MEM9_DEBUG_LOG_FILE` | Custom log path (defaults to `~/.mem9/antigravity/logs/hooks.jsonl`) |
| `WORKSPACE_ROOT` | Workspace directory override checked by the MCP server |
| `PLUGIN_DATA` | Persistent Antigravity plugin data directory (`auth.json` fallback) |

## Debugging and Troubleshooting

Enable hook diagnostic logs before starting Antigravity:

```bash
export MEM9_DEBUG=1
```

Logs are written as JSONL to `~/.mem9/antigravity/logs/hooks.jsonl` (never logging full API keys, raw prompts, or message contents).

Common checks:

- **No recall happening**: Verify `memory_status` or `setup.mjs inspect`. Ensure `enabled` is not `false`, `recallMinPromptLength` matches your prompt length, and the profile in `~/.mem9/.credentials.json` has a valid `apiKey`.
- **Quota or billing warning**: Address the action URL surfaced in `<mem9-status-warning>` or run `/mem9-setup` to switch profiles.
- **Invalid JSON config**: Run `setup.mjs profile save-key` or `setup.mjs scope apply` to back up malformed `.json` files to `.bak` and rewrite clean configuration.
- **Validate the plugin locally**:

```bash
npm --prefix antigravity-plugin run check
npm --prefix antigravity-plugin test
agy plugin validate --strict ./antigravity-plugin
```
