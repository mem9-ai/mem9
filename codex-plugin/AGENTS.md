---
title: codex-plugin — Codex hooks and skills
---

## Purpose

Codex plugin package for mem9. It installs managed Codex hooks, exposes `$mem9:*` skills, reads shared mem9 profiles, and calls the mem9 HTTP API for recall and store flows.

## Commands

```bash
pnpm --dir codex-plugin test
pnpm --dir codex-plugin typecheck
```

## Where to look

| Task | File |
|------|------|
| Plugin manifest | `.codex-plugin/plugin.json` |
| Hook templates | `templates/hooks.json` |
| Runtime hooks | `hooks/` |
| Bootstrap hook shims | `bootstrap-hooks/` |
| Config/profile logic | `lib/config.mjs` |
| HTTP client | `lib/http.mjs` |
| Project root detection | `lib/project-root.mjs` |
| Skill runtime helpers | `lib/skill-runtime.mjs` |
| Setup skill | `skills/setup/SKILL.md` |
| Cleanup skill | `skills/cleanup/SKILL.md` |
| Recall skill | `skills/recall/SKILL.md` |
| Store skill | `skills/store/SKILL.md` |
| Node test suite | `tests/` |

## Local conventions

- Node.js 22 or newer is required.
- This package is ESM-only; use `.mjs` for runtime scripts.
- Shared credentials live at `$MEM9_HOME/.credentials.json`; `MEM9_HOME` defaults to `$HOME/.mem9`.
- Codex runtime files live under `$CODEX_HOME/mem9/`.
- Keep API key entry out of the Codex TUI.
- Hook debug logs default to `$CODEX_HOME/mem9/logs/codex-hooks.jsonl`.
- Use explicit HTTP timeouts from the active profile or project override.

## Anti-patterns

- Do NOT store API keys in repo-local project config.
- Do NOT require users to edit Codex hook files manually before `$mem9:setup`.
- Do NOT duplicate hook JSON mutation logic outside the setup/cleanup helpers.
- Do NOT add TypeScript-only source files unless the package build/test flow is updated.
