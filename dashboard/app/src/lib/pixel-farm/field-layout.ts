import { PIXEL_FARM_LAYERS } from "@/lib/pixel-farm/island-mask";

const PIXEL_FARM_TILLED_SOURCE_IDS = new Set(["tilledDirtWide", "tiledDirt"]);

export interface PixelFarmFieldCell {
  row: number;
  column: number;
}

export interface PixelFarmFieldBounds {
  minRow: number;
  maxRow: number;
  minColumn: number;
  maxColumn: number;
}

export interface PixelFarmFieldLayout {
  kind: "event" | "main";
  cells: PixelFarmFieldCell[];
  bounds: PixelFarmFieldBounds;
}

export interface PixelFarmFieldLayouts {
  eventField: PixelFarmFieldLayout | null;
  mainField: PixelFarmFieldLayout;
}

function pixelFarmFieldCellKey(cell: PixelFarmFieldCell): string {
  return `${cell.row}:${cell.column}`;
}

function comparePixelFarmFieldCells(
  left: PixelFarmFieldCell,
  right: PixelFarmFieldCell,
): number {
  return left.row - right.row || left.column - right.column;
}

function measurePixelFarmFieldBounds(
  cells: readonly PixelFarmFieldCell[],
): PixelFarmFieldBounds {
  return cells.reduce(
    (bounds, cell) => ({
      minRow: Math.min(bounds.minRow, cell.row),
      maxRow: Math.max(bounds.maxRow, cell.row),
      minColumn: Math.min(bounds.minColumn, cell.column),
      maxColumn: Math.max(bounds.maxColumn, cell.column),
    }),
    {
      minRow: Number.POSITIVE_INFINITY,
      maxRow: Number.NEGATIVE_INFINITY,
      minColumn: Number.POSITIVE_INFINITY,
      maxColumn: Number.NEGATIVE_INFINITY,
    },
  );
}

function collectConnectedComponents(
  cells: readonly PixelFarmFieldCell[],
): PixelFarmFieldCell[][] {
  const remaining = new Map(cells.map((cell) => [pixelFarmFieldCellKey(cell), cell]));
  const components: PixelFarmFieldCell[][] = [];
  const directions = [
    { row: -1, column: 0 },
    { row: 1, column: 0 },
    { row: 0, column: -1 },
    { row: 0, column: 1 },
  ] as const;

  for (const cell of cells) {
    const startKey = pixelFarmFieldCellKey(cell);
    if (!remaining.has(startKey)) {
      continue;
    }

    remaining.delete(startKey);

    const component: PixelFarmFieldCell[] = [];
    const queue = [cell];

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);

      for (const direction of directions) {
        const next = {
          row: current.row + direction.row,
          column: current.column + direction.column,
        };
        const nextKey = pixelFarmFieldCellKey(next);
        if (!remaining.has(nextKey)) {
          continue;
        }

        remaining.delete(nextKey);
        queue.push(next);
      }
    }

    components.push(component.sort(comparePixelFarmFieldCells));
  }

  return components;
}

export function collectPixelFarmTilledCells(): PixelFarmFieldCell[] {
  return PIXEL_FARM_LAYERS.flatMap((layer) =>
    Object.entries(layer.overrides)
      .filter(([, tile]) => PIXEL_FARM_TILLED_SOURCE_IDS.has(tile.sourceId))
      .map(([key]) => {
        const [rowText, columnText] = key.split(":");

        return {
          row: Number(rowText),
          column: Number(columnText),
        };
      })
      .filter((cell) => Number.isFinite(cell.row) && Number.isFinite(cell.column)),
  ).sort(comparePixelFarmFieldCells);
}

export function derivePixelFarmFieldLayouts(
  cells: readonly PixelFarmFieldCell[],
): PixelFarmFieldLayouts {
  const components = collectConnectedComponents(cells)
    .sort((left, right) => {
      if (right.length !== left.length) {
        return right.length - left.length;
      }

      const leftBounds = measurePixelFarmFieldBounds(left);
      const rightBounds = measurePixelFarmFieldBounds(right);

      return (
        leftBounds.minRow - rightBounds.minRow ||
        leftBounds.minColumn - rightBounds.minColumn
      );
    })
    .map<PixelFarmFieldLayout>((component, index) => ({
      kind: index === 0 ? "main" : "event",
      cells: [...component],
      bounds: measurePixelFarmFieldBounds(component),
    }));

  const mainField = components[0];
  if (!mainField || mainField.kind !== "main") {
    throw new Error("Pixel farm requires at least one tilled field.");
  }

  return {
    eventField: components[1] ?? null,
    mainField,
  };
}
