---
description: Recall mem9 memories when the user explicitly asks for stored context.
context: fork
allowed-tools:
  - Bash
  - Read
---

# Mem9 Recall

Use this skill when the user explicitly asks to look up saved memories or recover prior context on demand.

If you need the current CLI surface, flags, or examples, run `node ./scripts/recall.mjs --help` first.

Resolve `./scripts/recall.mjs` relative to this skill directory, extract the recall query from the current request, then run:

```bash
set -euo pipefail
cat <<'EOF' | node ./scripts/recall.mjs
REPLACE_WITH_SEARCH_QUERY
EOF
```

Common flags:

- `--query <query>`
- `--limit <count>`
- `--cwd <repo-root>`

The script uses the current effective mem9 profile. Project overrides still apply.
Do not print API keys or credential file contents.
Return only the memories that help with the current request.
