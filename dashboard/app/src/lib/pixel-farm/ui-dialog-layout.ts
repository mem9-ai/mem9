export type PixelFarmDialogTail = "bottom-left" | "bottom-right";

export interface PixelFarmDialogPlacementInput {
  viewportWidth: number;
  viewportHeight: number;
  anchorX: number;
  anchorY: number;
  dialogWidth: number;
  dialogHeight: number;
  marginX: number;
  marginTop: number;
  marginBottom: number;
  offsetAboveAnchor: number;
}

export interface PixelFarmDialogPlacement {
  mode: "anchor" | "safe-area";
  x: number;
  y: number;
  tail: PixelFarmDialogTail;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isWithinBounds(
  value: number,
  min: number,
  max: number,
): boolean {
  return value >= min && value <= max;
}

function chooseTail(anchorX: number, centerX: number): PixelFarmDialogTail {
  return anchorX <= centerX ? "bottom-left" : "bottom-right";
}

function chooseSafeAreaX(input: PixelFarmDialogPlacementInput): number {
  const safeMinX = input.marginX;
  const safeMaxX = input.viewportWidth - input.marginX - input.dialogWidth;
  const centeredX = Math.round((input.viewportWidth - input.dialogWidth) * 0.5);

  if (centeredX >= safeMinX && centeredX <= safeMaxX) {
    return centeredX;
  }

  const anchoredX = Math.round(input.anchorX - input.dialogWidth * 0.5);
  return clamp(anchoredX, safeMinX, safeMaxX);
}

export function computePixelFarmDialogPlacement(
  input: PixelFarmDialogPlacementInput,
): PixelFarmDialogPlacement {
  const safeMinX = input.marginX;
  const safeMaxX = input.viewportWidth - input.marginX - input.dialogWidth;
  const safeMinY = input.marginTop;
  const safeMaxY = input.viewportHeight - input.marginBottom - input.dialogHeight;
  const anchoredX = Math.round(input.anchorX - input.dialogWidth * 0.5);
  const anchoredY = Math.round(input.anchorY - input.dialogHeight - input.offsetAboveAnchor);

  const anchoredFits =
    isWithinBounds(anchoredX, safeMinX, safeMaxX) &&
    isWithinBounds(anchoredY, safeMinY, safeMaxY);

  if (anchoredFits) {
    const centerX = anchoredX + input.dialogWidth * 0.5;
    return {
      mode: "anchor",
      x: anchoredX,
      y: anchoredY,
      tail: chooseTail(input.anchorX, centerX),
    };
  }

  const safeX = chooseSafeAreaX(input);
  const safeY = safeMinY > safeMaxY ? safeMinY : safeMinY;
  const centerX = safeX + input.dialogWidth * 0.5;

  return {
    mode: "safe-area",
    x: Math.round(safeX),
    y: Math.round(safeY),
    tail: chooseTail(input.anchorX, centerX),
  };
}
