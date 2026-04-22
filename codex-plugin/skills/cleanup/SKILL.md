---
description: Remove mem9-managed Codex files before reinstalling, resetting, or uninstalling mem9.
context: fork
allowed-tools:
  - Bash
  - Read
---

# Mem9 Cleanup

Resolve `./scripts/cleanup.mjs` relative to this skill directory.

Run this workflow:

1. Inspect the current cleanup targets first:

```bash
set -euo pipefail
node ./scripts/cleanup.mjs inspect
```

2. Use the JSON summary to confirm whether cleanup should cover only global Codex files or the current project's local override too.
3. Remove mem9-managed global Codex files with:

```bash
set -euo pipefail
node ./scripts/cleanup.mjs run
```

4. When the current repository's local override should be removed too, run:

```bash
set -euo pipefail
node ./scripts/cleanup.mjs run --include-project
```

Common flags:

- `inspect`
- `run`
- `--include-project`
- `--cwd <repo-root>`

`run` removes mem9-managed entries from `$CODEX_HOME/hooks.json`, `$CODEX_HOME/mem9/hooks/`, `$CODEX_HOME/mem9/install.json`, `$CODEX_HOME/mem9/config.json`, and `$CODEX_HOME/mem9/state.json`.
`run --include-project` also removes `<project>/.codex/mem9/config.json`.

Keep `$MEM9_HOME/.credentials.json`, `$CODEX_HOME/config.toml`, and mem9 debug logs untouched.
Do not print API keys or credential file contents.
