---
title: opencode-plugin — OpenCode plugin
---

## Overview

TypeScript OpenCode plugin that injects memories via hooks and exposes five memory tools backed by mnemo-server.

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

## Local conventions

- Plugin startup is fail-soft: missing env vars log a warning and return `{}`.
- `MNEMO_TENANT_ID` is preferred; `MNEMO_API_TOKEN` is legacy fallback only.
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
