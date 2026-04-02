---
title: Mnemos OpenClaw Plugin MVP Plan
status: Draft
date: 2026-03-09
---

## Overview

OpenClaw `v2026.3.7-beta.1` adds a first-class `ContextEngine` slot, but mnemos MVP will **not**
take that slot.

MVP scope is intentionally narrower:

1. keep mnemos as a hook-based memory plugin
2. improve hook-mode injection and ingest correctness on beta.1
3. add missing search filters already supported by the server

MVP explicitly does **not** register or activate `mem9` as a `ContextEngine`.

Reason:

- OpenClaw `ContextEngine` requires a real `compact()` implementation
- mnemos MVP does not want to own session compaction behavior
- OpenClaw does not automatically fall back to `legacy` compaction once the
  `contextEngine` slot is switched to `mem9`

So this proposal is no longer "ship ContextEngine v1". It is "ship a safer hook-mode mnemos MVP,
while keeping future ContextEngine work possible."

---

## Problem Statement

The current hook model still has four practical gaps:

| Gap | Current surface | Impact |
|---|---|---|
| Hook-mode compaction is lossy | `after_compaction` is log-only | Older raw turns can be summarized away before mnemos stores them |
| Pinned memories cost tokens every turn | `before_prompt_build` injects all memories into `prependContext` | Stable facts do not benefit from provider-side system prompt caching |
| `allowPromptInjection` is easy to miss | Host policy on prompt-mutating hooks | beta.1 silently strips hook-based prompt injection unless the operator enables it |
| Hook ingest reads the wrong identity surface | `agent_end` handler assumes `agentId` / `sessionId` are on the event | beta.1 passes runtime identity in hook context, so current logic can miss real runtime identity |

The MVP goal is pragmatic:

- improve hook mode where the host contract clearly supports it
- keep mnemos on the existing memory-plugin path
- accept **lossy compaction in hook mode**
- defer ContextEngine ownership until mnemos is willing to implement `compact()`

---

## Verified Upstream Contract

The following items have been verified against OpenClaw `v2026.3.7-beta.1` source and release
notes. They are relevant both to the MVP and to the decision to defer ContextEngine mode.

### 1. ContextEngine registration and activation

- Plugin API: `api.registerContextEngine(id, factory)`
- Activation is **slot-based**, not capability-flag-based:

```json
{
  "plugins": {
    "slots": {
      "contextEngine": "mem9"
    }
  }
}
```

- Default context-engine slot value is `"legacy"`, not `"mem9"`.
- Once the slot is switched to `"mem9"`, OpenClaw resolves `mem9` as the active engine and calls
  its `assemble()` / `afterTurn()` / `compact()` methods directly.
- OpenClaw does **not** automatically fall back to `legacy` compaction after the slot is switched.

### 2. Actual ContextEngine interface

OpenClaw beta.1 exports a `ContextEngine` interface with these methods:

```ts
interface ContextEngine {
  readonly info: ContextEngineInfo;
  bootstrap?(params: { sessionId: string; sessionFile: string }): Promise<BootstrapResult>;
  ingest(params: { sessionId: string; message: AgentMessage; isHeartbeat?: boolean }): Promise<IngestResult>;
  ingestBatch?(params: { sessionId: string; messages: AgentMessage[]; isHeartbeat?: boolean }): Promise<IngestBatchResult>;
  afterTurn?(params: {
    sessionId: string;
    sessionFile: string;
    messages: AgentMessage[];
    prePromptMessageCount: number;
    autoCompactionSummary?: string;
    isHeartbeat?: boolean;
    tokenBudget?: number;
    legacyCompactionParams?: Record<string, unknown>;
  }): Promise<void>;
  assemble(params: { sessionId: string; messages: AgentMessage[]; tokenBudget?: number }): Promise<AssembleResult>;
  compact(params: {
    sessionId: string;
    sessionFile: string;
    tokenBudget?: number;
    force?: boolean;
    currentTokenCount?: number;
    compactionTarget?: "budget" | "threshold";
    customInstructions?: string;
    legacyParams?: Record<string, unknown>;
  }): Promise<CompactResult>;
  prepareSubagentSpawn?(params: {
    parentSessionKey: string;
    childSessionKey: string;
    ttlMs?: number;
  }): Promise<SubagentSpawnPreparation | undefined>;
  onSubagentEnded?(params: { childSessionKey: string; reason: SubagentEndReason }): Promise<void>;
  dispose?(): Promise<void>;
}
```

Important implication for MVP:

`compact()` is part of the real ContextEngine contract, so "ContextEngine MVP without compact" is
not a valid production scope.

### 3. Hook contracts that matter here

- `allowPromptInjection` is configured at
  `plugins.entries.<id>.hooks.allowPromptInjection`.
- Its scope is prompt-mutating hooks only:
  `before_prompt_build` and prompt fields returned by legacy `before_agent_start`.
- `agent_end` event payload is `{ messages, success, error?, durationMs? }`
- Runtime identity for `agent_end` lives in the second hook argument, not the event payload:
  `ctx.agentId`, `ctx.sessionId`, `ctx.sessionKey`
- `message_received` payload is `{ from, content, timestamp?, metadata? }`
- `tool_result_persist` receives `{ message: AgentMessage, toolName?, toolCallId?, isSynthetic? }`
  and returns `{ message?: AgentMessage }`
- Internal event `session:compact:before` exists, but on the compaction path it does **not**
  provide a reliable full-message flush contract. Plugin compaction hooks are
  `before_compaction` / `after_compaction`.

---

## Proposed Changes

### Phase 1 — Hook-Mode Hardening (~70 LoC)

These changes are compatible with today's plugin architecture and remain the core MVP scope.

**1. Hook-mode startup warning for `allowPromptInjection`**

When mnemos is running in hook mode on beta.1+, log a startup warning:

```ts
api.logger.info(
  "[mnemo] Hook mode active. On OpenClaw beta.1+, hook-based memory injection " +
  'requires plugins.entries.mem9.hooks.allowPromptInjection = true.'
);
```

This warning helps operators understand why memory injection may appear to do nothing after a
beta.1 upgrade.

**2. Split pinned and dynamic memories in `before_prompt_build`**

Hook mode can already use the new `prependSystemContext` field. That is the right place for
stable pinned memories:

```ts
const { pinned, dynamic } = splitByType(memories);
return {
  prependSystemContext: pinned.length ? formatMemoriesBlock(pinned, "system") : undefined,
  prependContext: dynamic.length ? formatMemoriesBlock(dynamic, "context") : undefined,
};
```

This preserves the existing hook behavior for dynamic memories while moving stable facts into a
provider-cache-friendly field.

**3. Clean transcript writes through `tool_result_persist`**

The actual beta.1 hook payload is `event.message: AgentMessage`, not `event.content: string`.
The cleanup hook should mutate the message body before OpenClaw persists it:

```ts
api.on("tool_result_persist", (event) => {
  const cleaned = cleanAgentMessage(event.message);
  if (!cleaned) return;
  return { message: cleaned };
});
```

The helper should strip previously injected `<relevant-memories>` blocks from text-bearing
message content while leaving unrelated tool-result structure intact.

**4. Read runtime identity from hook context, not `agent_end` payload**

The real beta.1 contract passes `agentId` / `sessionId` in the second hook argument:

```ts
api.on("agent_end", async (event, ctx) => {
  if (!event.success) return;
  const sessionId = ctx.sessionId ?? `ses_${Date.now()}`;
  const agentId = ctx.agentId ?? AUTO_CAPTURE_SOURCE;
  ...
});
```

This keeps hook-mode ingest aligned with the real OpenClaw hook contract and preserves runtime
agent/session identity when OpenClaw provides it.

**Explicit non-goal for Phase 1**

Hook mode does **not** attempt compaction-time mem9 preservation.

Why:

- `session:compact:before` is an internal event, not a plugin `api.on(...)` hook name
- the hook path does not provide a stable "full compaction window messages" contract across all
  compaction paths
- MVP should not build critical behavior on an API surface that does not reliably expose the data
  needed for it

So Phase 1 explicitly accepts:

`Hook mode remains lossy under compaction.`

---

### Phase 2 — Search Filter Parity (~20 LoC)

The plugin client should expose the filters the server already supports:

```ts
export interface SearchInput {
  q?: string;
  tags?: string;
  source?: string;
  limit?: number;
  offset?: number;
  memory_type?: string;
  agent_id?: string;
  session_id?: string;
}
```

and forward them in `server-backend.ts`:

```ts
if (input.memory_type) params.set("memory_type", input.memory_type);
if (input.agent_id) params.set("agent_id", input.agent_id);
if (input.session_id) params.set("session_id", input.session_id);
```

No server changes are required. These query parameters already exist server-side.

---

## Explicitly Out of MVP Scope

These items are intentionally deferred and should not be treated as part of the implementation
plan for this MVP.

### 1. ContextEngine mode

Mnemos MVP does **not**:

- register `mem9` as a production `ContextEngine`
- set or recommend `plugins.slots.contextEngine = "mem9"`
- implement `assemble()` / `afterTurn()` / `compact()` as a shipped runtime path

Reason:

- mnemos MVP does not want to own session compaction behavior
- `compact()` is required once mnemos becomes the active ContextEngine
- OpenClaw will not automatically fall back to `legacy` compaction after slot takeover

### 2. Subagent memory continuity

The earlier ContextEngine-based subagent plan depends on surfaces that are not needed for the MVP.
Parent/child memory continuity is deferred until after the plugin decides whether to own the
ContextEngine slot.

### 3. Compaction-time mem9 preservation

MVP accepts that hook-mode compaction is lossy and does not attempt a best-effort flush before
OpenClaw summarizes history.

---

## Post-MVP ContextEngine Work

If mnemos later decides to take the `contextEngine` slot, the next proposal should answer these
questions first:

1. What concrete `compact()` behavior will mnemos own?
2. What rollout policy is acceptable for long sessions and manual `/compact`?
3. How should runtime `agentId` be preserved once writes move from hook mode to
   `ContextEngine.afterTurn()`?
4. Do we still want subagent continuity as part of the first ContextEngine release?

That future proposal can reuse the verified upstream contract documented above, but it should be a
separate design, not implied by this MVP.

For experimentation only, if we want to observe OpenClaw's `ContextEngine` lifecycle before
building a real compactor, the preferred minimal `compact()` stub is:

```ts
async compact(): Promise<CompactResult> {
  return {
    ok: false,
    compacted: false,
    reason: "mem9 MVP: compact not implemented",
  };
}
```

Why this stub is preferred:

- it is explicit that compaction is unsupported
- it does not pretend long-session compaction succeeded
- it lets us test how OpenClaw behaves when `mem9` is selected as the active `ContextEngine`
  without silently masking the missing feature

This is an **experimental diagnostic path only**, not part of the MVP shipping scope.

---

## File Changes Summary

| File | Change | LoC | Phase |
|---|---|---|---|
| `hooks.ts` | Hook-mode `allowPromptInjection` warning, `prependSystemContext` split, `tool_result_persist` cleanup, `agent_end` context fix | ~70 | 1 |
| `types.ts` | Add `memory_type`, `agent_id`, `session_id` to `SearchInput` | ~10 | 2 |
| `server-backend.ts` | Forward `memory_type`, `agent_id`, `session_id` in `search()` | ~10 | 2 |
| `index.ts` | No ContextEngine registration changes in MVP | - | - |
| `server/` | No changes | - | - |

**All MVP work remains plugin-only. No server changes required.**

---

## Backward Compatibility

| Scenario | Behavior |
|---|---|
| OpenClaw < beta.1 | Hook mode only |
| OpenClaw beta.1+, slot unset | OpenClaw keeps using `legacy` ContextEngine; mnemos keeps using hook mode |
| Hook mode on beta.1+ without `allowPromptInjection` | Startup warning logged; `before_prompt_build` injection is suppressed by OpenClaw |
| Operator manually sets `plugins.slots.contextEngine = "mem9"` | Unsupported by this MVP |

Key clarification:

`allowPromptInjection` does not activate ContextEngine mode. Slot selection does.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Hook mode compaction remains lossy | Explicitly accept this in MVP; do not promise preservation |
| Provider-side caching gain from `prependSystemContext` varies by provider | Treat cache benefit as an optimization, not a correctness dependency |
| Overlapping smart-ingest writes add extra reconcile work | Accept this product tradeoff; server reconcile is best-effort duplicate suppression |
| `agent_end` still misses runtime identity on some hosts | Prefer hook `ctx` values when present; keep current fallback behavior when absent |

---

## Open Questions

These are refinement questions, not MVP blockers.

**Q1 — Pinned memory scope**
- Should hook-mode pinned memory lookup stay tenant-wide, or filter by `agent_id` when enough
  identity is available?

**Q2 — Hook-mode reset mitigation**
- Should `/new` / `/reset` keep the current weak summary-only behavior, or should MVP strengthen
  that path separately from compaction?

**Q3 — Post-MVP ContextEngine scope**
- If mnemos later takes the `contextEngine` slot, should the first release target only retrieval +
  ingest parity, or also subagent continuity?

---

## Recommended Sequencing

1. **Now**: land hook-safe changes only:
   - hook-mode startup warning
   - `prependSystemContext` split for pinned memories
   - `tool_result_persist` cleanup using the real beta.1 payload shape
   - `agent_end` identity fix using hook context
2. **Then**: add plugin search filter support:
   - `memory_type`
   - `agent_id`
   - `session_id`
3. **Do not**: register or recommend `mem9` as the active ContextEngine in this MVP
4. **Later**: write a separate proposal if mnemos decides to own `compact()` and take the
   `contextEngine` slot

The result is intentionally narrow:

- hook mode gets safer immediately
- MVP stays within mnemos' actual ownership boundary
- ContextEngine work is deferred instead of being half-implemented
