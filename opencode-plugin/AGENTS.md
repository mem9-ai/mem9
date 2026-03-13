---
title: opencode-plugin — OpenCode plugin for mem9
---

## Overview

TypeScript OpenCode plugin that injects memories via hooks and exposes five memory tools backed by mem9 API.

## Commands

```bash
cd opencode-plugin && npm run typecheck
```

## Where to look

| Task | File |
|------|------|
| Plugin wiring | `src/index.ts` |
| Config and shared types | `src/types.ts` |
| Backend interface | `src/backend.ts` |
| REST API client | `src/server-backend.ts` |
| Tool definitions | `src/tools.ts` |
| Hook wiring | `src/hooks.ts` |
| Setup skill | `skills/mem9-setup/SKILL.md` |

## Local conventions

- Plugin startup is fail-soft: missing env vars log a warning and return `{}`.
- `MEM9_TENANT_ID` is required; `MEM9_API_URL` defaults to `https://api.mem9.ai`.
- Default API URL is `https://api.mem9.ai` when no `MEM9_API_URL` is set.
- Tool handlers return JSON strings with `{ ok, ... }` payloads.
- Known 404s return `null`/`false`; unexpected errors are re-thrown.

## TypeScript style

- Double quotes, semicolons, explicit return types.
- `import type` for type-only imports.
- Use `??` for config fallback chains where appropriate.

## Anti-patterns

- Do NOT invent a local persistence mode; this package is server-backed.
- Do NOT bypass `buildTools()` / `buildHooks()` with ad hoc registration.
- Do NOT treat missing tenant config as recoverable after backend construction.
