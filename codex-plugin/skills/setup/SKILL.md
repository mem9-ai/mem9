---
description: Install or repair global mem9 hooks and the default mem9 profile for Codex.
context: fork
allowed-tools:
  - Bash
  - Read
  - Edit
---

# Mem9 Setup

Resolve `./scripts/setup.mjs` relative to this skill directory.

Run this workflow:

1. Inspect the saved global profiles first:

```bash
set -euo pipefail
node ./scripts/setup.mjs --inspect-profiles
```

2. Use the JSON summary to decide the next step with the user.
   Share each available profile as `profileId`, `label`, `baseUrl`, and whether it already has an API key.
3. Ask the user which path to take:
   - use an existing profile
   - create a new mem9 API key
   - handle credentials manually
4. Run setup with the matching flags:
   - existing profile: `node ./scripts/setup.mjs --use-existing --profile <profile-id>`
   - create new key: `node ./scripts/setup.mjs --create-new [--profile <profile-id>] [--label <profile-label>] [--base-url <mem9-api-base-url>]`
   - manual credentials: explain the profile requirements, then stop until the profile exists
5. When the user already names a specific profile or mode in the original request, skip the question and run the matching command directly.

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
