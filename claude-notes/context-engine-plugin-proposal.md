---
title: Evolving Mnemos into an OpenClaw ContextEngine Plugin
status: Draft
date: 2026-03-09
---

## Overview

OpenClaw v2026.3.7-beta.1 introduces a first-class `ContextEngine` plugin slot (PR #22201)
that grants plugins ownership of the full context lifecycle: bootstrap, assemble, ingest,
compact, subagent handoff. The current mnemos openclaw-plugin occupies the `memory` slot and
patches two hook points (`before_prompt_build`, `agent_end`). This proposal describes a
two-phase migration from that model to full `ContextEngine` ownership, with a
backward-compatible hook fallback for pre-beta.1 users.

---

## Problem Statement

The current hook model has five concrete gaps:

| Gap | Impact |
|---|---|
| No pre-compaction flush | Memories lost when the context window is squashed |
| `after_compaction` is a no-op | Plugin cannot react to compaction events |
| Pinned memories cost tokens every turn | `prependContext` is not provider-cached |
| `allowPromptInjection` undocumented | beta.1 silently strips memory injection without this flag |
| No subagent memory handoff | Child agents start with an empty memory context |

---

## Proposed Changes

### Phase 1 — Immediate Hook Fixes (~140 LoC, low risk)

These are backward-compatible and target the existing hook surface.

**1. `allowPromptInjection` startup warning**

`allowPromptInjection` is a **host-side** hook policy field set in the user's `openclaw.json`
under `plugins.entries.mem9.hooks.allowPromptInjection`. The plugin cannot read or enforce it
— it is owned by the OpenClaw framework. The right intervention is a startup log that tells
the operator what to configure; adding it to `PluginConfig` would be wrong (the plugin has no
mechanism to observe or enforce a host-level policy).

```ts
// index.ts — in register(), emit once at startup
api.logger.info(
  "[mnemo] IMPORTANT: On OpenClaw beta.1+, memory injection requires " +
  '"hooks.allowPromptInjection": true in your plugin entry. ' +
  "Without it, before_prompt_build context injection is silently disabled."
);
```

No `PluginConfig` field added — this is documentation/guidance only.

**2. System-prompt caching for pinned memories**

`before_prompt_build` now supports `prependSystemContext` (PR #35177). Pinned memories
(stable facts, user preferences) should move there — they sit in the provider-cached system
prompt portion and no longer cost per-turn tokens.

Change in `hooks.ts` `before_prompt_build`:
```ts
const { pinned, dynamic } = splitByType(memories);
return {
  prependSystemContext: pinned.length > 0 ? formatMemoriesBlock(pinned, "system") : undefined,
  prependContext: dynamic.length > 0 ? formatMemoriesBlock(dynamic, "context") : undefined,
};
```

**3. Pre-compaction flush via `session:compact:before`**

The `after_compaction` hook is currently a no-op. Replace with `session:compact:before` to
flush the in-window conversation to mem9 ingest *before* the window is squashed.

```ts
api.on("session:compact:before", async (event: unknown) => {
  const evt = event as { messages?: unknown[]; sessionId?: string };
  await flushMessagesToIngest(backend, evt.messages, evt.sessionId, logger, maxIngestBytes);
  logger.info("[mnemo] Pre-compaction flush complete — memories preserved");
});
```

> **Pre-beta.1 limitation**: `session:compact:before` does not exist on old OpenClaw. For
> pre-beta.1 users, compaction remains a memory-loss event — the window is squashed before
> any hook fires, leaving nothing to flush. The only partial mitigation is the existing
> `before_reset` hook, which saves the last 3 user messages on explicit `/reset`. Automatic
> compaction is not covered. This is a known limitation with no clean fix on the old API
> surface.

**4. `tool_result_persist` transcript cleanup**

Injected `<relevant-memories>` blocks appear in tool result messages and get re-ingested as
if they were user content. Wire `stripInjectedContext` to the `tool_result_persist` hook.

```ts
api.on("tool_result_persist", (event: unknown) => {
  const evt = event as { content?: string };
  if (evt?.content) {
    return { content: stripInjectedContext(evt.content) };
  }
});
```

**5. `message_received` search pre-warm**

Currently `before_prompt_build` runs the search synchronously while the user waits. Pre-warm
the search on `message_received` (earlier in the pipeline) and cache the
`Promise<SearchResult>` keyed by prompt fingerprint. `before_prompt_build` then awaits the
already-in-flight promise.

```ts
const preWarmCache = new Map<string, Promise<SearchResult>>();

api.on("message_received", (event: unknown) => {
  const evt = event as { prompt?: string };
  const key = evt?.prompt?.slice(0, 200);
  if (key && key.length >= MIN_PROMPT_LEN && !preWarmCache.has(key)) {
    preWarmCache.set(key, backend.search({ q: key, limit: MAX_INJECT }));
    setTimeout(() => preWarmCache.delete(key), 3 * 60 * 1000); // 3-min TTL
  }
});
```

**Phase 1 total: ~140 LoC — plugin only, no server changes**

---

### Phase 2 — ContextEngine Interface (~280 LoC)

New file: `openclaw-plugin/context-engine.ts`

This implements the `ContextEngine` interface and is registered only when
`api.capabilities?.contextEngine` is detected, preserving full backward compatibility with
pre-beta.1 deployments.

The Phase 2 code below is an **interface sketch** — method names, ctx field shapes, and the
`ctx.session` API must be verified against the actual beta.1 SDK type exports before
implementation. See Open Questions 1 and 2.

Known gaps to resolve before writing real code:
- `Logger` interface is not exported from `hooks.ts` — must be exported or redefined locally.
- `formatAndClean()` does not exist — must be extracted from `agent_end` handler in `hooks.ts`.
- `ctx.session`, `ctx.latestPrompt`, `ctx.childAgentId` — field names unverified against beta.1.
- `ContextEngineBootstrapCtx` / `ContextEngineAssembleCtx` etc. — type names unverified.

```ts
// context-engine.ts (sketch — verify SDK types before implementing)
import type { MemoryBackend } from "./backend.js";
// Logger must be exported from hooks.ts first:
import type { Logger } from "./hooks.js";
// formatAndClean must be extracted from agent_end logic in hooks.ts:
import { selectMessages, formatMemoriesBlock, formatAndClean } from "./hooks.js";

export function buildContextEngine(
  backend: MemoryBackend,
  logger: Logger,
  opts: { maxIngestBytes?: number; tenantID: string }
) {
  return {
    async bootstrap(ctx: /* verify */ unknown) {
      // Use memory_type=pinned filter, NOT tags:"pinned"
      // Requires memory_type added to SearchInput (see Phase 2 prerequisite below)
      const pinned = await backend.search({ memory_type: "pinned", limit: 20 });
      (ctx as { session: { set: (k: string, v: unknown) => void } })
        .session.set("mnemo:pinned", pinned.data);
      logger.info(`[mnemo] bootstrap: prefetched ${pinned.data.length} pinned memories`);
    },

    async assemble(ctx: /* verify */ unknown) {
      const c = ctx as { session: { get: (k: string) => unknown }; latestPrompt?: string };
      const pinned = (c.session.get("mnemo:pinned") as Memory[]) ?? [];
      const result = await backend.search({ q: c.latestPrompt, limit: 10 });
      const dynamic = result.data.filter(m => m.memory_type !== "pinned");
      return {
        prependSystemContext: pinned.length > 0 ? formatMemoriesBlock(pinned) : undefined,
        prependContext: dynamic.length > 0 ? formatMemoriesBlock(dynamic) : undefined,
      };
    },

    async ingest(ctx: /* verify */ unknown) {
      const c = ctx as { messages?: unknown[]; sessionId?: string; agentId?: string };
      if (!c.messages?.length) return;
      const selected = selectMessages(formatAndClean(c.messages), opts.maxIngestBytes);
      if (!selected.length) return;
      await backend.ingest({
        messages: selected,
        session_id: c.sessionId ?? `ses_${Date.now()}`,
        agent_id: c.agentId ?? "agent",
        mode: "smart",
      });
    },

    async compact(ctx: /* verify */ unknown) {
      // Flush window BEFORE OpenClaw squashes it.
      // compact + ingest can race — see duplicate-ingest design below.
      const c = ctx as { messages?: unknown[]; sessionId?: string; agentId?: string };
      if (!c.messages?.length) return;
      const selected = selectMessages(formatAndClean(c.messages), opts.maxIngestBytes);
      if (!selected.length) return;
      try {
        await backend.ingest({
          messages: selected,
          session_id: c.sessionId ?? `ses_${Date.now()}`,
          agent_id: c.agentId ?? "agent",
          mode: "smart",
        });
        logger.info(`[mnemo] compact: flushed ${selected.length} messages`);
      } catch (err) {
        // Log and proceed — do NOT block compaction on ingest failure
        logger.error(`[mnemo] compact flush failed: ${String(err)} — window may be partially lost`);
      }
      // Do NOT replace ctx.summary — let OpenClaw produce its structural summary
    },

    async afterTurn(_ctx: unknown) { /* reserved */ },

    async prepareSubagentSpawn(ctx: /* verify */ unknown) {
      const c = ctx as { childAgentId?: string };
      return { pluginConfig: { tenantID: opts.tenantID, agentId: c.childAgentId ?? "subagent" } };
    },

    async onSubagentEnded(_ctx: unknown) {
      // Phase 3: query child-agent memories and surface to parent
    },
  };
}
```

**Phase 2 prerequisite — `SearchInput` extension:**

Before `bootstrap` and `assemble` can use `memory_type` filtering, `SearchInput` in `types.ts`
and `ServerBackend.search()` in `server-backend.ts` must be extended. The server already
accepts and applies `memory_type` (and `agent_id`, `session_id`) — only the plugin client is
missing these fields:

```ts
// types.ts — extend SearchInput
export interface SearchInput {
  q?: string;
  tags?: string;
  source?: string;
  limit?: number;
  offset?: number;
  memory_type?: string;   // ADD: maps to server ?memory_type=
  agent_id?: string;      // ADD: maps to server ?agent_id=
  session_id?: string;    // ADD: maps to server ?session_id=
}
```

```ts
// server-backend.ts — forward new fields in search()
if (input.memory_type) params.set("memory_type", input.memory_type);
if (input.agent_id)    params.set("agent_id",    input.agent_id);
if (input.session_id)  params.set("session_id",  input.session_id);
```

No server changes required — the server already handles these query parameters.

Registration in `index.ts` (version-guarded):

```ts
// Version-guarded: keep hooks for pre-beta.1 OpenClaw compatibility
if (api.capabilities?.contextEngine) {
  api.registerContextEngine(buildContextEngine(hookBackend, api.logger, {
    maxIngestBytes: cfg.maxIngestBytes,
    tenantID: resolvedTenantID,
  }));
  api.logger.info("[mnemo] ContextEngine mode active (beta.1+)");
} else {
  registerHooks(api, hookBackend, api.logger, { maxIngestBytes: cfg.maxIngestBytes });
  api.logger.info("[mnemo] Hook mode active (pre-beta.1 compatibility)");
}
```

**Phase 2 total: ~280 LoC — plugin only, no server changes**

---

### Phase 3 — Subagent Memory Continuity (~150 LoC, plugin only)

Deferred until beta.1 stabilizes. Scope:

- `onSubagentEnded`: query child-agent memories by filtering `agent_id=childAgentId`, surface
  top-N discoveries to parent via `backend.ingest` or `memory_store`.
- Cross-agent search: expose `agent_id` filter in the plugin's `SearchInput` (see Phase 2
  prerequisite — already covers this).

> **Phase 3 requires no server changes.** The server already accepts and applies `?agent_id=`
> and `?session_id=` as WHERE clause filters in search queries (`handler/memory.go:131`,
> `repository/tidb/memory.go:541`). The work is entirely on the plugin client side — adding
> `agent_id` to `SearchInput` and forwarding it in `ServerBackend.search()`, which is already
> captured as a Phase 2 prerequisite. Phase 3 only adds the `onSubagentEnded` logic that uses
> the filter.

---

## File Changes Summary

| File | Change | LoC | Phase |
|---|---|---|---|
| `hooks.ts` | `session:compact:before` flush; `tool_result_persist` cleanup; `message_received` pre-warm; system context split; export `Logger` type; extract `formatAndClean()` | ~90 | 1+2 |
| `types.ts` | Add `memory_type`, `agent_id`, `session_id` to `SearchInput` | ~10 | 2 prereq |
| `server-backend.ts` | Forward `memory_type`, `agent_id`, `session_id` in `search()` | ~10 | 2 prereq |
| `index.ts` | Startup warning for `allowPromptInjection`; version-guarded ContextEngine registration | ~30 | 1+2 |
| `context-engine.ts` | New file — `buildContextEngine()` with all 7 lifecycle methods | ~180 | 2 |
| `backend.ts` | No changes | — | — |
| `server/` | No changes | — | — |

**All phases are plugin-only. No server changes required.**
**Phase 1+2 total: ~320 LoC**
**Phase 3 total: ~150 LoC (uses SearchInput extension already in Phase 2)**

---

## Backward Compatibility

| Scenario | Behavior |
|---|---|
| OpenClaw < beta.1 | Hook path active; compact remains a memory-loss event (no `session:compact:before`) |
| OpenClaw < beta.1, `/reset` used | `before_reset` saves last 3 user messages — partial mitigation only |
| OpenClaw beta.1+, no `allowPromptInjection` | Startup warning logged; hook path active; injection may be stripped by framework |
| OpenClaw beta.1+, `allowPromptInjection: true` | ContextEngine path active; full lifecycle ownership including safe compact |

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| beta.1 ContextEngine API unstable before GA | Version guard; keep hook path as permanent fallback |
| `compact` + `ingest` fire concurrently for the same session | **Not mitigated by server-side dedup** — ingest is not idempotent on `session_id`, no content-hash dedup exists. Mitigation: use a per-session in-memory flag (`compacting: Set<sessionId>`) to skip `ingest` while compact is in progress; or scope `compact` and `ingest` as mutually exclusive writers per session |
| mem9 unavailable during compaction | `compact` catches errors and logs, then proceeds — compaction is not blocked. Window may be partially lost under outage. Acceptable tradeoff; retry is out of scope. |
| `assemble` token budget overshoot | Conservative estimate: 1 token ≈ 4 bytes; prefer under-injecting |
| Pre-warm cache grows unbounded | 3-min TTL + Map key eviction on `before_prompt_build` hit |
| `prependSystemContext` treated as mutable by some providers | Only put truly stable (`memory_type=pinned`) memories there; dynamic insights stay in `prependContext` |

---

## Open Questions

1. **Capability detection**: Does OpenClaw beta.1 expose `api.capabilities.contextEngine` as a
   boolean, or is detection done via `typeof api.registerContextEngine === "function"`? Affects
   version guard in `index.ts`.
2. **ContextEngine SDK types**: Exact field names for `ctx.session`, `ctx.latestPrompt`,
   `ctx.childAgentId`, `ctx.messages`, `ctx.sessionId`, `ctx.agentId` — need to verify against
   beta.1 type exports before writing `context-engine.ts`.
3. **`allowPromptInjection` scope**: Does this host policy also suppress ContextEngine
   `assemble()` return values, or only hook-based `before_prompt_build` injection? Determines
   whether `assemble()` needs a separate capability check.
4. **Hook payload shapes**: Exact event payload fields for `message_received`,
   `tool_result_persist`, and `session:compact:before` — unverified against beta.1.
5. **Pinned memories scope**: Should `bootstrap` prefetch pinned memories globally for the
   tenant, or scoped to the current `agent_id`? Affects the `SearchInput` call in bootstrap.
6. **Versioning**: Should Phase 1 ship as a patch release and Phase 2 as a minor, given the
   behavioral difference between hook and ContextEngine mode?

---

## Recommended Sequencing

1. **Now**: Land Phase 1 item 1 (`allowPromptInjection` startup warning) — prevents silent
   breakage for anyone already on beta.1. Low risk, no logic change.
2. **This sprint**: Land Phase 1 items 2-5 (system context split, compact flush, transcript
   cleanup, pre-warm) — all hook-surface, no API dependency, no server changes.
3. **Before Phase 2**: Verify all Open Questions 1-4 against the beta.1 SDK. Export `Logger`
   from `hooks.ts`; extract `formatAndClean()`. Add `memory_type`/`agent_id`/`session_id` to
   `SearchInput` and `ServerBackend.search()`.
4. **Next sprint**: Implement `context-engine.ts` behind the version guard — safe to merge to
   main before beta.1 GA since it is unreachable on older versions.
5. **After beta.1 GA**: Enable ContextEngine path by default; deprecate hook fallback.
6. **Phase 3**: Add `onSubagentEnded` logic using the `agent_id` search filter already
   unlocked in Phase 2.
