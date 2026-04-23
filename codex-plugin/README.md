# Codex Plugin for mem9

Persistent memory for Codex.

After setup, it does two things automatically:

- recalls relevant memories before each user prompt
- saves a recent `user` / `assistant` window when Codex stops

The plugin exposes:

- `$mem9:setup`
- `$mem9:cleanup`
- `$mem9:recall`
- `$mem9:store`

`$mem9:setup` is the main entrypoint. It manages shared profiles in `$MEM9_HOME/.credentials.json`, applies either global or project scope, and repairs the managed Codex hooks when needed.

## Requirements

- Codex CLI `0.122.0` or newer
- A Codex App build with plugin and hook support
- Node.js 22 or newer
- Network access to the mem9 server API

## Install and First-Time Setup

1. Add the marketplace:

```bash
codex plugin marketplace add mem9-ai/mem9
```

2. Install `mem9` from the `mem9-ai` marketplace inside Codex.
3. Run:

   ```text
   $mem9:setup
   ```

4. If one repository needs a different profile or timeout, rerun `$mem9:setup` in that repository and apply project scope.
5. When you want an on-demand recall or an explicit store, run:

   ```text
   $mem9:recall
   $mem9:store
   ```

You do not need to enable hooks manually first. `$mem9:setup` inspects the saved profiles, enables `codex_hooks`, and installs the managed hooks.

## Daily Commands

### `$mem9:setup`

Single entrypoint for mem9 setup in Codex.

What it does:

- inspects the current runtime, profiles, and scope config
- lets you create a new mem9 API key or reuse an existing global profile
- applies either user scope or project scope
- repairs `codex_hooks`, `$CODEX_HOME/hooks.json`, and the managed hook shims
- keeps API key entry out of the Codex TUI

Project scope keeps profile and timeout overrides.
User scope also owns `updateCheck.enabled` and `updateCheck.intervalHours`.

### `$mem9:cleanup`

Cleanup for the mem9-managed Codex files.

What it does:

- `inspect` emits machine-readable JSON with sanitized paths and the current removable targets
- `run` removes mem9-managed entries from `$CODEX_HOME/hooks.json`
- `run` removes `$CODEX_HOME/mem9/hooks/`
- `run` removes `$CODEX_HOME/mem9/install.json`
- `run` removes `$CODEX_HOME/mem9/config.json`
- `run` removes `$CODEX_HOME/mem9/state.json`
- `run --include-project` also removes `<project>/.codex/mem9/config.json`

What it does not do:

- it keeps `$MEM9_HOME/.credentials.json`
- it keeps `$CODEX_HOME/config.toml`
- it keeps `$CODEX_HOME/mem9/logs/codex-hooks.jsonl`

### `$mem9:recall`

Manual memory lookup for the current request.

What it does:

- uses the current effective profile
- respects project override config when present
- searches `/v1alpha2/mem9s/memories` with `agent_id=codex`
- uses `searchTimeoutMs`

### `$mem9:store`

Manual memory store for one user-approved fact, preference, or instruction.

What it does:

- uses the current effective profile
- respects project override config when present
- stores one `content` entry with synchronous confirmation
- uses `defaultTimeoutMs`

## Upgrade

Upgrade the Git marketplace entry, then restart Codex:

```bash
codex plugin marketplace upgrade mem9-ai
```

This updates the installed mem9 plugin for normal releases.
Migration releases surface a `SessionStart` notice that asks for `$mem9:setup` once.

## Uninstall / Reset

Follow this order:

1. Enter Codex and run `$mem9:cleanup`.
2. In Codex, open `/plugins`, search for `mem9`, and uninstall the plugin.
3. After step 2 succeeds, exit Codex and run:

   ```bash
   codex plugin marketplace remove mem9-ai
   ```

This order keeps mem9-managed hooks and plugin state in sync while you remove the integration.
This uninstall flow keeps `$MEM9_HOME/.credentials.json`.
If you want a full removal, delete `$MEM9_HOME/.credentials.json` after the uninstall steps finish.

## Local Development / Testing

This repository also ships a repo-local marketplace manifest at:

```text
<repo>/.agents/plugins/marketplace.json
```

For local testing:

1. Clone this repository.
2. Open Codex with the repository root as the working directory. Codex discovers the repo-local marketplace from `<repo>/.agents/plugins/marketplace.json`.
3. Install `mem9` from the repo-local marketplace Codex discovers for this checkout.
4. Run `$mem9:setup`.
5. Restart Codex after plugin or marketplace changes.
6. Reinstall `mem9` from the repo-local marketplace when Codex still shows the older package after restart.
7. Verify the plugin package from the repo root:

   ```bash
   pnpm --dir codex-plugin test
   pnpm --dir codex-plugin typecheck
   ```

For script-level help during development:

```bash
node ./skills/setup/scripts/setup.mjs --help
node ./skills/setup/scripts/setup.mjs profile save-key --help
node ./skills/cleanup/scripts/cleanup.mjs --help
node ./skills/cleanup/scripts/cleanup.mjs run --help
```

## Debugging

Set this before starting Codex:

```bash
export MEM9_DEBUG=1
```

By default the Codex plugin writes JSONL logs here:

```text
$CODEX_HOME/mem9/logs/codex-hooks.jsonl
```

You can override the file path with `MEM9_DEBUG_LOG_FILE`.

Common issues:

- If `SessionStart` says mem9 is not configured, run `$mem9:setup`.
- If a repository needs a different profile, timeout, or a cleared local override, rerun `$mem9:setup` in that repository and apply or clear project scope.
- If you want to remove the managed Codex files before reinstalling or resetting mem9, run `$mem9:cleanup`.
- If the selected profile is missing, run `$mem9:setup` to create or repair global profiles.
- If the selected profile is missing an API key, run `$mem9:setup` and choose `create-new`, or add the profile manually in `$MEM9_HOME/.credentials.json` and rerun `$mem9:setup`, then choose `use-existing`.
- If setup repairs malformed JSON files, it keeps sibling `.bak` copies before rewriting them.
- If you installed an older prerelease that still points hooks at `$CODEX_HOME/mem9/runtime/`, run `$mem9:setup` once after upgrading.

## Reference: Files, Config, Environment

### File Layout

Global Codex integration:

```text
$CODEX_HOME/hooks.json
$CODEX_HOME/config.toml
```

Global mem9 runtime and config:

```text
$CODEX_HOME/mem9/hooks/
$CODEX_HOME/mem9/install.json
$CODEX_HOME/mem9/config.json
$CODEX_HOME/mem9/state.json
$CODEX_HOME/mem9/logs/codex-hooks.jsonl
```

Project override written by `scope apply --scope project`:

```text
<project>/.codex/mem9/config.json
```

Shared credentials:

```text
$MEM9_HOME/.credentials.json
```

`MEM9_HOME` defaults to `$HOME/.mem9`.

### Config Files

Credentials file:

```json
{
  "schemaVersion": 1,
  "profiles": {
    "default": {
      "label": "Personal",
      "baseUrl": "https://api.mem9.ai",
      "apiKey": "..."
    }
  }
}
```

Global default config:

```json
{
  "schemaVersion": 1,
  "profileId": "default",
  "defaultTimeoutMs": 8000,
  "searchTimeoutMs": 15000,
  "updateCheck": {
    "enabled": true,
    "intervalHours": 24
  }
}
```

Project override example:

```json
{
  "schemaVersion": 1,
  "profileId": "work"
}
```

Remote update-check settings stay in the global config.

### Runtime Overrides

Runtime can still override request settings with environment variables:

- `MEM9_API_URL`
- `MEM9_API_KEY`
- `MEM9_HOME`
