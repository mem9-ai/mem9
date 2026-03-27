---
title: "Proposal: Time-Aware Memory Recall"
status: implemented
created: 2026-03-14
last_updated: 2026-03-25
---

> **STATUS: IMPLEMENTED** (PR #83, fix #108)
> `relativeAge()` and `populateRelativeAge()` are in `service/memory.go`.
> `RelativeAge` field is populated on both search and list (no-query) paths.
> `Memory.RelativeAge` is in `domain/types.go`.

# Proposal: Time-Aware Memory Recall

**Date:** 2026-03-14
**Author:** Cleo
**Based on:** Shenjun's suggestion

---

## Problem Statement

The current `before_prompt_build` recall logic ranks results purely by **vector similarity**:

```ts
const result = await backend.search({ q: prompt, limit: MAX_INJECT });
```

This has several issues:

1. **Temporal blindness** — Two similar memories ("I live in Beijing" vs "I live in Shanghai") give the model no signal about which is more recent.
2. **Absolute timestamps have no semantic value** — Returning `created_at: "2024-03-01T00:00:00Z"` is nearly meaningless to the model.
3. **Old memories carry the same weight as new ones** — There is no mechanism to bias the model toward fresher information.

---

## Proposed Changes

### Core Idea

**No API changes.** Hybrid sort becomes the default behavior, built into the server:

1. Vector search top-(N×2) to preserve a relevance base.
2. Re-rank by `updated_at` descending so newer memories surface first.
3. Truncate to `limit`.
4. Attach `relative_age` to each memory (computed server-side, e.g. `"3 days ago"`).

The model receives context like:

```
[Knowledge]
1. (3 days ago) I live in Shanghai
2. (1 year ago) I live in Beijing
```

It naturally concludes that Shanghai is current and Beijing is stale. Conflict resolution is delegated entirely to the LLM.

---

## Changes

### Plugin Side

**`types.ts`** — Add `relative_age` field (~4 LOC)

```ts
export interface Memory {
  // ... existing fields ...
  relative_age?: string;  // e.g. "3 days ago", computed server-side at query time
}
```

**`hooks.ts`** — Include time hint in `formatMemoriesBlock` (~15 LOC)

```ts
function formatMemoriesBlock(memories: Memory[]): string {
  const lines = memories.map((m, i) => {
    const age = m.relative_age ? `(${m.relative_age}) ` : "";
    return `${i + 1}. ${age}${m.content}`;
  });
  return `<relevant-memories>\n[Knowledge]\n${lines.join("\n")}\n</relevant-memories>`;
}
```

### Server Side (Go, ~80 LOC)

**Updated search flow:**

```
1. Vector search top-(limit * 2)
2. Sort by updated_at descending
3. Truncate to limit
4. Compute relative_age for each memory
5. Return
```

**`relative_age` formatting:**

```go
func relativeAge(t time.Time) string {
    d := time.Since(t)
    switch {
    case d < time.Hour:
        return fmt.Sprintf("%d minutes ago", int(d.Minutes()))
    case d < 24*time.Hour:
        return fmt.Sprintf("%d hours ago", int(d.Hours()))
    case d < 7*24*time.Hour:
        return fmt.Sprintf("%d days ago", int(d.Hours()/24))
    case d < 30*24*time.Hour:
        return fmt.Sprintf("%d weeks ago", int(d.Hours()/(24*7)))
    case d < 365*24*time.Hour:
        return fmt.Sprintf("%d months ago", int(d.Hours()/(24*30)))
    default:
        return fmt.Sprintf("%d years ago", int(d.Hours()/(24*365)))
    }
}
```

---

## LOC Summary

| Location | File | Est. LOC |
|---|---|---|
| `Memory.relative_age` field | `types.ts` | ~4 |
| Time hint in `formatMemoriesBlock` | `hooks.ts` | ~15 |
| Hybrid sort + `relative_age` computation | server (Go) | ~80 |
| **Total** | | **~99 LOC** |

> Excludes tests. Add ~60 LOC for unit tests.

---

## Design Decisions

- **No `sort` parameter** — Hybrid sort is the default and only behavior; no toggle needed.
- **`relative_age` computed server-side** — Ensures a single clock source; enables future i18n formatting.
- **Recall 2x then truncate** — Preserves a sufficient relevance base so that highly relevant older memories are not lost to pure recency ranking.

---

## Why This Works

LLMs understand `"3 days ago"` vs `"1 year ago"` far better than raw ISO timestamps.  
The system layer does not need explicit conflict-resolution logic — it passes temporal context transparently and lets the model apply its natural language understanding.  
The change is small (<100 LOC) but meaningfully improves recall quality for frequently updated user facts (location, preferences, status).
