# Pixel Farm interaction tolerance and hot-path performance design

Date: 2026-03-26
Topic: pixel-farm-interaction-performance

## Context

Pixel Farm interaction bubbles currently require the character to target only the single tile directly in front of the facing direction. This feels too strict when the character is visually overlapping the same target tile. At the same time, walking near interactable crops and animals now causes visible frame drops, which points to interaction-selection work running too often on the movement hot path.

Relevant files:
- `dashboard/app/src/lib/pixel-farm/create-game.ts`
- `dashboard/app/src/lib/pixel-farm/world-render.ts`

Current behavior observed from the code:
- `readInteractionSelectionState()` recomputes candidate selection from scratch.
- `collectInteractionCandidates()` linearly scans all interactable targets.
- Each target calls `getOccupiedCells()` during selection.
- Candidate matching only considers `frontTile`, not the current standing tile.
- `world-render.ts` rebuilds `interactableTargets` during render, but there is no lightweight revision signal for consumers.

## Goals

1. Allow interaction when the target occupies either:
   - the tile directly in front of the character, or
   - the character's current tile.
2. Preserve current feel by keeping the front tile as the higher-priority interaction zone.
3. Reduce frame drops when moving near crops/animals by removing avoidable per-frame interaction recomputation.
4. Keep changes minimal and localized. Do not redesign the renderer or interaction model beyond what is needed.

## Non-goals

- No full spatial index in the first pass.
- No changes to memory resolution, bubble UI content, or data model.
- No behavior change for interaction fallback timing other than preserving existing `recentInteractionFocus` behavior.
- No unrelated renderer refactors.

## Recommended approach

### 1. Expand the interaction hit rule

Keep the existing basis calculation in `create-game.ts` that derives:
- `currentTile`
- `frontTile`
- facing vector
- interaction origin

Change candidate collection to evaluate an ordered tile list instead of only `frontTile`.

Ordered interaction tiles:
1. `frontTile`
2. `currentTile`

Rules:
- A target is eligible if any occupied cell matches either tile.
- If a target matches both tiles, keep one candidate only.
- Candidates matching `frontTile` sort ahead of candidates matching `currentTile`.
- Existing tie-break behavior remains:
  - crop before animal
  - stable fallback ordering by target id

Resulting UX:
- Standing on the same tile as a crop/animal still allows interaction.
- Facing a target in the adjacent tile still feels like the primary interaction mode.
- Mixed dense scenes remain deterministic.

### 2. Cache interaction selection by movement-facing state

The core performance problem is that interaction selection currently walks all interactable targets on the hot path. This work should become state-change-driven, but the cache must stay correct for moving animals.

Add a thin cache in `create-game.ts` keyed by only discrete values:
- `currentTile.row`
- `currentTile.column`
- `frontTile.row`
- `frontTile.column`
- renderer interaction-target revision
- dynamic animal occupancy revision

Store:
- the last input signature
- the last computed interaction selection state

Behavior:
- If the signature is unchanged, return the cached selection state.
- Recompute when the character changes tile, changes facing, the renderer target set changes, or moving-animal occupancy changes.
- If basis resolution fails, clear the cache and recent focus just as today.

This preserves the current architecture while removing repeated scans during frames where the character continues animating within the same logical interaction state, while still staying correct when animals cross into or out of the current/front interaction tiles.

### 3. Add lightweight revision signals

`world-render.ts` should expose monotonic interaction invalidation signals.

Design:
- Keep `interactableTargets` as the existing data carrier.
- Add `interactableTargetRevision` for structural target-list changes.
- Add `animalOccupancyRevision` for moving-animal tile occupancy changes.
- Expose getters such as `getInteractableTargetRevision()` and `getAnimalOccupancyRevision()`.

Structural revision rules:
- Increment whenever `interactableTargets` content may have changed, including both rebuilds and clears.
- `worldState === null` must also invalidate cached interaction selection.
- A simple incrementing `number` is sufficient.

Animal occupancy revision rules:
- Increment only when any rendered animal's occupied grid cell changes.
- The occupied-cell check must reuse the exact same sampling and grid-mapping rule already used by animal `getOccupiedCells()` so invalidation and selection stay in lockstep.
- This can be updated from the existing animal update path without introducing a full spatial index.
- `create-game.ts` should use this revision as part of the cache signature so a stationary player still sees the correct bubble when an animal walks into range.

Why this is enough:
- `create-game.ts` does not need to know how targets were rebuilt.
- Cache invalidation remains precise enough for both static crops and moving animals.
- This avoids prematurely introducing a spatial index or duplicated target ownership logic.

### 4. Preserve fallback focus behavior

Keep `INTERACTION_FOCUS_FALLBACK_MS` unchanged.

Keep `recentInteractionFocus` behavior for ordinary momentary focus gaps, but clear it immediately when:
- `interactableTargetRevision` changes,
- `worldState === null`, or
- cached interaction basis cannot be resolved.

Reason:
- This preserves the existing short tolerance during stable target lifetimes.
- Structural target rebuilds replace target objects, so retaining the old focus across a revision risks pointing at stale targets for up to the fallback window.
- Clearing on structural invalidation keeps the fallback mechanic and the rebuilt target list consistent.

## Implementation outline

### `dashboard/app/src/lib/pixel-farm/create-game.ts`

Planned edits:
- Introduce a small interaction-selection cache type.
- Update `readInteractionSelectionState()` to:
  - compute basis
  - derive renderer revision
  - derive input signature
  - reuse cached state when unchanged
  - otherwise compute and store a fresh state
- Refactor `collectInteractionCandidates()` to accept ordered candidate tiles instead of a single tile.
- Add candidate metadata for matched tile priority so sorting can prefer `frontTile` over `currentTile`.
- Deduplicate targets that match both tiles.

### `dashboard/app/src/lib/pixel-farm/world-render.ts`

Planned edits:
- Add `interactableTargetRevision` field.
- Add `animalOccupancyRevision` field.
- Increment `interactableTargetRevision` whenever the renderer clears or rebuilds interactable targets.
- Increment `animalOccupancyRevision` when any rendered animal changes occupied grid cell.
- Expose getters for both revisions.

## Alternatives considered

### A. Minimal rule-only patch

Only allow `currentTile` in addition to `frontTile`, with no caching.

Why not recommended:
- Fixes feel, but not the observed frame drops.
- Leaves hot-path linear scans untouched.

### B. Full cell-to-target spatial index

Build a permanent index from occupied cells to targets.

Why deferred:
- Faster at scale, but more moving parts.
- Requires more synchronization between target rebuilds and lookup state.
- Not necessary unless the cache-based first pass still leaves visible drops.

## Risks

1. **Stale cache**
   - If cache invalidation misses renderer changes or moving-animal occupancy changes, bubbles may lag behind world state.
   - Mitigation: include both renderer revision and animal occupancy revision in the cache signature.

2. **Selection instability in dense areas**
   - If multiple targets overlap current/front tiles, bubble selection may flicker.
   - Mitigation: deterministic priority order: front tile > current tile > crop > animal > id.

3. **Behavior drift from current interaction feel**
   - Too much tolerance could make interaction feel sloppy.
   - Mitigation: only add same-tile tolerance; keep front tile first.

## Verification plan

### Static
- Run `cd dashboard/app && pnpm typecheck`

### Runtime
- Open `/your-memory/labs/memory-farm`
- Walk into crops until the character shares the same tile footprint and confirm the bubble still appears.
- Face a target in front and confirm it still takes precedence over the same-tile target.
- Walk through dense crop and animal areas and confirm frame pacing improves noticeably.
- Confirm no new bubble flicker appears while changing facing direction in place.

## Rollout note

If visible frame drops remain after this change, the next step should be a dedicated cell-to-target lookup index rather than further broadening per-frame scans.
