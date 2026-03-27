import {
  PIXEL_FARM_GENERATED_COLLISIONS,
  PIXEL_FARM_GENERATED_LAYERS,
  PIXEL_FARM_GENERATED_OBJECT_GROUPS,
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

export interface PixelFarmObjectPlacement {
  id: string;
  layerId: string;
  sourceId: PixelFarmAssetSourceId;
  frame: number;
  row: number;
  column: number;
  groupId?: string;
}

export interface PixelFarmObjectGroup {
  id: string;
  sortRow: number;
  sortColumn: number;
}

export interface PixelFarmCollisionCell {
  id: string;
  halfTileRow: number;
  halfTileColumn: number;
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

function normalizeObjectGroups(): PixelFarmObjectGroup[] {
  const seen = new Set<string>();

  return Array.from(PIXEL_FARM_GENERATED_OBJECT_GROUPS as readonly unknown[]).map((value, index) => {
    const group = value as PixelFarmObjectGroup;
    if (!group.id) {
      throw new Error(`Pixel farm object group at index ${index} is missing an id.`);
    }

    if (seen.has(group.id)) {
      throw new Error(`Pixel farm object group id "${group.id}" must be unique.`);
    }

    if (
      !Number.isInteger(group.sortRow) ||
      group.sortRow < 0 ||
      !Number.isInteger(group.sortColumn) ||
      group.sortColumn < 0
    ) {
      throw new Error(`Pixel farm object group "${group.id}" must use non-negative integer sort coordinates.`);
    }

    seen.add(group.id);
    return {
      id: group.id,
      sortRow: group.sortRow,
      sortColumn: group.sortColumn,
    };
  });
}

function normalizeObjects(
  layerIDs: readonly string[],
  objectGroups: readonly PixelFarmObjectGroup[],
): PixelFarmObjectPlacement[] {
  const groupIDs = new Set(objectGroups.map((group) => group.id));

  return Array.from(PIXEL_FARM_GENERATED_OBJECTS as readonly unknown[]).map((value, index) => {
    const object = value as {
      id: string;
      layerId: string;
      sourceId: PixelFarmAssetSourceId;
      frame: number;
      row: number;
      column: number;
      groupId?: string;
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

    if (object.groupId !== undefined && !groupIDs.has(object.groupId)) {
      throw new Error(`Pixel farm object "${object.id}" references unknown group "${object.groupId}".`);
    }

    return {
      id: object.id,
      layerId: object.layerId,
      sourceId: object.sourceId,
      frame: object.frame,
      row: object.row,
      column: object.column,
      groupId: object.groupId,
    };
  });
}

function normalizeCollisions(): PixelFarmCollisionCell[] {
  const seen = new Set<string>();

  return Array.from(PIXEL_FARM_GENERATED_COLLISIONS as readonly unknown[]).map((value, index) => {
    const cell = value as PixelFarmCollisionCell;
    if (!cell.id) {
      throw new Error(`Pixel farm collision at index ${index} is missing an id.`);
    }

    if (seen.has(cell.id)) {
      throw new Error(`Pixel farm collision id "${cell.id}" must be unique.`);
    }

    if (
      !Number.isInteger(cell.halfTileRow) ||
      cell.halfTileRow < 0 ||
      !Number.isInteger(cell.halfTileColumn) ||
      cell.halfTileColumn < 0
    ) {
      throw new Error(`Pixel farm collision "${cell.id}" must use non-negative quarter-grid coordinates.`);
    }

    seen.add(cell.id);
    return {
      id: cell.id,
      halfTileRow: cell.halfTileRow,
      halfTileColumn: cell.halfTileColumn,
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
export const PIXEL_FARM_OBJECT_GROUPS = normalizeObjectGroups();
export const PIXEL_FARM_OBJECTS = normalizeObjects(PIXEL_FARM_LAYER_IDS, PIXEL_FARM_OBJECT_GROUPS);
export const PIXEL_FARM_COLLISIONS = normalizeCollisions();

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
