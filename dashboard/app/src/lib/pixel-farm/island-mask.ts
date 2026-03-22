import {
  PIXEL_FARM_GENERATED_LAYERS,
  PIXEL_FARM_GENERATED_OBJECTS,
} from "@/lib/pixel-farm/generated-mask-data";
import type {
  PixelFarmAssetSourceId,
  PixelFarmAssetTileSelection,
} from "@/lib/pixel-farm/tileset-config";

export interface PixelFarmTileOverride extends PixelFarmAssetTileSelection {
  stamped?: boolean;
}
export type PixelFarmTileOverrideMap = Record<string, PixelFarmTileOverride>;

export interface PixelFarmLayer {
  id: string;
  label: string;
  baseTile: PixelFarmAssetTileSelection;
  mask: readonly string[];
  overrides: PixelFarmTileOverrideMap;
}

export interface PixelFarmObjectFootprint {
  rows: number;
  columns: number;
}

export interface PixelFarmObjectPlacement {
  id: string;
  layerId: string;
  sourceId: PixelFarmAssetSourceId;
  frame: number;
  row: number;
  column: number;
  footprint: PixelFarmObjectFootprint;
  walkable: boolean;
}

export interface PixelFarmMaskBounds {
  minColumn: number;
  maxColumn: number;
  minRow: number;
  maxRow: number;
  width: number;
  height: number;
}

function validateMask(mask: readonly string[], expectedColumns?: number, expectedRows?: number): number {
  const columns = mask[0]?.length ?? 0;
  if (expectedRows !== undefined && mask.length !== expectedRows) {
    throw new Error("Pixel farm layer masks must share the same height.");
  }

  if (expectedColumns !== undefined && columns !== expectedColumns) {
    throw new Error("Pixel farm layer masks must share the same width.");
  }

  for (const row of mask) {
    if (row.length !== columns) {
      throw new Error("Pixel farm mask rows must share the same width.");
    }
  }

  return columns;
}

function normalizeLayers(): PixelFarmLayer[] {
  const generatedLayers = [...PIXEL_FARM_GENERATED_LAYERS];
  if (generatedLayers.length < 1) {
    throw new Error("Pixel farm must define at least one layer.");
  }

  const root = generatedLayers[0]!;
  const expectedColumns = validateMask(root.mask);
  const expectedRows = root.mask.length;
  const seen = new Set<string>();

  return generatedLayers.map((layer, index) => {
    if (!layer.id) {
      throw new Error(`Pixel farm layer at index ${index} is missing an id.`);
    }

    if (seen.has(layer.id)) {
      throw new Error(`Pixel farm layer id "${layer.id}" must be unique.`);
    }

    seen.add(layer.id);
    validateMask(layer.mask, expectedColumns, expectedRows);

    return {
      id: layer.id,
      label: layer.label,
      baseTile: layer.baseTile,
      mask: layer.mask,
      overrides: layer.overrides as PixelFarmTileOverrideMap,
    };
  });
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
    throw new Error("Pixel farm root layer must contain at least one filled cell.");
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

function normalizeObjects(layerIDs: readonly string[]): PixelFarmObjectPlacement[] {
  return Array.from(PIXEL_FARM_GENERATED_OBJECTS as readonly unknown[]).map((value, index) => {
    const object = value as {
      id: string;
      layerId: string;
      sourceId: PixelFarmAssetSourceId;
      frame: number;
      row: number;
      column: number;
      footprint: PixelFarmObjectFootprint;
      walkable: boolean;
    };
    if (!object.id) {
      throw new Error(`Pixel farm object at index ${index} is missing an id.`);
    }

    if (!layerIDs.includes(object.layerId)) {
      throw new Error(`Pixel farm object "${object.id}" references unknown layer "${object.layerId}".`);
    }

    if (object.row < 0 || object.column < 0) {
      throw new Error(`Pixel farm object "${object.id}" must use non-negative coordinates.`);
    }

    if (object.footprint.rows < 1 || object.footprint.columns < 1) {
      throw new Error(`Pixel farm object "${object.id}" must use a positive footprint.`);
    }

    return {
      id: object.id,
      layerId: object.layerId,
      sourceId: object.sourceId,
      frame: object.frame,
      row: object.row,
      column: object.column,
      footprint: {
        rows: object.footprint.rows,
        columns: object.footprint.columns,
      },
      walkable: object.walkable,
    };
  });
}

export const PIXEL_FARM_LAYERS = normalizeLayers();
export type PixelFarmLayerId = string;
export const PIXEL_FARM_LAYER_IDS = PIXEL_FARM_LAYERS.map((layer) => layer.id);
export const PIXEL_FARM_ROOT_LAYER = PIXEL_FARM_LAYERS[0]!;
export const PIXEL_FARM_MASK_COLUMNS = PIXEL_FARM_ROOT_LAYER.mask[0]?.length ?? 0;
export const PIXEL_FARM_MASK_ROWS = PIXEL_FARM_ROOT_LAYER.mask.length;
export const PIXEL_FARM_MASK_BOUNDS = measureMask(PIXEL_FARM_ROOT_LAYER.mask);
export const PIXEL_FARM_OBJECTS = normalizeObjects(PIXEL_FARM_LAYER_IDS);

export function maskHasTile(mask: readonly string[], row: number, column: number): boolean {
  return mask[row]?.[column] === "#";
}

export function tileOverrideKey(row: number, column: number): string {
  return `${row}:${column}`;
}

export function tileOverrideAt(
  overrides: Readonly<PixelFarmTileOverrideMap>,
  row: number,
  column: number,
): PixelFarmTileOverride | null {
  const tile = overrides[tileOverrideKey(row, column)];
  if (
    !tile ||
    typeof tile !== "object" ||
    typeof tile.sourceId !== "string" ||
    typeof tile.frame !== "number" ||
    (tile.stamped !== undefined && typeof tile.stamped !== "boolean")
  ) {
    return null;
  }

  return tile;
}

export function objectOccupiesCell(
  object: PixelFarmObjectPlacement,
  row: number,
  column: number,
): boolean {
  return (
    row >= object.row &&
    row < object.row + object.footprint.rows &&
    column >= object.column &&
    column < object.column + object.footprint.columns
  );
}
