---
title: opencode-plugin — OpenCode plugin for mem9
---

## Overview

TypeScript OpenCode plugin package with a server entry for mem9 hooks and tools plus a TUI entry for `/mem9-setup`.

## Commands

```bash
cd opencode-plugin && pnpm test
cd opencode-plugin && pnpm run typecheck
```

## Where to look

| Task | File |
|------|------|
| Plugin wiring | `src/index.ts` |
| Config and shared types | `src/shared/types.ts` |
| Backend interface | `src/server/backend.ts` |
| REST API client | `src/server/server-backend.ts` |
| Tool definitions | `src/server/tools.ts` |
| Hook wiring | `src/server/hooks.ts` |
| TUI setup command | `src/tui/index.ts` |

## Local conventions

- Plugin startup is fail-soft: missing runtime identity logs a setup-pending warning and returns `{}`.
- Shared credentials live at `$MEM9_HOME/.credentials.json`; `MEM9_HOME` defaults to `$HOME/.mem9`.
- User config lives in `<OpenCode config dir>/mem9.json`; project config lives in `<project>/.opencode/mem9.json`.
- Install the plugin in one scope only. Use project config overrides for per-project differences instead of loading duplicate plugin instances.
- Runtime prefers `MEM9_API_KEY`; `MEM9_API_URL` defaults to `https://api.mem9.ai`; legacy `MEM9_TENANT_ID` still works for compatibility.
- Debug logs live under the OpenCode state dir at `plugins/mem9/log/`.
- Default API URL is `https://api.mem9.ai` when no `MEM9_API_URL` is set.
- Package exports raw TypeScript: `"."` and `"./server"` load `src/index.ts`, and `"./tui"` loads `src/tui/index.ts`.
- Keep one-off npm caches and similar throwaway files under `opencode-plugin/.tmp/`, not the repo root or worktree root.
- Chain `DialogPrompt` follow-up steps through `scheduleDialogTransition()` so the next prompt does not consume the same Enter keypress.
- Use `showToast()` for plugin TUI messages so success and validation toasts keep a visible default duration.
- Manual API key entry in the TUI still uses a plain-text OpenCode prompt, so keep the one-time visibility warning in place.
- Tool handlers return JSON strings with `{ ok, ... }` payloads.
- Known 404s return `null`/`false`; unexpected errors are re-thrown.

## TypeScript style

- Double quotes, semicolons, explicit return types.
- `import type` for type-only imports.
- Use `??` for config fallback chains where appropriate.

## Anti-patterns

- Do NOT invent a local persistence mode; this package is server-backed.
- Do NOT bypass `buildTools()` / `buildHooks()` with ad hoc registration.
- Do NOT reintroduce tenant-only setup as the primary configuration model.
- Do NOT normalize duplicate plugin installation as a supported pattern.
