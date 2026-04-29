---
title: openclaw-plugin — OpenClaw memory plugin
---

## Overview

TypeScript memory plugin for OpenClaw. This subtree is self-contained: registration, hooks, backend, config schema, and shared types all live here.

## Commands

```bash
cd openclaw-plugin && npm run typecheck
```

## Where to look

| Task | File |
|------|------|
| Plugin entry / registration | `index.ts` |
| Backend abstraction | `backend.ts` |
| REST API client | `server-backend.ts` |
| Lifecycle hooks | `hooks.ts` |
| Shared types / config | `types.ts` |
| Plugin manifest | `openclaw.plugin.json` |

## Local conventions

- ESM only; local imports always end with `.js`.
- `MemoryBackend` is the seam between hooks/tools and the HTTP implementation.
- `ServerBackend` is the only backend currently used; keep request logic centralized there.
- Timeouts are configurable: `searchTimeoutMs` defaults to 15000ms, and `defaultTimeoutMs` defaults to 8000ms for other requests.
- Plugin uses `kind: "memory"`; OpenClaw owns lifecycle timing, this package only supplies tools/hooks.

## Error handling

- `get()` / `update()` return `null` for known not-found cases.
- Unexpected HTTP failures should throw.
- Public methods keep explicit `Promise<T>` return types.

## Anti-patterns

- Do NOT add direct DB access here.
- Do NOT remove `.js` extensions from imports; NodeNext resolution depends on them.
- Do NOT scatter fetch logic across tools/hooks; reuse the backend.
