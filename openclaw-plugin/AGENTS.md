---
title: openclaw-plugin — OpenClaw memory plugin
---

## Overview

TypeScript memory plugin for OpenClaw. This subtree is self-contained: tools,
hooks, context-engine wiring, HTTP client, config schema, and shared types all
live here.

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
| Context engine wiring | `context-engine.ts` |
| Shared types / config | `types.ts` |
| Plugin manifest | `openclaw.plugin.json` |

## Local conventions

- ESM only; local imports always end with `.js`.
- `MemoryBackend` is the seam between tools/hooks/context-engine and HTTP.
- `ServerBackend` is the only backend currently used; keep request logic centralized there.
- `LazyServerBackend` auto-provisions an `apiKey` via `POST /v1alpha1/mem9s` when config omits one.
- Hook recall may split pinned memories into `prependSystemContext` when the host supports it.
- `agent_end` and `tool_result_persist` must strip injected `<relevant-memories>` blocks before ingest/persist.
- `AbortSignal.timeout(8_000)` is the standard fetch timeout.

## Error handling

- `get()` / `update()` return `null` for known not-found cases.
- Unexpected HTTP failures should throw.
- Public methods keep explicit `Promise<T>` return types.

## Anti-patterns

- Do NOT add direct DB access here.
- Do NOT remove `.js` extensions from imports; NodeNext resolution depends on them.
- Do NOT scatter fetch logic across tools/hooks/context-engine; reuse the backend.
- Do NOT add `jq`-based JSON parsing in hook logic.
