import { describe, expect, it } from "vitest";
import {
  computePixelFarmDialogPlacement,
  type PixelFarmDialogPlacementInput,
} from "./ui-dialog-layout";

function createInput(
  overrides: Partial<PixelFarmDialogPlacementInput> = {},
): PixelFarmDialogPlacementInput {
  return {
    viewportWidth: 1280,
    viewportHeight: 720,
    anchorX: 640,
    anchorY: 260,
    dialogWidth: 320,
    dialogHeight: 140,
    marginX: 16,
    marginTop: 16,
    marginBottom: 24,
    offsetAboveAnchor: 18,
    ...overrides,
  };
}

describe("computePixelFarmDialogPlacement", () => {
  it("keeps the dialog above the target when the rect fits", () => {
    const placement = computePixelFarmDialogPlacement(createInput());

    expect(placement.mode).toBe("anchor");
    expect(placement.tail).toBe("bottom-left");
    expect(placement.x).toBe(480);
    expect(placement.y).toBe(102);
  });

  it("falls back into the safe area when the anchored rect would clip the top edge", () => {
    const placement = computePixelFarmDialogPlacement(
      createInput({ anchorY: 48 }),
    );

    expect(placement.mode).toBe("safe-area");
    expect(placement.x).toBe(480);
    expect(placement.y).toBe(16);
  });

  it("flips the tail when the target sits to the right of the fallback dialog center", () => {
    const placement = computePixelFarmDialogPlacement(
      createInput({ anchorX: 1180, anchorY: 40 }),
    );

    expect(placement.mode).toBe("safe-area");
    expect(placement.tail).toBe("bottom-right");
  });

  it("uses the top center safe slot before edge-aligned fallback positions", () => {
    const placement = computePixelFarmDialogPlacement(
      createInput({ anchorX: 80, anchorY: 60 }),
    );

    expect(placement.mode).toBe("safe-area");
    expect(placement.x).toBe(480);
    expect(placement.y).toBe(16);
    expect(placement.tail).toBe("bottom-left");
  });
});
