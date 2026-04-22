---
description: Store one user-approved fact, preference, or instruction in mem9.
context: fork
allowed-tools:
  - Bash
  - Read
---

# Mem9 Store

Use this skill when the user explicitly asks Codex to remember or store something in mem9.

If you need the current CLI surface, flags, or examples, run `node ./scripts/store.mjs --help` first.

Resolve `./scripts/store.mjs` relative to this skill directory, extract the one memory that should be saved, then run:

```bash
set -euo pipefail
cat <<'EOF' | node ./scripts/store.mjs
REPLACE_WITH_MEMORY
EOF
```

Common flags:

- `--content <memory-text>`
- `--cwd <repo-root>`

Keep the saved content concise and factual.
The script uses the current effective mem9 profile. Project overrides still apply.
Do not print API keys or credential file contents.
Confirm back to the user what was saved.
