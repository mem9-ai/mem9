---
description: Inspect and configure mem9 for Codex through the single setup entrypoint.
context: fork
allowed-tools:
  - Bash
  - Read
  - Edit
---

# Mem9 Setup

Resolve `./scripts/setup.mjs` relative to this skill directory.

Run this workflow:

1. Inspect the current mem9 state first:

```bash
set -euo pipefail
node ./scripts/setup.mjs inspect
```

2. Use the JSON summary to decide the next action with the user.
   Pay attention to `runtime`, `plugin`, `globalConfig`, `projectConfig`, and `profiles`.
   Global `updateCheck` settings live under `globalConfig.summary.updateCheck`.
3. Keep the default flow global-first.
   Apply project scope only when the user explicitly asks for a repo-local profile or timeout override.
   Remote release-check settings live in user scope.
4. When the user wants mem9 to create a new API key, run:

```bash
set -euo pipefail
node ./scripts/setup.mjs profile create \
  --profile <profile-id> \
  --label <profile-label> \
  --base-url <mem9-api-base-url> \
  --provision-api-key
```

5. When the user wants to provide the key manually, prefer a trusted shell plus `MEM9_API_KEY`, then run:

```bash
set -euo pipefail
node ./scripts/setup.mjs profile save-key \
  --profile <profile-id> \
  --label <profile-label> \
  --base-url <mem9-api-base-url> \
  --api-key-env MEM9_API_KEY
```

6. After the profile exists with an API key, apply the global config:

```bash
set -euo pipefail
node ./scripts/setup.mjs scope apply \
  --scope user \
  --profile <profile-id> \
  --default-timeout-ms <ms> \
  --search-timeout-ms <ms> \
  --update-check enabled \
  --update-check-interval-hours <hours>
```

7. When the user explicitly wants a project override, run one of:

```bash
set -euo pipefail
node ./scripts/setup.mjs scope apply \
  --scope project \
  --profile <profile-id> \
  --default-timeout-ms <ms> \
  --search-timeout-ms <ms>
```

```bash
set -euo pipefail
node ./scripts/setup.mjs scope clear --scope project
```

Project scope keeps `profileId`, `defaultTimeoutMs`, and `searchTimeoutMs`.
User scope also owns `updateCheck.enabled` and `updateCheck.intervalHours`.

Common flags:

- `inspect`
- `profile create`
- `profile save-key`
- `scope apply`
- `scope clear`
- `--profile <profile-id>`
- `--label <profile-label>`
- `--base-url <mem9-api-base-url>`
- `--provision-api-key`
- `--api-key-env MEM9_API_KEY`
- `--scope user|project`
- `--default-timeout-ms <ms>`
- `--search-timeout-ms <ms>`
- `--update-check enabled|disabled`
- `--update-check-interval-hours <hours>`
- `--cwd <repo-root>`

`--update-check` flags apply to `scope apply --scope user`.
Most mem9 plugin releases take effect after a Codex restart. Migration releases may ask for `$mem9:setup` once after restart.

`scope apply` and `scope clear` install or repair the managed mem9 runtime in `$CODEX_HOME`.
They enable `codex_hooks`, repair `$CODEX_HOME/hooks.json`, install stable shims in `$CODEX_HOME/mem9/hooks/`, and write install metadata to `$CODEX_HOME/mem9/install.json`.

Do not ask the user to paste API keys into the Codex TUI.
Prefer `MEM9_API_KEY` plus `profile save-key`.
Direct edits to `$MEM9_HOME/.credentials.json` remain a fallback.
Do not print API keys.
