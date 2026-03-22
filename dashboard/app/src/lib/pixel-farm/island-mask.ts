export const SOIL_MASK = [
  ".......#####################............",
  ".......########################.........",
  ".......#########################........",
  ".......##########################.......",
  "......############################......",
  ".....##############################.....",
  ".....###############################....",
  "....################################....",
  "....################################....",
  "....################################....",
  "...#################################....",
  "...#################################....",
  "...###############################......",
  "...###############################......",
  "...#################################....",
  "...#################################....",
  "....################################....",
  "....###############################.....",
  ".....##############################.....",
  ".....#############################......",
  "......############################......",
  "......##########################........",
  ".......########################.........",
  "........######################..........",
  "..........##################............",
  "............################............",
] as const;

export interface PixelFarmMaskBounds {
  minColumn: number;
  maxColumn: number;
  minRow: number;
  maxRow: number;
  width: number;
  height: number;
}

function validateMask(mask: readonly string[]): number {
  const columns = mask[0]?.length ?? 0;

  for (const row of mask) {
    if (row.length !== columns) {
      throw new Error("Pixel farm mask rows must share the same width.");
    }
  }

  return columns;
}

function measureMask(mask: readonly string[]): PixelFarmMaskBounds {
  let minColumn = Number.POSITIVE_INFINITY;
  let maxColumn = Number.NEGATIVE_INFINITY;
  let minRow = Number.POSITIVE_INFINITY;
  let maxRow = Number.NEGATIVE_INFINITY;

  for (let row = 0; row < mask.length; row += 1) {
    for (let column = 0; column < mask[row]!.length; column += 1) {
      if (mask[row]![column] !== "#") {
        continue;
      }

      minColumn = Math.min(minColumn, column);
      maxColumn = Math.max(maxColumn, column);
      minRow = Math.min(minRow, row);
      maxRow = Math.max(maxRow, row);
    }
  }

  if (!Number.isFinite(minColumn)) {
    throw new Error("Pixel farm mask must contain at least one filled cell.");
  }

  return {
    minColumn,
    maxColumn,
    minRow,
    maxRow,
    width: maxColumn - minColumn + 1,
    height: maxRow - minRow + 1,
  };
}

export const SOIL_MASK_COLUMNS = validateMask(SOIL_MASK);
export const SOIL_MASK_ROWS = SOIL_MASK.length;
export const SOIL_MASK_BOUNDS = measureMask(SOIL_MASK);

export function maskHasTile(mask: readonly string[], row: number, column: number): boolean {
  return mask[row]?.[column] === "#";
}
