import { describe, expect, it } from "vitest";
import {
  computeCanvasBounds,
  layoutLaneAnchors,
  layoutLaneColumn,
  packRootBubbles,
  resolveLaneNodeDrop,
  resolveRootBubbleDrop,
} from "./memory-insight-layout";

function rectsOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
  gap = 12,
): boolean {
  return !(
    left.x + left.width + gap <= right.x ||
    right.x + right.width + gap <= left.x ||
    left.y + left.height + gap <= right.y ||
    right.y + right.height + gap <= left.y
  );
}

describe("memory-insight-layout", () => {
  it("packs root bubbles without overlap and preserves gutter", () => {
    const items = [
      { id: "project", diameter: 46, width: 92, height: 84 },
      { id: "communication", diameter: 42, width: 92, height: 80 },
      { id: "profile", diameter: 40, width: 88, height: 78 },
      { id: "plan", diameter: 36, width: 88, height: 74 },
      { id: "debugging", diameter: 34, width: 88, height: 72 },
    ];

    const layout = packRootBubbles({
      items,
      width: 420,
    });

    for (let index = 0; index < items.length; index += 1) {
      for (let compareIndex = index + 1; compareIndex < items.length; compareIndex += 1) {
        const left = items[index]!;
        const right = items[compareIndex]!;
        expect(
          rectsOverlap(
            { ...layout.positions[left.id]!, width: left.width, height: left.height },
            { ...layout.positions[right.id]!, width: right.width, height: right.height },
            18,
          ),
        ).toBe(false);
      }
    }

    expect(layout.height).toBeGreaterThanOrEqual(240);
  });

  it("uses available width to spread root bubbles across a wider region", () => {
    const items = [
      { id: "project", diameter: 46, width: 92, height: 84 },
      { id: "communication", diameter: 42, width: 92, height: 80 },
      { id: "profile", diameter: 40, width: 88, height: 78 },
      { id: "plan", diameter: 36, width: 88, height: 74 },
      { id: "debugging", diameter: 34, width: 88, height: 72 },
      { id: "policy", diameter: 32, width: 88, height: 70 },
    ];

    const layout = packRootBubbles({
      items,
      width: 860,
    });

    const maxX = Math.max(...items.map((item) => layout.positions[item.id]!.x));
    expect(maxX).toBeGreaterThan(420);
  });

  it("resolves root bubble drops to a valid nearby non-overlapping position", () => {
    const position = resolveRootBubbleDrop({
      id: "plan",
      position: { x: 40, y: 40 },
      diameter: 36,
      blockWidth: 88,
      blockHeight: 74,
      width: 420,
      siblings: [
        { id: "project", x: 24, y: 24, diameter: 46, width: 92, height: 84 },
        { id: "communication", x: 256, y: 24, diameter: 36, width: 88, height: 74 },
      ],
    });

    expect(
      rectsOverlap(
        { x: position.x, y: position.y, width: 88, height: 74 },
        { x: 24, y: 24, width: 92, height: 84 },
        18,
      ),
    ).toBe(false);
    expect(position.y).toBeGreaterThanOrEqual(24);
  });

  it("lays out lane columns without overlapping cards", () => {
    const items = [
      { id: "tag-a", width: 196, height: 92 },
      { id: "tag-b", width: 196, height: 92 },
      { id: "tag-c", width: 196, height: 92 },
    ];

    const layout = layoutLaneColumn({
      items,
      width: 240,
    });

    for (let index = 0; index < items.length; index += 1) {
      for (let compareIndex = index + 1; compareIndex < items.length; compareIndex += 1) {
        const left = items[index]!;
        const right = items[compareIndex]!;
        expect(
          rectsOverlap(
            { ...layout.positions[left.id]!, width: left.width, height: left.height },
            { ...layout.positions[right.id]!, width: right.width, height: right.height },
          ),
        ).toBe(false);
      }
    }

    expect(layout.height).toBeGreaterThan(96);
  });

  it("resolves lane drops away from overlapping siblings", () => {
    const position = resolveLaneNodeDrop({
      id: "tag-c",
      position: { x: 12, y: 24 },
      width: 196,
      height: 92,
      columnWidth: 240,
      siblings: [
        { id: "tag-a", x: 12, y: 12, width: 196, height: 92 },
        { id: "tag-b", x: 12, y: 116, width: 196, height: 92 },
      ],
    });

    expect(
      rectsOverlap(
        { x: position.x, y: position.y, width: 196, height: 92 },
        { x: 12, y: 12, width: 196, height: 92 },
      ),
    ).toBe(false);
    expect(position.y).toBeGreaterThan(116);
  });

  it("stacks lane anchors vertically without overlap", () => {
    const layout = layoutLaneAnchors({
      laneIds: ["project", "activity", "profile"],
      startX: 520,
      startY: 28,
      laneHeights: [220, 280, 240],
      gap: 32,
    });

    expect(layout.positions.project).toEqual({ x: 520, y: 28 });
    expect(layout.positions.activity!.y).toBeGreaterThan(
      layout.positions.project!.y + layout.heights.project!,
    );
    expect(layout.positions.profile!.y).toBeGreaterThan(
      layout.positions.activity!.y + layout.heights.activity!,
    );
  });

  it("computes shared canvas bounds from roots, lanes, and nodes", () => {
    const bounds = computeCanvasBounds({
      leftRegionWidth: 400,
      leftRegionHeight: 640,
      laneWidth: 820,
      laneAnchors: {
        project: { x: 520, y: 28 },
        activity: { x: 520, y: 300 },
      },
      laneHeights: {
        project: 220,
        activity: 260,
      },
      nodes: [
        { x: 24, y: 24, width: 180, height: 180 },
        { x: 1280, y: 320, width: 268, height: 122 },
      ],
      viewportWidth: 1100,
      viewportHeight: 520,
    });

    expect(bounds.width).toBeGreaterThan(1500);
    expect(bounds.height).toBeGreaterThan(640);
  });
});
