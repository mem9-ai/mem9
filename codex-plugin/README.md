# Mem9 for Codex

mem9 adds persistent memory to Codex.

After setup, it does two things automatically:

- recalls relevant memories before each user prompt
- saves a recent `user` / `assistant` window when Codex stops

The plugin is user-installed. The hooks are global. Per-project differences live in a local override file.

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

4. If one repository needs a different profile or timeout, run:

   ```text
   $mem9:project-config
   ```

`$mem9:setup` enables `codex_hooks` and installs the managed hooks. You do not need to enable hooks manually first.

## Requirements

- Codex CLI `0.122.0` or newer
- A Codex App build with plugin and hook support
- Node.js 22 or newer
- Network access to the mem9 API
- A mem9 API key

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
2. Open Codex with the repository root as the working directory.
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

Common examples:

```text
$mem9:setup
$mem9:setup --profile work
$mem9:setup --profile work --api-key <key>
```

What it does:

1. checks `Node.js >= 22`
2. creates or repairs global profiles in `$MEM9_HOME/.credentials.json`
3. writes the global default config
4. enables `codex_hooks`
5. installs or repairs the managed hooks in `$CODEX_HOME/hooks.json`
6. installs runtime scripts in `$CODEX_HOME/mem9/runtime/`
7. removes old mem9-managed project hooks from the current repository, when setup runs inside a Git repository

### `$mem9:project-config`

Local override for the current Git repository.

Common examples:

```text
$mem9:project-config
$mem9:project-config --profile work
$mem9:project-config --disable
$mem9:project-config --reset
```

What it does:

- writes `<project>/.codex/mem9/config.json`
- switches the current project to an existing global `profileId`
- disables mem9 only for the current project
- removes the local override and goes back to the global default

What it does not do:

- it does not create profiles
- it does not store API keys in the project

## Where Mem9 Stores Data

Global hooks and feature flag:

```text
$CODEX_HOME/hooks.json
$CODEX_HOME/config.toml
```

Global default config:

```text
$CODEX_HOME/mem9/config.json
```

Project override:

```text
<project>/.codex/mem9/config.json
```

Shared credentials:

```text
$MEM9_HOME/.credentials.json
```

Runtime scripts:

```text
$CODEX_HOME/mem9/runtime/
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
- If a project is disabled, run `$mem9:project-config --reset` to inherit the global default again.
- If a project needs another profile, run `$mem9:project-config --profile <id>`.
- If the selected profile is missing, run `$mem9:setup` to create or repair global profiles.
- If the selected profile is missing an API key, run `$mem9:setup`, edit `$MEM9_HOME/.credentials.json`, or set `MEM9_API_KEY`.
- If setup repairs malformed JSON files, it keeps sibling `.bak` copies before rewriting them.
