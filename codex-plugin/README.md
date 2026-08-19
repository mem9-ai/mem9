# Codex Plugin for mem9

Persistent memory for [Codex](https://developers.openai.com/codex).

After setup, it does two things automatically:

- recalls relevant memories before each user prompt
- saves a recent `user` / `assistant` window when Codex stops

Automatic recall uses `recallMinPromptLength`, which defaults to `5`, after stripping already-injected memory context from the current prompt.

The plugin exposes:

- `$mem9:setup`
- `$mem9:cleanup`
- `$mem9:recall`
- `$mem9:store`

`$mem9:setup` is the main entrypoint. It manages shared profiles in the mem9 home and applies either global or project scope. Codex loads the lifecycle hooks directly from this plugin.

## Requirements

- A current Codex build with plugin-bundled hook support
- Node.js 22 or newer
- Network access to the mem9 server API

## Install and First-Time Setup

1. Add the marketplace:

```bash
codex plugin marketplace add mem9-ai/mem9
```

2. In Codex, run `/plugins`, search for `mem9`, open the `mem9-ai` marketplace entry, and choose `Install plugin`.
3. Restart Codex or open a fresh Codex session with the same `CODEX_HOME`. For normal installs, that is `$HOME/.codex`.
4. Run:

   ```text
   $mem9:setup
   ```

5. If one repository needs a different profile, timeout, or recall prompt-length threshold, see [Profiles and Project Scope](#profiles-and-project-scope).
6. When you want an on-demand recall or an explicit store, run:

   ```text
   $mem9:recall
   $mem9:store
   ```

You do not need to enable hooks manually first. Codex discovers `hooks/hooks.json` when the plugin is enabled. `$mem9:setup` does not modify `$CODEX_HOME/hooks.json` or the hook feature flags in `$CODEX_HOME/config.toml`.

## Where Files Are Stored

The Codex plugin uses two home directories:

| Variable | Default when unset | What lives there |
|---|---|---|
| `CODEX_HOME` | `~/.codex` on macOS/Linux | Codex user state, the installed plugin cache, and mem9 config/state files under `$CODEX_HOME/mem9/` |
| `MEM9_HOME` | `~/.mem9` on macOS/Linux | Shared mem9 credential profiles in `$MEM9_HOME/.credentials.json` |

Most macOS/Linux users can leave both variables unset. With the defaults, Codex integration files live under `~/.codex/`, and mem9 credentials live in `~/.mem9/.credentials.json`. In shell commands, `~` means the same home directory as `$HOME`.

The defaults are equivalent to starting Codex from a shell with:

```bash
export CODEX_HOME="$HOME/.codex"
export MEM9_HOME="$HOME/.mem9"
codex
```

On Windows PowerShell, the same defaults resolve under your user profile:

```powershell
$env:CODEX_HOME = "$env:USERPROFILE\.codex"
$env:MEM9_HOME = "$env:USERPROFILE\.mem9"
codex
```

Use the same `CODEX_HOME` and `MEM9_HOME` in trusted-shell commands that save or update profile keys. `$mem9:setup` keeps API key entry out of the Codex TUI and writes the key to `$MEM9_HOME/.credentials.json`.

## Profiles and Project Scope

Use `$mem9:setup` for profile setup. It creates or selects mem9 profiles, saves profile keys, and applies the selected profile globally or for the current repository.

### Set the default profile

1. Run `$mem9:setup`.
2. Choose `create-new` to create a mem9 API key, or choose `use-existing` to reuse a saved profile.
3. Choose `user scope`.

This selects the default profile Codex uses across repositories.

### Use a different profile in one repository

1. Open Codex from that repository.
2. Run `$mem9:setup`.
3. Choose `create-new` or `use-existing` for the repository profile.
4. Choose `project scope`.

Project scope can override:

- `profileId`
- `defaultTimeoutMs`
- `searchTimeoutMs`
- `recallMinPromptLength`

### Return a repository to the default profile

1. Open Codex from that repository.
2. Run `$mem9:setup`.
3. Choose `clear project scope`.

The repository will use the user-scope default profile again.

Use the same `CODEX_HOME` and `MEM9_HOME` when starting Codex and when saving profile keys from a trusted shell. With the defaults above, Codex reads integration files from `~/.codex` and mem9 reads shared profiles from `~/.mem9`.

### What setup writes

Manual edits are mainly for recovery or automation. The recommended path is still `$mem9:setup`.

Saved profiles are written to `$MEM9_HOME/.credentials.json`:

The keys under `profiles` are profile IDs. For example, `"profileId": "work"` selects the `profiles.work` entry.

```json
{
  "schemaVersion": 1,
  "profiles": {
    "default": {
      "label": "Personal",
      "baseUrl": "https://api.mem9.ai",
      "apiKey": "..."
    },
    "work": {
      "label": "Work",
      "baseUrl": "https://api.mem9.ai",
      "apiKey": "..."
    }
  }
}
```

The user-scope default is written to `$CODEX_HOME/mem9/config.json`.

A project override is written to `<project>/.codex/mem9/config.json`. It only needs the fields that differ from the user-scope default:

```json
{
  "schemaVersion": 1,
  "profileId": "work",
  "searchTimeoutMs": 15000,
  "recallMinPromptLength": 5
}
```

Remote update-check settings stay in user scope. Project scope only controls the active profile and request tuning for that repository.

`scope apply` also writes `$CODEX_HOME/mem9/install.json` so mem9 can identify the active marketplace installation for diagnostics and upgrade guidance. Hook definitions and hook scripts remain inside the installed plugin.

## Daily Commands

### `$mem9:setup`

Single entrypoint for mem9 setup in Codex.

What it does:

- inspects the current runtime, profiles, and scope config
- lets you create a new mem9 API key or reuse an existing global profile
- applies either user scope or project scope
- records install metadata for diagnostics and upgrade guidance
- leaves global Codex hook configuration untouched
- keeps API key entry out of the Codex TUI

Project scope keeps profile, timeout, and recall prompt-length overrides.
User scope also owns `updateCheck.enabled` and `updateCheck.intervalHours`.

### `$mem9:cleanup`

Cleanup for mem9 config/state files and hook artifacts left by older releases.

What it does:

- `inspect` emits machine-readable JSON with sanitized paths and the current removable targets
- `run` removes legacy mem9 hook entries from `$CODEX_HOME/hooks.json`, if present
- `run` removes the legacy `$CODEX_HOME/mem9/hooks/` shim directory, if present
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
- searches `/v1alpha2/mem9s/memories` with the current API key
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
When upgrading from a release that wrote mem9 hooks into `$CODEX_HOME/hooks.json`, run `$mem9:cleanup` once after the upgrade, then run `$mem9:setup` again. This removes the legacy global hook entries so only the plugin-bundled hooks remain active.

## Uninstall / Reset

Follow this order:

1. Enter Codex and run `$mem9:cleanup`.
2. In Codex, open `/plugins`, search for `mem9`, and uninstall the plugin.
3. After step 2 succeeds, exit Codex and run:

   ```bash
   codex plugin marketplace remove mem9-ai
   ```

This order removes mem9 state and any legacy mem9 hook entries before the plugin is removed.
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
3. In Codex, run `/plugins`, search for `mem9`, open the repo-local marketplace entry for this checkout, and choose `Install plugin`.
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

- If `$mem9:setup` returns `no matches` after installing from `/plugins`, restart Codex or open a fresh Codex session. Codex loads plugin skills when the session starts.
- If `inspect` reports `missing_install_metadata` before setup finishes, continue with `$mem9:setup`. `scope apply` writes `$CODEX_HOME/mem9/install.json`.
- If `SessionStart` says mem9 is not configured, run `$mem9:setup`.
- If a repository needs a different profile, timeout, recall prompt-length threshold, or a cleared local override, rerun `$mem9:setup` in that repository and apply or clear project scope.
- If you want to remove mem9 config/state before reinstalling or resetting mem9, run `$mem9:cleanup`.
- If the selected profile is missing, run `$mem9:setup` to create or repair global profiles.
- If the selected profile is missing an API key, run `$mem9:setup` and choose `create-new`, or add the profile manually in `$MEM9_HOME/.credentials.json` and rerun `$mem9:setup`, then choose `use-existing`.
- If setup repairs malformed JSON files, it keeps sibling `.bak` copies before rewriting them.
- If an older release left hook entries in `$CODEX_HOME/hooks.json` or shims under `$CODEX_HOME/mem9/hooks/`, run `$mem9:cleanup` once before re-running `$mem9:setup`.

## Reference: Files, Config, Environment

### File Layout

Runtime defaults:

```text
CODEX_HOME=~/.codex
MEM9_HOME=~/.mem9
```

Plugin-owned lifecycle hooks:

```text
<plugin-root>/hooks/hooks.json
<plugin-root>/hooks/*.mjs
```

Global mem9 runtime and config:

```text
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
  "recallMinPromptLength": 5,
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
  "profileId": "work",
  "recallMinPromptLength": 5
}
```

Remote update-check settings stay in the global config.
Set `recallMinPromptLength` to `0` to recall on every non-empty stripped user prompt.

### Environment Overrides

Runtime and setup can use environment variables:

- `MEM9_API_URL`
- `MEM9_API_KEY`
- `CODEX_HOME`
- `MEM9_HOME`
