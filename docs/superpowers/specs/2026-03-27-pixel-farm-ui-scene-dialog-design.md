# Pixel Farm UI Scene Dialog Design

Date: 2026-03-27
Area: `dashboard/app`
Status: Approved for spec review

## Goal

Replace the current React overlay interaction bubble in Pixel Farm with a Phaser UI scene dialog system that:

- uses the new pixel-art dialog asset
- follows the interaction target by default
- falls back to a safe on-screen position when the dialog would clip
- supports typewriter text, explicit paging, and multi-message navigation
- keeps pixel rendering sharp and behavior deterministic

This work is limited to the Pixel Farm interaction dialog. It does not change world interaction rules, memory loading rules, or the dashboard data API.

## Current State

Today the dialog is rendered by React in
[`dashboard/app/src/components/pixel-farm/interaction-bubble.tsx`](/Users/zou/workspace/tidbcloud/mem9/dashboard/app/src/components/pixel-farm/interaction-bubble.tsx)
and mounted from
[`dashboard/app/src/components/pixel-farm/phaser-stage.tsx`](/Users/zou/workspace/tidbcloud/mem9/dashboard/app/src/components/pixel-farm/phaser-stage.tsx).

The Phaser world scene already computes interaction focus, tracks `interactionNonce`, and exposes a screen-space anchor through
[`dashboard/app/src/lib/pixel-farm/create-game.ts`](/Users/zou/workspace/tidbcloud/mem9/dashboard/app/src/lib/pixel-farm/create-game.ts).

This means the missing piece is not interaction detection. The missing piece is a Phaser-native presentation layer.

## Asset Assessment

Asset:
[`dashboard/app/src/assets/ui/dialog-box.png`](/Users/zou/workspace/tidbcloud/mem9/dashboard/app/src/assets/ui/dialog-box.png)

Observed structure:

- image size is `48 x 48`
- non-transparent body area is roughly `x=11..36, y=11..38`
- the left-bottom tail extends roughly `x=7..10, y=21..30`

Conclusion:

- the body can be used as a 9-slice source
- the tail must be separated from the body and rendered as an independent sprite
- the current asset supports discrete tail orientations well enough for `bottom-left` and `bottom-right` via horizontal flip
- the current asset is not suitable for arbitrary-angle tail rotation

Initial slicing contract:

- body source rect: `x=11, y=11, width=26, height=28`
- tail source rect: `x=7, y=21, width=4, height=10`
- body 9-slice insets: `4, 4, 4, 4`

These numbers are implementation defaults, not an external API. They can be adjusted after visual verification if the corner thickness needs correction by 1 pixel.

## Options Considered

### Option A: Keep the React overlay and reskin it

Pros:

- smallest code change
- no Phaser UI work

Cons:

- duplicates UI ownership across React and Phaser
- makes camera-follow, clipping, and pixel alignment harder to maintain
- blocks clean implementation of keyboard input and dialog-local animation

### Option B: Add a dedicated Phaser UI scene and build the dialog there

Pros:

- clean separation between world logic and UI presentation
- best fit for pixel-art rendering and scene-local input
- makes typewriter, paging, and edge avoidance straightforward

Cons:

- requires scene orchestration and some new UI code

### Option C: Render dialog with a custom texture or render texture pipeline

Pros:

- maximum control over final pixels

Cons:

- too much complexity for this scope
- unnecessary before the simpler composition model is exhausted

## Decision

Choose Option B.

Add a dedicated Phaser UI scene and move the interaction dialog fully into Phaser. Remove the React overlay bubble once the Phaser dialog is live.

## Architecture

Two scenes will own separate concerns:

- `pixel-farm-sandbox`
  - world simulation
  - interaction targeting
  - anchor calculation in world and screen space
  - memory selection trigger
- `pixel-farm-ui`
  - dialog rendering
  - dialog animation
  - page splitting and typewriter behavior
  - dialog input handling
  - safe-area fallback placement

React remains the host for the Phaser game only. React should no longer render the interaction bubble UI.

## Data Flow

### From world scene to UI scene

The world scene will publish a dialog payload when interaction focus changes or when the user advances the selected memory.

The payload should include:

- `targetId`
- `animalInstanceId | null`
- `interactionNonce`
- `tagKey`
- `tagLabel`
- `memoryIds`
- `memoryIndex`
- `memories`
- `anchorWorldX`
- `anchorWorldY`
- `anchorScreenX`
- `anchorScreenY`

The current `screenX` and `screenY` debug values are a good start, but the UI scene should receive both world and screen anchors. World coordinates allow recomputing placement during camera movement without requiring React to re-bridge state every frame.

### From React host to Phaser

`phaser-stage.tsx` should stop mounting the bubble component. It should only:

- create the Phaser game
- pass memory resolver callbacks into the world scene
- surface boot errors if needed

### Between scenes

The simplest communication model is direct scene calls through the Phaser scene manager:

- sandbox scene owns interaction truth
- sandbox scene gets a typed handle to the UI scene
- sandbox scene pushes dialog open, update, advance, and close commands to the UI scene

No event bus is needed for this scope.

## UI Composition

The dialog is a Phaser container composed from:

- a 9-slice body assembled from 9 images
- a tail sprite
- a header label for `tagLabel`
- a page counter
- a content text object
- left and right arrow buttons
- an optional continue indicator when more text remains

Do not introduce a third-party 9-slice dependency. Build the 9-slice body manually from texture frames. The control surface is small, and manual composition is easier to debug and keep pixel-perfect.

## Layout Rules

### Default placement

- place the dialog above the target
- horizontally center it on the anchor unless screen bounds force a shift
- place the tail on the bottom edge

### Safe-area fallback

When the dialog would exceed a screen safety margin, move it into a screen-safe slot.

Safety defaults:

- horizontal margin: `16px`
- top margin: `16px`
- bottom margin: `24px`

Fallback priority:

1. top-center
2. top-left
3. top-right

When fallback mode is active:

- keep the tail visible
- snap the tail to discrete positions on the bottom edge
- choose `bottom-left` or `bottom-right` based on target direction relative to the dialog center

The tail should indicate direction, not exact ray intersection. Readability wins over geometric precision.

## Text Behavior

### Height and paging

Use a mixed model:

- grow the dialog vertically until a configured max content height
- if content still does not fit, split the text into multiple pages

The split unit should prefer sentence or clause boundaries when possible. If no clean boundary exists, split by measured text fit.

### Typewriter

Each page opens with a typewriter animation.

Rules:

- clicking the dialog while the current page is still typing completes the current page instantly
- clicking again advances to the next page
- advancing to a different memory resets the typewriter state to page 1 of that memory

### Navigation

Support all of the following:

- click dialog body: complete typing or advance
- left button: previous memory or previous page when appropriate
- right button: next page, then next memory
- keyboard `Enter` and `Space`: same as primary advance
- keyboard `ArrowLeft` and `ArrowRight`: previous and next memory/page

The exact previous-page versus previous-memory priority is:

- if the current memory has multiple pages and the current page index is greater than 0, go to previous page
- otherwise go to previous memory

The exact next-page versus next-memory priority is:

- if the current memory has more pages, go to next page
- otherwise go to next memory

## Sizing

Dialog width should use a bounded responsive width in screen pixels:

- preferred width: around `320px`
- minimum width: around `220px`
- maximum width: min(`360px`, viewport width minus safety margins)

The final values can be tuned during implementation, but the key constraint is that width is screen-space UI width, not world-space size.

## Rendering Rules

- keep UI scene fixed to screen space
- use pixel rounding for container position and child positions
- disable smoothing for the UI texture path the same way the world scene keeps pixel art sharp
- treat the dialog as top-most UI in the Phaser stack

## Input Ownership

The UI scene owns dialog input while a dialog is visible.

Scope:

- keyboard navigation for dialog pages and memories
- pointer interaction on the dialog body and arrow buttons

World controls should remain active unless they directly conflict with dialog input. The only required conflict rule for this scope is that dialog pointer hits should not accidentally leak into UI button clicks. No broader modal freeze is required.

## Failure Handling

- if a target resolves with zero memories, do not open a dialog
- if the target disappears while the dialog is open, close the dialog cleanly
- if the camera moves while the dialog is anchored above target, recompute placement each frame or on camera update
- if the UI scene is unavailable during startup, fail closed and keep the game playable without the dialog rather than crashing the world scene

## Files Likely To Change

- [`dashboard/app/src/lib/pixel-farm/create-game.ts`](/Users/zou/workspace/tidbcloud/mem9/dashboard/app/src/lib/pixel-farm/create-game.ts)
- [`dashboard/app/src/lib/pixel-farm/runtime-assets.ts`](/Users/zou/workspace/tidbcloud/mem9/dashboard/app/src/lib/pixel-farm/runtime-assets.ts)
- [`dashboard/app/src/components/pixel-farm/phaser-stage.tsx`](/Users/zou/workspace/tidbcloud/mem9/dashboard/app/src/components/pixel-farm/phaser-stage.tsx)

Files likely to be added:

- `dashboard/app/src/lib/pixel-farm/ui-scene.ts`
- `dashboard/app/src/lib/pixel-farm/ui-dialog.ts`
- optional small text pagination helper if the dialog file becomes too large

## Testing

Minimum verification:

- dialog opens on interaction and closes cleanly
- dialog follows target when anchored in-world
- dialog falls back inside safe area near screen edges
- typewriter can be skipped with one click
- long content paginates instead of overflowing
- left and right controls work with both pointer and keyboard
- tail flips correctly between left and right variants
- camera zoom and resize preserve valid placement

Testing mix:

- focused unit tests for text paging and placement heuristics
- targeted integration coverage around scene dialog state transitions where practical
- manual visual verification in the Pixel Farm route for final pixel quality

## Out Of Scope

- arbitrary-angle tail rendering
- branching dialog trees
- dialog portraits
- localization-specific typography tuning
- modal pause system for world simulation

## Implementation Notes

- prefer a small typed dialog controller over broad shared state
- keep page splitting logic pure and testable
- keep the manual 9-slice helper isolated so it does not bleed into unrelated UI code
- remove the old React bubble once Phaser UI is verified to avoid dual implementations

## Self-Review

- No placeholders remain.
- Scope is limited to one dialog system and does not expand into a general UI framework.
- Tail behavior is intentionally discrete and matches the current asset constraint.
- The architecture, input rules, and fallback strategy are consistent with the approved design.
