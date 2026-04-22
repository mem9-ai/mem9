# Mem9 for Codex

mem9 adds persistent memory to Codex.

After setup, it does two things automatically:

- recalls relevant memories before each user prompt
- saves a recent `user` / `assistant` window when Codex stops

The current skill surface is:

- `$mem9:setup`
- `$mem9:cleanup`
- `$mem9:recall`
- `$mem9:store`

`$mem9:setup` is the configuration entrypoint. It inspects the current state first, manages shared profiles in `$MEM9_HOME/.credentials.json`, then applies either global or project scope.
The plugin is user-installed. The hooks are global. Per-project differences live in a local override file created through setup scope commands.
The managed hook commands stay fixed after setup. Plugin updates reuse those same entrypoints.

## Quick Start

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

6. When you want to remove mem9-managed Codex files before reinstalling, resetting, or uninstalling, run:

   ```text
   $mem9:cleanup
   ```

`$mem9:setup` inspects the saved global profiles first, then enables `codex_hooks` and installs the managed hooks with the path you choose. You do not need to enable hooks manually first.

## Requirements

- Codex CLI `0.122.0` or newer
- A Codex App build with plugin and hook support
- Node.js 22 or newer
- Network access to the mem9 server API

## Install

### Marketplace install

```bash
codex plugin marketplace add mem9-ai/mem9
```

Then install `mem9` from the `mem9-ai` marketplace inside Codex and run `$mem9:setup`.

### Local checkout testing

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
6. Verify the plugin package from the repo root:

   ```bash
   pnpm --dir codex-plugin test
   pnpm --dir codex-plugin typecheck
   ```

## Commands

### `$mem9:setup`

Global bootstrap for mem9 in Codex.

The setup skill drives a small script subcommand model under the hood:

- `setup.mjs inspect` reports runtime, plugin, global config, project config, and profile state
- `setup.mjs profile create` creates or repairs a global profile and can provision a mem9 API key
- `setup.mjs profile save-key` stores a provided API key in a global profile
- `setup.mjs scope apply --scope user|project` writes config and installs or repairs the managed hooks
- `setup.mjs scope clear --scope project` removes the repo-local override and returns that repository to the global default

Common examples for the script layer:

```bash
node ./skills/setup/scripts/setup.mjs inspect
node ./skills/setup/scripts/setup.mjs profile create --profile work --label Work --base-url https://api.mem9.ai --provision-api-key
node ./skills/setup/scripts/setup.mjs profile save-key --profile work --label Work --base-url https://api.mem9.ai --api-key-env MEM9_API_KEY
node ./skills/setup/scripts/setup.mjs scope apply --scope user --profile work --default-timeout-ms 8000 --search-timeout-ms 15000
node ./skills/setup/scripts/setup.mjs scope apply --scope project --profile work --default-timeout-ms 8000 --search-timeout-ms 15000
node ./skills/setup/scripts/setup.mjs scope clear --scope project
```

What it does:

1. checks `Node.js >= 22`
2. inspects the saved profiles in `$MEM9_HOME/.credentials.json`
3. asks whether to use an existing global profile, create a new mem9 API key, or handle credentials manually
4. creates or repairs global profiles in `$MEM9_HOME/.credentials.json`
5. writes the global default config
6. enables `codex_hooks`
7. installs or repairs the managed hooks in `$CODEX_HOME/hooks.json`
8. installs stable hook shims in `$CODEX_HOME/mem9/hooks/`
9. writes install metadata to `$CODEX_HOME/mem9/install.json`
10. removes old mem9-managed project hooks from the current repository, when setup runs inside a Git repository

First-run setup supports two paths:

- `create-new` provisions a fresh mem9 API key and writes it into the selected global profile
- `use-existing` reuses a saved global profile and its API key
- `manual` prints how to add a profile in `$MEM9_HOME/.credentials.json`, then you rerun setup and choose `use-existing`

Inside Codex, setup does not ask for API keys through the TUI.

### `$mem9:cleanup`

Cleanup for the mem9-managed Codex files.

The cleanup skill also uses an inspect-first script workflow:

```bash
node ./skills/cleanup/scripts/cleanup.mjs inspect
node ./skills/cleanup/scripts/cleanup.mjs run
node ./skills/cleanup/scripts/cleanup.mjs run --include-project
```

What it does:

- `inspect` emits machine-readable JSON with sanitized paths and the current removable targets
- `run` removes mem9-managed entries from `$CODEX_HOME/hooks.json`
- `run` removes `$CODEX_HOME/mem9/hooks/`
- `run` removes `$CODEX_HOME/mem9/install.json`
- `run` removes `$CODEX_HOME/mem9/config.json`
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

## Where Mem9 Stores Data

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

## Config Format

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
  "enabled": true,
  "profileId": "default",
  "defaultTimeoutMs": 8000,
  "searchTimeoutMs": 15000
}
```

Project override example:

```json
{
  "schemaVersion": 1,
  "profileId": "work"
}
```

## Runtime Overrides

Runtime can still override request settings with environment variables:

- `MEM9_API_URL`
- `MEM9_API_KEY`
- `MEM9_HOME`

## Debug Logging

Set this before starting Codex:

```bash
export MEM9_DEBUG=1
```

By default the Codex plugin writes JSONL logs here:

```text
$CODEX_HOME/mem9/logs/codex-hooks.jsonl
```

You can override the file path with `MEM9_DEBUG_LOG_FILE`.

## Troubleshooting

- If `SessionStart` says mem9 is not configured, run `$mem9:setup`.
- If a repository needs a different profile, timeout, or a cleared local override, rerun `$mem9:setup` in that repository and apply or clear project scope.
- If you want to remove the managed Codex files before reinstalling or resetting mem9, run `$mem9:cleanup`.
- If the selected profile is missing, run `$mem9:setup` to create or repair global profiles.
- If the selected profile is missing an API key, run `$mem9:setup` and choose `create-new`, or add the profile manually in `$MEM9_HOME/.credentials.json` and rerun setup with `--use-existing`.
- If setup repairs malformed JSON files, it keeps sibling `.bak` copies before rewriting them.
- If you installed an older prerelease that still points hooks at `$CODEX_HOME/mem9/runtime/`, run `$mem9:setup` once after upgrading.
