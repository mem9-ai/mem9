---
title: openclaw-plugin — OpenClaw TypeScript Plugin
---

**Generated:** 2026-03-09

## Overview

Server-mode-only TypeScript plugin for OpenClaw. Flat layout (no `src/` subdir).
Registers 5 memory tools + 4 lifecycle hooks via `MemoryBackend` interface.

## Files

| File | Role |
|------|------|
| `index.ts` | Plugin entry: registers tools + hooks; contains `LazyServerBackend` |
| `backend.ts` | `MemoryBackend` interface (6 methods) |
| `server-backend.ts` | Concrete implementation — calls mnemo-server REST API |
| `hooks.ts` | 4 lifecycle hook registrations (`before_prompt_build`, `after_compaction`, `before_reset`, `agent_end`) |
| `types.ts` | Shared types: `PluginConfig`, `Memory`, `SearchInput`, `IngestInput`, etc. |
| `openclaw.plugin.json` | Plugin metadata + config schema |

## MemoryBackend Interface

```typescript
interface MemoryBackend {
  store(input: CreateMemoryInput): Promise<StoreResult>;   // Memory | IngestResult union
  search(input: SearchInput): Promise<SearchResult>;
  get(id: string): Promise<Memory | null>;
  update(id: string, input: UpdateMemoryInput): Promise<Memory | null>;
  remove(id: string): Promise<boolean>;
  ingest(input: IngestInput): Promise<IngestResult>;        // smart pipeline
}
```

`StoreResult = Memory | IngestResult` — callers duck-type on presence of `messages[]`.

## Unusual Patterns

- **`LazyServerBackend`** (`index.ts`): wraps `ServerBackend`, defers tenant resolution to first
  call via singleton `Promise`. Auto-provisions via `POST /v1alpha1/mem9s` if no `tenantID` in
  config — provisioned ID is in-process only, not persisted.
- **`ingest()` reuses `store()` HTTP endpoint**: Both call `POST /memories`. Server discriminates
  by body shape (`messages[]` vs `content`). No separate route for ingest.
- **Agent end hook** (`hooks.ts`): Strips previously injected `<relevant-memories>` blocks before
  sending to `ingest()` — avoids feeding back injected context as new memories.

## Lifecycle Hooks

| Hook | Trigger | Action |
|------|---------|--------|
| `before_prompt_build` | Every LLM call | Search memories by prompt text, prepend as `<relevant-memories>` XML |
| `after_compaction` | After `/compact` | No-op (server-side search always fresh) |
| `before_reset` | Before `/reset` | Capture last 3 user messages as session-summary memory |
| `agent_end` | Agent finishes | Strip injected blocks, call `ingest()` with `mode:"smart"` |

## Config (from `openclaw.plugin.json`)

Set in `plugins.entries.mnemo.config`:
- `apiUrl` — mnemo-server base URL (required for server mode)
- `tenantID` — tenant UUID (auto-provisioned if absent)
- `agentName` — identifies this agent in memories (default: `"agent"`)

## Anti-Patterns

- No `direct-backend.ts` — CLAUDE.local.md mentions it but it does not exist; plugin is server-mode only
- Do not add `jq` JSON parsing — bash hooks use `python3` (shell injection risk)
