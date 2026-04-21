---
description: Install or repair global mem9 hooks and the default mem9 profile for Codex.
context: fork
allowed-tools:
  - Bash
  - Read
  - Edit
disable-model-invocation: true
---

# Mem9 Setup

Resolve `./scripts/setup.mjs` relative to this skill directory, then run:

```bash
set -euo pipefail
node ./scripts/setup.mjs
```

Common flags:

- `--profile <profile-id>`
- `--label <profile-label>`
- `--base-url <mem9-api-base-url>`
- `--create-new`
- `--use-existing`
- `--api-key <mem9-api-key>`
- `--cwd <repo-root>`

This command installs or repairs the global mem9 hooks for the current Codex user.
It writes the global default config, enables `codex_hooks`, and updates global profiles in `$MEM9_HOME/.credentials.json`.

When no usable profile exists yet, setup can create a new mem9 API key automatically.
`--use-existing` selects an existing global profile. Manual profile creation stays outside the Codex TUI.

When the current directory is inside a Git repository, setup also removes old mem9-managed project hooks from that repository.

Do not print API keys.
