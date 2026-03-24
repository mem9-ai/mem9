import Phaser from "phaser";
import {
  PixelFarmBabyCow,
  type PixelFarmBabyCowColor,
} from "@/lib/pixel-farm/baby-cow";
import {
  PixelFarmChicken,
  type PixelFarmChickenColor,
} from "@/lib/pixel-farm/chicken";
import {
  PixelFarmCow,
  type PixelFarmCowColor,
} from "@/lib/pixel-farm/cow";
import { pixelFarmDepthForY } from "@/lib/pixel-farm/depth";
import type {
  PixelFarmAnimalBucketState,
  PixelFarmBucketState,
  PixelFarmCategoryState,
  PixelFarmCropBucketState,
  PixelFarmWorldState,
} from "@/lib/pixel-farm/data/types";
import {
  maskHasTile,
  objectOccupiesCell,
  PIXEL_FARM_LAYERS,
  PIXEL_FARM_OBJECTS,
  PIXEL_FARM_ROOT_LAYER,
} from "@/lib/pixel-farm/island-mask";
import {
  PIXEL_FARM_BUCKET_ANIMAL_PALETTES,
  PIXEL_FARM_CROP_BUCKET_PALETTES,
  PIXEL_FARM_MAIN_FIELD_COUNT,
  PIXEL_FARM_OTHER_ZONE_DECORATIONS,
  type PixelFarmDecorationPalette,
} from "@/lib/pixel-farm/palette";
import {
  PIXEL_FARM_ASSET_SOURCE_CONFIG,
  PIXEL_FARM_TILE_SIZE,
  type PixelFarmAssetTileSelection,
} from "@/lib/pixel-farm/tileset-config";
import {
  collectPixelFarmHillWalkableCells,
  isPixelFarmTerrainBlockedCell,
} from "@/lib/pixel-farm/terrain-collision";

const DATA_ENTITY_DEPTH = 15;
const MAX_BUCKET_RENDER_COUNT = 6;
const TILLED_LAYER_ID = "layer-6";
const TILLED_SOURCE_IDS = new Set(["tilledDirtWide", "tiledDirt"]);

const OTHER_ZONE_BOUNDS: PixelFarmCellBounds = {
  minRow: 0,
  maxRow: 4,
  minColumn: 11,
  maxColumn: 18,
};

const COW_PEN_BOUNDS: PixelFarmCellBounds = {
  minRow: 17,
  maxRow: 23,
  minColumn: 7,
  maxColumn: 16,
};

const CHICKEN_PEN_BOUNDS: PixelFarmCellBounds = {
  minRow: 2,
  maxRow: 7,
  minColumn: 25,
  maxColumn: 33,
};

interface PixelFarmGridCell {
  row: number;
  column: number;
}

interface PixelFarmCellBounds {
  minColumn: number;
  maxColumn: number;
  minRow: number;
  maxRow: number;
}

interface PixelFarmPlotLayout {
  capacity: number;
  bucketCells: readonly PixelFarmGridCell[];
  cells: readonly PixelFarmGridCell[];
}

interface PixelFarmAnimalPenLayout {
  animalCells: readonly PixelFarmGridCell[];
  allowedCellKeys: ReadonlySet<string>;
  bounds: PixelFarmCellBounds;
}

interface PixelFarmWorldBounds {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

interface PixelFarmWorldRendererConfig {
  scene: Phaser.Scene;
  cellToWorldOrigin: (cell: PixelFarmGridCell) => { x: number; y: number };
  cellToWorldPosition: (cell: PixelFarmGridCell) => { x: number; y: number };
}

type PixelFarmRenderedAnimal = PixelFarmBabyCow | PixelFarmChicken | PixelFarmCow;

export interface PixelFarmInteractableTarget {
  id: string;
  kind: "animal" | "crop";
  memoryIds: readonly string[];
  tagLabel: string;
  getOccupiedCells: () => ReadonlyArray<PixelFarmGridCell>;
  getWorldAnchors: () => ReadonlyArray<{ x: number; y: number }>;
}

function gridCellKey(row: number, column: number): string {
  return `${row}:${column}`;
}

function gridCellFromKey(key: string): PixelFarmGridCell | null {
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

function compareGridCells(left: PixelFarmGridCell, right: PixelFarmGridCell): number {
  if (left.row !== right.row) {
    return left.row - right.row;
  }

  return left.column - right.column;
}

function measureCellBounds(cells: readonly PixelFarmGridCell[]): PixelFarmCellBounds {
  if (cells.length < 1) {
    throw new Error("Pixel farm world render layout requires at least one cell.");
  }

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

function lerp(min: number, max: number, ratio: number): number {
  return min + (max - min) * ratio;
}

function cellDistance(left: PixelFarmGridCell, right: PixelFarmGridCell): number {
  return Math.abs(left.row - right.row) + Math.abs(left.column - right.column);
}

function pickDistributedCells(
  cells: readonly PixelFarmGridCell[],
  count: number,
): PixelFarmGridCell[] {
  if (count <= 0 || cells.length < 1) {
    return [];
  }

  const sortedCells = [...cells].sort(compareGridCells);
  if (sortedCells.length <= count) {
    return sortedCells;
  }

  const bounds = measureCellBounds(sortedCells);
  const targetRows = Math.max(1, Math.round(Math.sqrt(count)));
  const targetColumns = Math.max(1, Math.ceil(count / targetRows));
  const remaining = [...sortedCells];
  const picked: PixelFarmGridCell[] = [];

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

    for (const [candidateIndex, candidate] of remaining.entries()) {
      const distance =
        Math.abs(candidate.row - targetRow) + Math.abs(candidate.column - targetColumn);
      if (distance >= bestDistance) {
        continue;
      }

      bestDistance = distance;
      bestIndex = candidateIndex;
    }

    picked.push(remaining.splice(bestIndex, 1)[0]!);
  }

  return picked.sort(compareGridCells);
}

function collectConnectedComponents(
  cells: readonly PixelFarmGridCell[],
): PixelFarmGridCell[][] {
  const remaining = new Set(cells.map((cell) => gridCellKey(cell.row, cell.column)));
  const components: PixelFarmGridCell[][] = [];
  const directions = [
    { row: -1, column: 0 },
    { row: 1, column: 0 },
    { row: 0, column: -1 },
    { row: 0, column: 1 },
  ] as const;

  for (const cell of cells) {
    const startKey = gridCellKey(cell.row, cell.column);
    if (!remaining.has(startKey)) {
      continue;
    }

    remaining.delete(startKey);

    const component: PixelFarmGridCell[] = [];
    const queue = [cell];

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);

      for (const direction of directions) {
        const nextRow = current.row + direction.row;
        const nextColumn = current.column + direction.column;
        const nextKey = gridCellKey(nextRow, nextColumn);
        if (!remaining.has(nextKey)) {
          continue;
        }

        remaining.delete(nextKey);
        queue.push({ row: nextRow, column: nextColumn });
      }
    }

    components.push(component.sort(compareGridCells));
  }

  return components;
}

function blockedByObject(row: number, column: number): boolean {
  return PIXEL_FARM_OBJECTS.some(
    (object) => !object.walkable && objectOccupiesCell(object, row, column),
  );
}

function collectWalkableCells(bounds: PixelFarmCellBounds): PixelFarmGridCell[] {
  const cells: PixelFarmGridCell[] = [];

    for (let row = bounds.minRow; row <= bounds.maxRow; row += 1) {
      for (let column = bounds.minColumn; column <= bounds.maxColumn; column += 1) {
        if (!maskHasTile(PIXEL_FARM_ROOT_LAYER.mask, row, column)) {
          continue;
        }
        if (blockedByObject(row, column) || isPixelFarmTerrainBlockedCell(row, column)) {
          continue;
        }

        cells.push({ row, column });
      }
    }

  return cells;
}

function collectTilledCells(): PixelFarmGridCell[] {
  const tilledLayer = PIXEL_FARM_LAYERS.find((layer) => layer.id === TILLED_LAYER_ID);
  if (!tilledLayer) {
    return [];
  }

  return Object.entries(tilledLayer.overrides)
    .filter(([, tile]) => TILLED_SOURCE_IDS.has(tile.sourceId))
    .map(([key]) => gridCellFromKey(key))
    .filter((cell): cell is PixelFarmGridCell => cell !== null);
}

function createMainPlotLayouts(): PixelFarmPlotLayout[] {
  const tilledCells = collectTilledCells();

  return collectConnectedComponents(tilledCells)
    .sort((left, right) => {
      if (right.length !== left.length) {
        return right.length - left.length;
      }

      const leftBounds = measureCellBounds(left);
      const rightBounds = measureCellBounds(right);
      if (leftBounds.minRow !== rightBounds.minRow) {
        return leftBounds.minRow - rightBounds.minRow;
      }

      return leftBounds.minColumn - rightBounds.minColumn;
    })
    .slice(0, PIXEL_FARM_MAIN_FIELD_COUNT)
    .map((cells) => ({
      capacity: cells.length,
      bucketCells: pickDistributedCells(cells, MAX_BUCKET_RENDER_COUNT),
      cells,
    }));
}

const TILLED_CELL_KEYS = new Set(
  collectTilledCells().map((cell) => gridCellKey(cell.row, cell.column)),
);
const HILL_WALKABLE_CELLS = collectPixelFarmHillWalkableCells();
const HILL_WALKABLE_CELL_KEYS = new Set(
  HILL_WALKABLE_CELLS.map((cell) => gridCellKey(cell.row, cell.column)),
);

function createOtherPlotLayout(): PixelFarmPlotLayout {
  const cells = collectWalkableCells(OTHER_ZONE_BOUNDS).filter(
    (cell) => !TILLED_CELL_KEYS.has(gridCellKey(cell.row, cell.column)),
  );

  return {
    capacity: cells.length,
    bucketCells: pickDistributedCells(cells, MAX_BUCKET_RENDER_COUNT),
    cells,
  };
}

function pickDecorationPalette(family: string): PixelFarmDecorationPalette | null {
  switch (family) {
    case PIXEL_FARM_OTHER_ZONE_DECORATIONS.grass.family:
      return PIXEL_FARM_OTHER_ZONE_DECORATIONS.grass;
    case PIXEL_FARM_OTHER_ZONE_DECORATIONS.redMushroom.family:
      return PIXEL_FARM_OTHER_ZONE_DECORATIONS.redMushroom;
    case PIXEL_FARM_OTHER_ZONE_DECORATIONS.stone.family:
      return PIXEL_FARM_OTHER_ZONE_DECORATIONS.stone;
    default:
      return null;
  }
}

function pickDecorationFrame(
  palette: PixelFarmDecorationPalette,
  fillRatio: number,
): PixelFarmAssetTileSelection {
  const frameIndex = Math.min(
    palette.frames.length - 1,
    Math.max(0, Math.round(fillRatio * (palette.frames.length - 1))),
  );

  return palette.frames[frameIndex]!;
}

function findCropTile(
  cropBucket: PixelFarmCropBucketState,
  bucket: PixelFarmBucketState,
): PixelFarmAssetTileSelection | null {
  const cropPalette = PIXEL_FARM_CROP_BUCKET_PALETTES.find(
    (candidate) => candidate.family === cropBucket.cropFamily,
  );
  if (!cropPalette) {
    return null;
  }

  return cropPalette.stages[bucket.stage];
}

function findOtherDecorationTile(
  category: PixelFarmCategoryState,
  bucket: PixelFarmBucketState,
  index: number,
): PixelFarmAssetTileSelection | null {
  if (category.decorationFamilies.length < 1) {
    return null;
  }

  const family = category.decorationFamilies[index % category.decorationFamilies.length]!;
  const palette = pickDecorationPalette(family);
  if (!palette) {
    return null;
  }

  return pickDecorationFrame(palette, bucket.fillRatio);
}

const MAIN_PLOT_LAYOUTS = createMainPlotLayouts();
const OTHER_PLOT_LAYOUT = createOtherPlotLayout();

export class PixelFarmWorldRenderer {
  private readonly scene: Phaser.Scene;
  private readonly cellToWorldOrigin: PixelFarmWorldRendererConfig["cellToWorldOrigin"];
  private readonly cellToWorldPosition: PixelFarmWorldRendererConfig["cellToWorldPosition"];
  private readonly gridOrigin: { x: number; y: number };
  private cropObjects: Phaser.GameObjects.Image[] = [];
  private animals: PixelFarmRenderedAnimal[] = [];
  private interactableTargets: PixelFarmInteractableTarget[] = [];
  private readonly animalGroup: Phaser.Physics.Arcade.Group;

  constructor(config: PixelFarmWorldRendererConfig) {
    this.scene = config.scene;
    this.cellToWorldOrigin = config.cellToWorldOrigin;
    this.cellToWorldPosition = config.cellToWorldPosition;
    this.gridOrigin = this.cellToWorldOrigin({ row: 0, column: 0 });
    this.animalGroup = this.scene.physics.add.group();
  }

  destroy(): void {
    this.clear();
    this.animalGroup.destroy(true);
  }

  update(deltaMs: number): void {
    for (const animal of this.animals) {
      animal.update(deltaMs);
    }
  }

  getAnimalGroup(): Phaser.Physics.Arcade.Group {
    return this.animalGroup;
  }

  getAnimals(): readonly PixelFarmRenderedAnimal[] {
    return this.animals;
  }

  getCropObjects(): readonly Phaser.GameObjects.Image[] {
    return this.cropObjects;
  }

  getInteractableTargets(): readonly PixelFarmInteractableTarget[] {
    return this.interactableTargets;
  }

  render(worldState: PixelFarmWorldState | null): void {
    this.clear();

    if (!worldState) {
      return;
    }

    this.renderCropBuckets(worldState.cropBuckets);
    this.renderAnimalBuckets(worldState.animalBuckets);

    for (const category of worldState.categories) {
      this.renderCategory(category);
    }
  }

  private clear(): void {
    for (const object of this.cropObjects) {
      object.destroy();
    }
    this.cropObjects = [];

    for (const animal of this.animals) {
      animal.destroy();
    }
    this.animals = [];
    this.interactableTargets = [];
    this.animalGroup.clear(false, false);
  }

  private renderCategory(category: PixelFarmCategoryState): void {
    if (category.kind !== "other") {
      return;
    }

    const layout = this.layoutForCategory(category);
    if (!layout) {
      return;
    }

    for (const [index, bucket] of category.buckets.entries()) {
      const cell = layout.bucketCells[index];
      if (!cell || !bucket.active) {
        continue;
      }

      const tile =
        findOtherDecorationTile(category, bucket, index);
      if (!tile) {
        continue;
      }

      this.addCropTile(cell, tile);
    }
  }

  private renderCropBuckets(cropBuckets: readonly PixelFarmCropBucketState[]): void {
    const cropBucketsByPlot = new Map<number, PixelFarmCropBucketState[]>();

    for (const cropBucket of cropBuckets) {
      const buckets = cropBucketsByPlot.get(cropBucket.plotIndex);
      if (buckets) {
        buckets.push(cropBucket);
        continue;
      }

      cropBucketsByPlot.set(cropBucket.plotIndex, [cropBucket]);
    }

    for (const [plotIndex, plotBuckets] of cropBucketsByPlot.entries()) {
      const layout = MAIN_PLOT_LAYOUTS[plotIndex];
      if (!layout) {
        continue;
      }

      this.renderCropPlot(
        layout,
        [...plotBuckets].sort((left, right) => left.rank - right.rank),
      );
    }
  }

  private renderAnimalBuckets(animalBuckets: readonly PixelFarmAnimalBucketState[]): void {
    const chickenBuckets = animalBuckets.filter((bucket) => bucket.zone === "chicken-pen");
    const cowBuckets = animalBuckets.filter((bucket) => bucket.zone === "cow-pen");

    this.renderAnimalPen(CHICKEN_PEN_LAYOUT, chickenBuckets);
    this.renderAnimalPen(COW_PEN_LAYOUT, cowBuckets);
  }

  private renderCropPlot(
    layout: PixelFarmPlotLayout,
    cropBuckets: readonly PixelFarmCropBucketState[],
  ): void {
    if (layout.cells.length < 1 || cropBuckets.length < 1) {
      return;
    }

    const anchors = pickDistributedCells(layout.cells, cropBuckets.length);
    const remainingCells = [...layout.cells];

    for (const [bucketIndex, cropBucket] of cropBuckets.entries()) {
      const anchor = anchors[bucketIndex] ?? remainingCells[0];
      if (!anchor) {
        continue;
      }

      const cropCells = this.takeNearestCells(
        remainingCells,
        anchor,
        cropBucket.instances.length,
      );
      const instanceAnchors: Array<{ x: number; y: number }> = [];
      const occupiedCells: PixelFarmGridCell[] = [];

      for (const [instanceIndex, instance] of cropBucket.instances.entries()) {
        const cell = cropCells[instanceIndex];
        if (!cell || !instance.active) {
          continue;
        }

        const tile = findCropTile(cropBucket, instance);
        if (!tile) {
          continue;
        }

        const sprite = this.addCropTile(cell, tile);
        instanceAnchors.push({ x: sprite.x, y: sprite.y });
        occupiedCells.push({ row: cell.row, column: cell.column });
      }

      if (instanceAnchors.length > 0) {
        this.interactableTargets.push({
          id: cropBucket.id,
          kind: "crop",
          memoryIds: [...cropBucket.memoryIds],
          tagLabel: cropBucket.tagLabel,
          getOccupiedCells: () => occupiedCells.map((cell) => ({ ...cell })),
          getWorldAnchors: () => [...instanceAnchors],
        });
      }
    }
  }

  private renderAnimalPen(
    layout: PixelFarmAnimalPenLayout,
    animalBuckets: readonly PixelFarmAnimalBucketState[],
  ): void {
    if (layout.animalCells.length < 1 || animalBuckets.length < 1) {
      return;
    }

    let placementIndex = 0;

    for (const animalBucket of animalBuckets) {
      const renderedAnimals: PixelFarmRenderedAnimal[] = [];

      for (let instanceIndex = 0; instanceIndex < animalBucket.instanceCount; instanceIndex += 1) {
        const cell = layout.animalCells[placementIndex % layout.animalCells.length]!;
        const renderedAnimal = this.createAnimal(layout, cell, animalBucket, placementIndex);
        placementIndex += 1;
        if (!renderedAnimal) {
          continue;
        }

        this.animals.push(renderedAnimal);
        renderedAnimals.push(renderedAnimal);
      }

      if (renderedAnimals.length > 0) {
        this.interactableTargets.push({
          id: animalBucket.id,
          kind: "animal",
          memoryIds: [...animalBucket.memoryIds],
          tagLabel: animalBucket.tagLabel,
          getOccupiedCells: () =>
            renderedAnimals.map((animal) => {
              const body = animal.body as Phaser.Physics.Arcade.Body | undefined;
              const sampleX = body ? body.x + body.width * 0.5 : animal.x;
              const sampleY = body ? body.y + body.height - 1 : animal.y - 1;
              return this.worldPointToGridCell(sampleX, sampleY);
            }),
          getWorldAnchors: () =>
            renderedAnimals.map((animal) => ({
              x: animal.x,
              y: animal.y,
            })),
        });
      }
    }
  }

  private layoutForCategory(category: PixelFarmCategoryState): PixelFarmPlotLayout | null {
    if (category.kind === "other") {
      return OTHER_PLOT_LAYOUT;
    }

    return null;
  }

  private addCropTile(
    cell: PixelFarmGridCell,
    tile: PixelFarmAssetTileSelection,
  ): Phaser.GameObjects.Image {
    const source = PIXEL_FARM_ASSET_SOURCE_CONFIG[tile.sourceId];
    const { x, y } = this.cellToWorldPosition(cell);
    const sprite = this.scene.add.image(x, y, source.textureKey, tile.frame);

    sprite.setOrigin(0.5, 1);
    sprite.setDepth(pixelFarmDepthForY(DATA_ENTITY_DEPTH, y));
    this.cropObjects.push(sprite);
    return sprite;
  }

  private takeNearestCells(
    cells: PixelFarmGridCell[],
    anchor: PixelFarmGridCell,
    count: number,
  ): PixelFarmGridCell[] {
    if (count <= 0 || cells.length < 1) {
      return [];
    }

    const ranked = cells
      .map((cell, index) => ({
        distance: cellDistance(cell, anchor),
        index,
      }))
      .sort((left, right) => left.distance - right.distance || left.index - right.index)
      .slice(0, count)
      .sort((left, right) => right.index - left.index);

    const picked: PixelFarmGridCell[] = [];
    for (const entry of ranked) {
      const cell = cells.splice(entry.index, 1)[0];
      if (cell) {
        picked.push(cell);
      }
    }

    return picked.sort(compareGridCells);
  }

  private penWorldBounds(layout: PixelFarmAnimalPenLayout): PixelFarmWorldBounds {
    const topLeft = this.cellToWorldOrigin({
      row: layout.bounds.minRow,
      column: layout.bounds.minColumn,
    });
    const bottomRight = this.cellToWorldOrigin({
      row: layout.bounds.maxRow + 1,
      column: layout.bounds.maxColumn + 1,
    });
    const padding = PIXEL_FARM_TILE_SIZE * 0.5;

    return {
      left: topLeft.x - padding,
      top: topLeft.y - padding,
      right: bottomRight.x + padding,
      bottom: bottomRight.y + padding,
    };
  }

  private worldPointToGridCell(worldX: number, worldY: number): PixelFarmGridCell {
    return {
      row: Math.floor((worldY - this.gridOrigin.y) / PIXEL_FARM_TILE_SIZE),
      column: Math.floor((worldX - this.gridOrigin.x) / PIXEL_FARM_TILE_SIZE),
    };
  }

  private animalCanOccupy(layout: PixelFarmAnimalPenLayout) {
    const bounds = this.penWorldBounds(layout);
    const allowedCellKeys = layout.allowedCellKeys;

    return (
      left: number,
      top: number,
      right: number,
      bottom: number,
    ): boolean => {
      if (
        left < bounds.left ||
        top < bounds.top ||
        right > bounds.right ||
        bottom > bounds.bottom
      ) {
        return false;
      }

      const sampleY = bottom - 1;
      const sampleXs = [
        left + 2,
        left + (right - left) * 0.5,
        right - 2,
      ];

      return sampleXs.every((sampleX) => {
        const cell = this.worldPointToGridCell(sampleX, sampleY);
        return allowedCellKeys.has(gridCellKey(cell.row, cell.column));
      });
    };
  }

  private createAnimal(
    layout: PixelFarmAnimalPenLayout,
    cell: PixelFarmGridCell,
    animalBucket: PixelFarmAnimalBucketState,
    index: number,
  ): PixelFarmRenderedAnimal | null {
    const palette = PIXEL_FARM_BUCKET_ANIMAL_PALETTES.find(
      (candidate) => candidate.tier === animalBucket.tier,
    );
    const { x, y } = this.cellToWorldPosition(cell);
    const flipX = index % 2 === 1;
    const canOccupy = this.animalCanOccupy(layout);

    switch (animalBucket.tier) {
      case "chicken": {
        const color = (palette?.color ?? "default") as PixelFarmChickenColor;
        const chicken = new PixelFarmChicken({
          scene: this.scene,
          color,
          depth: DATA_ENTITY_DEPTH,
          startX: x,
          startY: y,
          canOccupy,
        });

        chicken.setFlipX(flipX);
        this.animalGroup.add(chicken);
        return chicken;
      }
      case "baby-cow": {
        const color = (palette?.color ?? "brown") as PixelFarmBabyCowColor;
        const babyCow = new PixelFarmBabyCow({
          scene: this.scene,
          color,
          depth: DATA_ENTITY_DEPTH,
          startX: x,
          startY: y,
          canOccupy,
        });

        babyCow.setFlipX(flipX);
        this.animalGroup.add(babyCow);
        return babyCow;
      }
      case "cow": {
        const color = (palette?.color ?? "brown") as PixelFarmCowColor;
        const cow = new PixelFarmCow({
          scene: this.scene,
          color,
          depth: DATA_ENTITY_DEPTH,
          startX: x,
          startY: y,
          canOccupy,
        });

        cow.setFlipX(flipX);
        this.animalGroup.add(cow);
        return cow;
      }
      default:
        return null;
    }
  }
}

function createAnimalPenLayoutFromCells(
  spawnCells: readonly PixelFarmGridCell[],
  fallbackBounds: PixelFarmCellBounds,
  roamCells: readonly PixelFarmGridCell[] = spawnCells,
): PixelFarmAnimalPenLayout {
  const walkableSpawnCells = spawnCells.filter(
    (cell) => !blockedByObject(cell.row, cell.column) && !isPixelFarmTerrainBlockedCell(cell.row, cell.column),
  );
  const walkableRoamCells = roamCells.filter(
    (cell) => !blockedByObject(cell.row, cell.column) && !isPixelFarmTerrainBlockedCell(cell.row, cell.column),
  );
  const bounds =
    walkableRoamCells.length > 0 ? measureCellBounds(walkableRoamCells) : fallbackBounds;

  return {
    animalCells: pickDistributedCells(
      walkableSpawnCells,
      Math.min(16, walkableSpawnCells.length),
    ),
    allowedCellKeys: new Set(
      walkableRoamCells.map((cell) => gridCellKey(cell.row, cell.column)),
    ),
    bounds,
  };
}

const ISLAND_WALKABLE_CELLS = collectWalkableCells({
  minRow: 0,
  maxRow: PIXEL_FARM_ROOT_LAYER.mask.length - 1,
  minColumn: 0,
  maxColumn: PIXEL_FARM_ROOT_LAYER.mask[0]!.length - 1,
}).filter((cell) => !HILL_WALKABLE_CELL_KEYS.has(gridCellKey(cell.row, cell.column)));

const COW_PEN_LAYOUT = createAnimalPenLayoutFromCells(
  collectWalkableCells(COW_PEN_BOUNDS),
  COW_PEN_BOUNDS,
  ISLAND_WALKABLE_CELLS,
);
const CHICKEN_PEN_LAYOUT = createAnimalPenLayoutFromCells(
  HILL_WALKABLE_CELLS,
  CHICKEN_PEN_BOUNDS,
);
