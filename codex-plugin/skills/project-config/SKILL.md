---
description: Change mem9 only for the current Git project.
context: fork
allowed-tools:
  - Bash
  - Read
  - Edit
disable-model-invocation: true
---

# Mem9 Project Config

Resolve `./scripts/project-config.mjs` relative to this skill directory, then run:

```bash
set -euo pipefail
node ./scripts/project-config.mjs
```

Common flags:

- `--profile <profile-id>`
- `--disable`
- `--reset`
- `--default-timeout-ms <ms>`
- `--search-timeout-ms <ms>`
- `--cwd <repo-root>`

This command only changes `<project>/.codex/mem9/config.json`.
It does not create profiles or store API keys in the project.
