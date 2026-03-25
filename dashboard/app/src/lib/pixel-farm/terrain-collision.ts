import {
  maskHasTile,
  PIXEL_FARM_LAYERS,
  PIXEL_FARM_ROOT_LAYER,
  tileOverrideAt,
} from "@/lib/pixel-farm/island-mask";

export interface PixelFarmTerrainCell {
  row: number;
  column: number;
}

const HILL_LAYER_ID = "layer-5";
const HILL_SURFACE_SOURCE_IDS = new Set(["grassHill", "grassLight"]);
const HILL_ACCESS_SOURCE_IDS = new Set(["grassHill", "grassLight", "grassHillSlopes"]);
const TERRAIN_BLOCKING_SOURCE_IDS = new Set(["chickenHouses"]);

function cellKey(row: number, column: number): string {
  return `${row}:${column}`;
}

function cellFromKey(key: string): PixelFarmTerrainCell | null {
  const [rowValue, columnValue] = key.split(":");
  if (rowValue === undefined || columnValue === undefined) {
    return null;
  }

  const row = Number(rowValue);
  const column = Number(columnValue);
  if (!Number.isFinite(row) || !Number.isFinite(column)) {
    return null;
  }

  return { row, column };
}

function collectLayerCells(
  layerID: string,
  sourceIDs: ReadonlySet<string>,
): PixelFarmTerrainCell[] {
  const layer = PIXEL_FARM_LAYERS.find((candidate) => candidate.id === layerID);
  if (!layer) {
    return [];
  }

  return Object.entries(layer.overrides)
    .filter(([, tile]) => sourceIDs.has(tile.sourceId))
    .map(([key]) => cellFromKey(key))
    .filter((cell): cell is PixelFarmTerrainCell => cell !== null);
}

function collectBlockingTerrainCells(): PixelFarmTerrainCell[] {
  const cells: PixelFarmTerrainCell[] = [];

  for (const layer of PIXEL_FARM_LAYERS) {
    for (let row = 0; row < layer.mask.length; row += 1) {
      for (let column = 0; column < layer.mask[row]!.length; column += 1) {
        const override = tileOverrideAt(layer.overrides, row, column);
        if (!override || !TERRAIN_BLOCKING_SOURCE_IDS.has(override.sourceId)) {
          continue;
        }

        cells.push({ row, column });
      }
    }
  }

  return cells;
}

function collectHillBoundaryCells(
  hillSurfaceCells: readonly PixelFarmTerrainCell[],
  hillAccessKeys: ReadonlySet<string>,
): PixelFarmTerrainCell[] {
  const directions = [
    { row: -1, column: 0 },
    { row: 1, column: 0 },
    { row: 0, column: -1 },
    { row: 0, column: 1 },
  ] as const;

  return hillSurfaceCells.filter((cell) =>
    directions.some((direction) => {
      const nextRow = cell.row + direction.row;
      const nextColumn = cell.column + direction.column;

      if (!maskHasTile(PIXEL_FARM_ROOT_LAYER.mask, nextRow, nextColumn)) {
        return true;
      }

      return !hillAccessKeys.has(cellKey(nextRow, nextColumn));
    }),
  );
}

const hillSurfaceCells = collectLayerCells(HILL_LAYER_ID, HILL_SURFACE_SOURCE_IDS);
const hillAccessCells = collectLayerCells(HILL_LAYER_ID, HILL_ACCESS_SOURCE_IDS);
const hillAccessKeys = new Set(hillAccessCells.map((cell) => cellKey(cell.row, cell.column)));
const hillBoundaryCells = collectHillBoundaryCells(hillSurfaceCells, hillAccessKeys);
const terrainBlockedKeys = new Set([
  ...collectBlockingTerrainCells().map((cell) => cellKey(cell.row, cell.column)),
  ...hillBoundaryCells.map((cell) => cellKey(cell.row, cell.column)),
]);

export function collectPixelFarmTerrainBlockedCells(): PixelFarmTerrainCell[] {
  return [...terrainBlockedKeys].map((key) => cellFromKey(key)).filter(
    (cell): cell is PixelFarmTerrainCell => cell !== null,
  );
}

export function isPixelFarmTerrainBlockedCell(row: number, column: number): boolean {
  return terrainBlockedKeys.has(cellKey(row, column));
}

export function collectPixelFarmHillWalkableCells(): PixelFarmTerrainCell[] {
  return hillSurfaceCells.filter(
    (cell) => !terrainBlockedKeys.has(cellKey(cell.row, cell.column)),
  );
}

export function collectPixelFarmHillAccessCells(): PixelFarmTerrainCell[] {
  return hillAccessCells.filter(
    (cell) => !terrainBlockedKeys.has(cellKey(cell.row, cell.column)),
  );
}
