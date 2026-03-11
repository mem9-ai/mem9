---
title: claude-plugin — Claude Code hooks and skills
---

## Overview

Claude Code integration uses bash hooks plus two skills. Hook scripts are small and deterministic; shared HTTP helpers live in `hooks/common.sh`.

## Where to look

| Task | File |
|------|------|
| Shared curl/env helpers | `hooks/common.sh` |
| Session-start memory injection | `hooks/session-start.sh` |
| Prompt hint injection | `hooks/user-prompt-submit.sh` |
| Session stop capture | `hooks/stop.sh` |
| Plugin manifest | `.claude-plugin/plugin.json` |
| Hook definitions | `hooks/hooks.json` |
| On-demand recall | `skills/memory-recall/SKILL.md` |
| On-demand store | `skills/memory-store/SKILL.md` |

## Local conventions

- Every hook sources `hooks/common.sh`.
- Missing `MNEMO_API_URL` / `MNEMO_TENANT_ID` should fail quietly when appropriate so Claude Code still starts.
- JSON shaping is done with inline Python, not `jq`.
- Tenant routing is path-based: `/v1alpha1/mem9s/{tenantID}/...`.

## Validation

- There is no test runner here; validate by reading the script flow and checking shell syntax manually if needed.
- Keep curl timeouts explicit (`--max-time 8`).

## Anti-patterns

- Do NOT add complex state to hooks.
- Do NOT assume marketplace install; manual install paths still matter.
- Do NOT use `jq` in hooks; keep Python-based parsing consistent.
