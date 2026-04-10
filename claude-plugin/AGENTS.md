---
title: claude-plugin — Claude Code hooks and skills
---

## Overview

Claude Code integration uses bash hooks plus JavaScript helpers and three skills. Hook scripts are small and deterministic; shared HTTP helpers live in `hooks/common.sh`.

## Where to look

| Task | File |
|------|------|
| Shared curl/env helpers | `hooks/common.sh` |
| Session-start bootstrap | `hooks/session-start.sh` |
| Prompt-time recall | `hooks/user-prompt-submit.sh` |
| Session stop capture | `hooks/stop.sh` |
| Pre-compact capture | `hooks/pre-compact.sh` |
| Session-end fallback | `hooks/session-end.sh` |
| Transcript parsing helper | `hooks/lib/transcript-parser.mjs` |
| Hook JSON helper | `hooks/lib/hook-json.mjs` |
| Memory block formatter | `hooks/lib/memories-formatter.mjs` |
| Plugin manifest | `.claude-plugin/plugin.json` |
| Hook definitions | `hooks/hooks.json` |
| On-demand setup | `skills/setup/SKILL.md` |
| On-demand recall | `skills/recall/SKILL.md` |
| On-demand store | `skills/store/SKILL.md` |

## Local conventions

- Every hook sources `hooks/common.sh`.
- JSON shaping should go through the `.mjs` helpers under `hooks/lib/`.
- Automatic recall and ingest go through `/v1alpha2/mem9s/...` with `X-API-Key` and `X-Mnemo-Agent-Id`.
- Runtime auth is stored in `${CLAUDE_PLUGIN_DATA}/auth.json`.

## Validation

- Validate hook scripts with `bash -n` and JavaScript helpers with `node --check`.
- Keep curl timeouts explicit (`--max-time 8`).

## Anti-patterns

- Do NOT add complex state to hooks.
- Do NOT assume marketplace install; manual install paths still matter.
- Do NOT use `jq` in hooks.
