---
title: kimi-plugin — Kimi Code hooks and skills
---

## Overview

Kimi Code integration: bash hooks plus two Node.js `.mjs` helpers and four skills. The plugin provisions credentials on session start, recalls memories on each user prompt, and uploads conversation turns parsed from the Kimi wire log.

## Where to look

| Task | File |
|------|------|
| Plugin manifest (hooks are declared here) | `plugin.json` |
| Shared helpers (auth, curl, ingest) | `hooks/common.sh` |
| Session-start provisioning | `hooks/session-start.sh` |
| Prompt-time recall | `hooks/user-prompt-submit.sh` |
| Turn ingest | `hooks/stop.sh`, `hooks/pre-compact.sh`, `hooks/session-end.sh` |
| Wire-log parser | `hooks/lib/wire.mjs` |
| Recall block formatter | `hooks/lib/format.mjs` |
| Smoke test | `hooks/smoke.test.sh` |

## Local conventions

- Every hook sources `hooks/common.sh`, starts with `set -euo pipefail`, and fails open.
- Hooks run from the managed copy under `plugins/managed/<id>/` — never write state into `$KIMI_PLUGIN_ROOT`; debug logs go to `$KIMI_CODE_HOME/mem9/`.
- Only `UserPromptSubmit` stdout reaches the model, as plain text — keep every other hook's stdout empty.
- Shared credentials live at `${MEM9_HOME:-$HOME/.mem9}/.credentials.json` (shared with the Codex integration); env `MEM9_API_KEY`/`MEM9_API_URL` override them.
- `X-Mnemo-Agent-Id` is `kimi-code`; ingest body `agent_id` is `kimi-code-main`.
- Keep curl timeouts explicit (`--max-time 8`); no `jq`; Node 18+ stdlib only.

## Validation

- `bash -n hooks/*.sh`, `node --check hooks/lib/*.mjs`, `bash hooks/smoke.test.sh`.

## Anti-patterns

- Do NOT emit Claude's `{"hookSpecificOutput":{"additionalContext":...}}` envelope — Kimi ignores it.
- Do NOT embed user text in shell source (quoting or heredocs); pass it via a file.
- Do NOT add npm dependencies.
