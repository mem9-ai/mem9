import type { PixelFarmMemoryBucketState } from "@/lib/pixel-farm/data/types";
import type {
  PixelFarmFieldCell,
  PixelFarmFieldLayout,
} from "@/lib/pixel-farm/field-layout";

export interface PixelFarmPlantPlacement {
  bucket: PixelFarmMemoryBucketState;
  cell: PixelFarmFieldCell;
  fieldKind: "main";
  plant: PixelFarmMemoryBucketState["plants"][number];
}

function cellKey(cell: PixelFarmFieldCell): string {
  return `${cell.row}:${cell.column}`;
}

function compareCells(left: PixelFarmFieldCell, right: PixelFarmFieldCell): number {
  return left.row - right.row || left.column - right.column;
}

function measureBounds(
  cells: readonly PixelFarmFieldCell[],
): {
  minRow: number;
  maxRow: number;
  minColumn: number;
  maxColumn: number;
} {
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

function cellDistance(left: PixelFarmFieldCell, right: PixelFarmFieldCell): number {
  return Math.abs(left.row - right.row) + Math.abs(left.column - right.column);
}

function lerp(min: number, max: number, ratio: number): number {
  return min + (max - min) * ratio;
}

function buildFieldInteriorDepthIndex(
  cells: readonly PixelFarmFieldCell[],
): ReadonlyMap<string, number> {
  const cellByKey = new Map(cells.map((cell) => [cellKey(cell), cell] as const));
  const depthByKey = new Map<string, number>();
  const queue: PixelFarmFieldCell[] = [];
  const directions = [
    { row: -1, column: 0 },
    { row: 1, column: 0 },
    { row: 0, column: -1 },
    { row: 0, column: 1 },
  ] as const;

  for (const cell of cells) {
    const isBoundaryCell = directions.some((direction) =>
      !cellByKey.has(
        cellKey({
          row: cell.row + direction.row,
          column: cell.column + direction.column,
        }),
      ),
    );
    if (!isBoundaryCell) {
      continue;
    }

    depthByKey.set(cellKey(cell), 0);
    queue.push(cell);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDepth = depthByKey.get(cellKey(current)) ?? 0;

    for (const direction of directions) {
      const neighborKey = cellKey({
        row: current.row + direction.row,
        column: current.column + direction.column,
      });
      const neighbor = cellByKey.get(neighborKey);
      if (!neighbor || depthByKey.has(neighborKey)) {
        continue;
      }

      depthByKey.set(neighborKey, currentDepth + 1);
      queue.push(neighbor);
    }
  }

  return depthByKey;
}

function isInteriorCell(
  cell: PixelFarmFieldCell,
  depthByKey: ReadonlyMap<string, number>,
): boolean {
  return (depthByKey.get(cellKey(cell)) ?? 0) > 0;
}

function pickDistributedCells(
  cells: readonly PixelFarmFieldCell[],
  count: number,
  depthByKey: ReadonlyMap<string, number>,
): PixelFarmFieldCell[] {
  if (count <= 0 || cells.length < 1) {
    return [];
  }

  const interiorCells = cells.filter((cell) => isInteriorCell(cell, depthByKey));
  const candidateCells =
    interiorCells.length >= count
      ? interiorCells
      : cells;
  const sortedCells = [...candidateCells].sort(compareCells);
  if (sortedCells.length <= count) {
    return sortedCells;
  }

  const bounds = measureBounds(sortedCells);
  const targetRows = Math.max(1, Math.round(Math.sqrt(count)));
  const targetColumns = Math.max(1, Math.ceil(count / targetRows));
  const remaining = [...sortedCells];
  const picked: PixelFarmFieldCell[] = [];

  for (let index = 0; index < count; index += 1) {
    const targetRowIndex = Math.floor(index / targetColumns);
    const targetColumnIndex = index % targetColumns;
    const targetRow =
      targetRows === 1
        ? (bounds.minRow + bounds.maxRow) * 0.5
        : lerp(bounds.minRow, bounds.maxRow, targetRowIndex / (targetRows - 1));
    const targetColumn =
      targetColumns === 1
        ? (bounds.minColumn + bounds.maxColumn) * 0.5
        : lerp(bounds.minColumn, bounds.maxColumn, targetColumnIndex / (targetColumns - 1));

    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestDepth = Number.NEGATIVE_INFINITY;

    for (const [candidateIndex, candidate] of remaining.entries()) {
      const candidateDepth = depthByKey.get(cellKey(candidate)) ?? 0;
      const distance =
        Math.abs(candidate.row - targetRow) + Math.abs(candidate.column - targetColumn);
      if (candidateDepth < bestDepth) {
        continue;
      }
      if (candidateDepth === bestDepth && distance >= bestDistance) {
        continue;
      }

      bestDepth = candidateDepth;
      bestDistance = distance;
      bestIndex = candidateIndex;
    }

    picked.push(remaining.splice(bestIndex, 1)[0]!);
  }

  return picked.sort(compareCells);
}

function takeNearestCells(
  remainingCells: PixelFarmFieldCell[],
  anchor: PixelFarmFieldCell,
  count: number,
  depthByKey: ReadonlyMap<string, number>,
): PixelFarmFieldCell[] {
  const interiorCells = remainingCells.filter((cell) => isInteriorCell(cell, depthByKey));
  const candidateCells =
    interiorCells.length >= count
      ? interiorCells
      : remainingCells;

  return candidateCells
    .map((cell, index) => ({
      cell,
      distance: cellDistance(cell, anchor),
      depth: depthByKey.get(cellKey(cell)) ?? 0,
      index,
    }))
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        right.depth - left.depth ||
        left.index - right.index,
    )
    .slice(0, count)
    .map((entry) => entry.cell)
    .sort(compareCells);
}

export function buildPixelFarmPlantPlacements(input: {
  eventField: PixelFarmFieldLayout | null;
  mainField: PixelFarmFieldLayout;
  memoryBuckets: readonly PixelFarmMemoryBucketState[];
}): PixelFarmPlantPlacement[] {
  const depthByKey = buildFieldInteriorDepthIndex(input.mainField.cells);
  const anchors = pickDistributedCells(
    input.mainField.cells,
    input.memoryBuckets.length,
    depthByKey,
  );
  const remainingCells = [...input.mainField.cells];
  const placements: PixelFarmPlantPlacement[] = [];

  for (const [bucketIndex, bucket] of [...input.memoryBuckets]
    .sort((left, right) => left.rank - right.rank)
    .entries()) {
    const anchor = anchors[bucketIndex] ?? remainingCells[0];
    if (!anchor) {
      break;
    }

    const chosenCells = takeNearestCells(
      remainingCells,
      anchor,
      bucket.plants.length,
      depthByKey,
    );

    for (const [plantIndex, plant] of bucket.plants.entries()) {
      const cell = chosenCells[plantIndex];
      if (!cell) {
        continue;
      }

      const remainingIndex = remainingCells.findIndex(
        (candidate) => candidate.row === cell.row && candidate.column === cell.column,
      );
      if (remainingIndex >= 0) {
        remainingCells.splice(remainingIndex, 1);
      }

      placements.push({
        bucket,
        cell,
        fieldKind: "main",
        plant,
      });
    }
  }

  return placements;
}
