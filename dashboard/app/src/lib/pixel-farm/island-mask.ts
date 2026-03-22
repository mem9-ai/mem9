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

function createEmptyMask(mask: readonly string[]): string[] {
  return mask.map((row) => ".".repeat(row.length));
}

export const GRASS_DARK_MASK = createEmptyMask(SOIL_MASK);
export const GRASS_LIGHT_MASK = createEmptyMask(SOIL_MASK);
export const PIXEL_FARM_MASK_LAYER_IDS = ["soil", "grassDark", "grassLight"] as const;

export type PixelFarmMaskLayerId = (typeof PIXEL_FARM_MASK_LAYER_IDS)[number];
export type PixelFarmTileOverrideMap = Record<string, number>;

export const PIXEL_FARM_MASKS: Record<PixelFarmMaskLayerId, readonly string[]> = {
  soil: SOIL_MASK,
  grassDark: GRASS_DARK_MASK,
  grassLight: GRASS_LIGHT_MASK,
};

export const SOIL_TILE_OVERRIDES: PixelFarmTileOverrideMap = {};
export const GRASS_DARK_TILE_OVERRIDES: PixelFarmTileOverrideMap = {};
export const GRASS_LIGHT_TILE_OVERRIDES: PixelFarmTileOverrideMap = {};

export const PIXEL_FARM_TILE_OVERRIDES: Record<PixelFarmMaskLayerId, PixelFarmTileOverrideMap> = {
  soil: SOIL_TILE_OVERRIDES,
  grassDark: GRASS_DARK_TILE_OVERRIDES,
  grassLight: GRASS_LIGHT_TILE_OVERRIDES,
};

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

export function tileOverrideKey(row: number, column: number): string {
  return `${row}:${column}`;
}

export function tileOverrideFrame(
  overrides: Readonly<PixelFarmTileOverrideMap>,
  row: number,
  column: number,
): number | null {
  const frame = overrides[tileOverrideKey(row, column)];
  return typeof frame === "number" && Number.isInteger(frame) && frame >= 0 ? frame : null;
}
