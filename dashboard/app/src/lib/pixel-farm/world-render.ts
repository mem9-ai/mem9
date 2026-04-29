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
  PixelFarmMemoryBucketState,
  PixelFarmNpcState,
  PixelFarmWorldState,
} from "@/lib/pixel-farm/data/types";
import { buildPixelFarmPlantPlacements } from "@/lib/pixel-farm/plant-placement";
import {
  maskHasTile,
  PIXEL_FARM_ROOT_LAYER,
  PIXEL_FARM_COLLISIONS,
} from "@/lib/pixel-farm/island-mask";
import {
  buildPixelFarmCollisionIndex,
  intersectsPixelFarmCollision,
  type PixelFarmCollisionRect,
} from "@/lib/pixel-farm/collision-layer";
import {
  PIXEL_FARM_BUCKET_ANIMAL_PALETTES,
  PIXEL_FARM_CROP_BUCKET_PALETTES,
  type PixelFarmCropStage,
} from "@/lib/pixel-farm/palette";
import {
  PIXEL_FARM_ASSET_SOURCE_CONFIG,
  PIXEL_FARM_TILE_SIZE,
  type PixelFarmAssetTileSelection,
} from "@/lib/pixel-farm/tileset-config";

const DATA_ENTITY_DEPTH = 15;
const CHICKEN_ROAM_TARGET_MIN_DISTANCE = 4;
const CHICKEN_ROAM_TARGET_MAX_ATTEMPTS = 10;

const CHICKEN_RENDER_COLORS = ["default", "brown"] as const satisfies readonly PixelFarmChickenColor[];
const COW_RENDER_COLORS = ["brown", "light"] as const satisfies readonly PixelFarmCowColor[];
const PIXEL_FARM_COLLISION_INDEX = buildPixelFarmCollisionIndex(PIXEL_FARM_COLLISIONS);

const COW_SPAWN_BOUNDS: PixelFarmCellBounds = {
  minRow: 22,
  maxRow: 25,
  minColumn: 15,
  maxColumn: 22,
};

const CHICKEN_SPAWN_BOUNDS: PixelFarmCellBounds = {
  minRow: 9,
  maxRow: 12,
  minColumn: 33,
  maxColumn: 38,
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

interface PixelFarmAnimalPenLayout {
  animalCells: readonly PixelFarmGridCell[];
  allowedCellKeys: ReadonlySet<string>;
  bounds: PixelFarmCellBounds;
  roamCells: readonly PixelFarmGridCell[];
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

export interface PixelFarmInteractablePoint {
  animalInstanceId?: string;
  occupiedCell: PixelFarmGridCell;
  worldAnchor: { x: number; y: number };
}

export interface PixelFarmInteractableTarget {
  id: string;
  bucketId: string | null;
  bucketTotalMemoryCount: number | null;
  endIndexExclusive: number | null;
  kind: "npc" | "plant";
  memoryIds: readonly string[];
  plantId: string | null;
  startIndexInclusive: number | null;
  tagKey: string | null;
  tagLabel: string;
  getInteractionPoints: () => ReadonlyArray<PixelFarmInteractablePoint>;
  getOccupiedCells: () => ReadonlyArray<PixelFarmGridCell>;
  getWorldAnchors: () => ReadonlyArray<{ x: number; y: number }>;
}

function gridCellKey(row: number, column: number): string {
  return `${row}:${column}`;
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

function cellDistance(left: PixelFarmGridCell, right: PixelFarmGridCell): number {
  return Math.abs(left.row - right.row) + Math.abs(left.column - right.column);
}

function canSpawnFromWalkableSet(
  cell: PixelFarmGridCell,
  walkableCellKeys: ReadonlySet<string>,
): boolean {
  if (!walkableCellKeys.has(gridCellKey(cell.row, cell.column))) {
    return false;
  }

  return [
    { row: -1, column: 0 },
    { row: 1, column: 0 },
    { row: 0, column: -1 },
    { row: 0, column: 1 },
  ].some((direction) =>
    walkableCellKeys.has(gridCellKey(cell.row + direction.row, cell.column + direction.column)),
  );
}

function pickRandomCells(
  cells: readonly PixelFarmGridCell[],
  count: number,
): PixelFarmGridCell[] {
  if (count <= 0 || cells.length < 1) {
    return [];
  }

  return Phaser.Utils.Array.Shuffle([...cells])
    .slice(0, Math.min(count, cells.length))
    .sort(compareGridCells);
}

function collisionRectForCell(cell: PixelFarmGridCell): PixelFarmCollisionRect {
  return {
    left: cell.column,
    top: cell.row,
    right: cell.column + 1,
    bottom: cell.row + 1,
  };
}

function collectWalkableCells(bounds: PixelFarmCellBounds): PixelFarmGridCell[] {
  const cells: PixelFarmGridCell[] = [];

  for (let row = bounds.minRow; row <= bounds.maxRow; row += 1) {
    for (let column = bounds.minColumn; column <= bounds.maxColumn; column += 1) {
      if (!maskHasTile(PIXEL_FARM_ROOT_LAYER.mask, row, column)) {
        continue;
      }

      const cell = { row, column };
      if (intersectsPixelFarmCollision(PIXEL_FARM_COLLISION_INDEX, collisionRectForCell(cell))) {
        continue;
      }

      cells.push(cell);
    }
  }

  return cells;
}

function findCropTile(
  cropFamily: string,
  cropStage: PixelFarmCropStage,
): PixelFarmAssetTileSelection | null {
  const cropPalette = PIXEL_FARM_CROP_BUCKET_PALETTES.find(
    (candidate) => candidate.family === cropFamily,
  );
  if (!cropPalette) {
    return null;
  }

  return cropPalette.stages[cropStage];
}

const ISLAND_WALKABLE_CELLS = collectWalkableCells({
  minRow: 0,
  maxRow: PIXEL_FARM_ROOT_LAYER.mask.length - 1,
  minColumn: 0,
  maxColumn: PIXEL_FARM_ROOT_LAYER.mask[0]!.length - 1,
});
const COW_SPAWN_CELLS = collectWalkableCells(COW_SPAWN_BOUNDS);
const CHICKEN_SPAWN_CELLS = collectWalkableCells(CHICKEN_SPAWN_BOUNDS);
const COW_PEN_LAYOUT = createAnimalPenLayoutFromCells(
  COW_SPAWN_CELLS,
  COW_SPAWN_BOUNDS,
  ISLAND_WALKABLE_CELLS,
);
const CHICKEN_PEN_LAYOUT = createAnimalPenLayoutFromCells(
  CHICKEN_SPAWN_CELLS,
  CHICKEN_SPAWN_BOUNDS,
  ISLAND_WALKABLE_CELLS,
);

export class PixelFarmWorldRenderer {
  private readonly scene: Phaser.Scene;
  private readonly cellToWorldOrigin: PixelFarmWorldRendererConfig["cellToWorldOrigin"];
  private readonly cellToWorldPosition: PixelFarmWorldRendererConfig["cellToWorldPosition"];
  private readonly gridOrigin: { x: number; y: number };
  private cropObjects: Phaser.GameObjects.Image[] = [];
  private animals: PixelFarmRenderedAnimal[] = [];
  private animalInstanceById = new Map<string, PixelFarmRenderedAnimal>();
  private interactableTargets: PixelFarmInteractableTarget[] = [];
  private interactableStructureVersion = 0;
  private lastInteractableStructureSignature = "";
  private pausedAnimalInstanceId: string | null = null;
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
    const pausedAnimalInstanceId = this.pausedAnimalInstanceId;

    for (const [animalInstanceId, animal] of this.animalInstanceById.entries()) {
      const interactionHeld = animalInstanceId === pausedAnimalInstanceId;
      animal.setInteractionHeld(interactionHeld);
      if (interactionHeld) {
        continue;
      }

      animal.update(deltaMs);
    }
  }

  setPausedAnimalInstanceId(animalInstanceId: string | null): void {
    this.pausedAnimalInstanceId = animalInstanceId;
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

  getInteractableStructureVersion(): number {
    return this.interactableStructureVersion;
  }

  render(worldState: PixelFarmWorldState | null): void {
    this.clear();

    if (!worldState) {
      this.updateInteractableStructureVersion();
      return;
    }

    this.renderMemoryPlants(worldState.memoryBuckets, worldState);
    this.renderNpcs(worldState.npcs);
    this.updateInteractableStructureVersion();
  }

  private clear(): void {
    this.animalInstanceById.clear();

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

  private updateInteractableStructureVersion(): void {
    const signature = this.interactableTargets
      .map((target) => `${target.kind}:${target.id}`)
      .sort()
      .join("|");

    if (signature === this.lastInteractableStructureSignature) {
      return;
    }

    this.lastInteractableStructureSignature = signature;
    this.interactableStructureVersion += 1;
  }

  private renderMemoryPlants(
    memoryBuckets: readonly PixelFarmMemoryBucketState[],
    worldState: PixelFarmWorldState,
  ): void {
    const placements = buildPixelFarmPlantPlacements({
      eventField: worldState.fields.eventField,
      mainField: worldState.fields.mainField,
      memoryBuckets,
    });

    for (const placement of placements) {
      const tile = findCropTile(placement.bucket.cropFamily, placement.plant.cropStage);
      if (!tile) {
        continue;
      }

      const sprite = this.addCropTile(placement.cell, tile);
      const worldAnchor = { x: sprite.x, y: sprite.y };
      const occupiedCell = { row: placement.cell.row, column: placement.cell.column };

      this.interactableTargets.push({
        id: placement.plant.id,
        bucketId: placement.bucket.id,
        bucketTotalMemoryCount: placement.bucket.totalMemoryCount,
        endIndexExclusive: placement.plant.endIndexExclusive,
        kind: "plant",
        memoryIds: [...placement.plant.memoryIds],
        plantId: placement.plant.id,
        startIndexInclusive: placement.plant.startIndexInclusive,
        tagKey: placement.bucket.tagKey,
        tagLabel: placement.bucket.tagLabel,
        getInteractionPoints: () => [
          {
            occupiedCell: { ...occupiedCell },
            worldAnchor: { ...worldAnchor },
          },
        ],
        getOccupiedCells: () => [{ ...occupiedCell }],
        getWorldAnchors: () => [{ ...worldAnchor }],
      });
    }
  }

  private renderNpcs(npcs: readonly PixelFarmNpcState[]): void {
    const chickenNpcs = npcs.filter((npc) => npc.kind === "chicken");
    const herdNpcs = npcs.filter((npc) => npc.kind === "baby-cow" || npc.kind === "cow");

    this.renderAnimalPen(CHICKEN_PEN_LAYOUT, chickenNpcs);
    this.renderAnimalPen(COW_PEN_LAYOUT, herdNpcs);
  }

  private renderAnimalPen(
    layout: PixelFarmAnimalPenLayout,
    npcs: readonly PixelFarmNpcState[],
  ): void {
    if (layout.animalCells.length < 1 || npcs.length < 1) {
      return;
    }

    let placementIndex = 0;
    const chickenColorOffset = Phaser.Math.Between(0, CHICKEN_RENDER_COLORS.length - 1);
    const cowColorOffset = Phaser.Math.Between(0, COW_RENDER_COLORS.length - 1);

    for (const npc of npcs) {
      const cell =
        npc.position ?? layout.animalCells[placementIndex % layout.animalCells.length]!;
      const renderedAnimal = this.createAnimal(
        layout,
        cell,
        npc,
        placementIndex,
        chickenColorOffset,
        cowColorOffset,
      );
      placementIndex += 1;
      if (!renderedAnimal) {
        continue;
      }

      this.animals.push(renderedAnimal);
      this.animalInstanceById.set(npc.id, renderedAnimal);
      this.interactableTargets.push(this.createNpcInteractableTarget(npc, renderedAnimal));
    }
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
      moveX?: number,
      _moveY?: number,
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
      const centerX = left + (right - left) * 0.5;
      const leftX = left + 2;
      const rightX = right - 2;
      const sampleXs =
        moveX === undefined || Math.abs(moveX) < 0.5
          ? [leftX, centerX, rightX]
          : moveX > 0
            ? [centerX, rightX]
            : [leftX, centerX];

      return (
        sampleXs.every((sampleX) => {
          const cell = this.worldPointToGridCell(sampleX, sampleY);
          return allowedCellKeys.has(gridCellKey(cell.row, cell.column));
        }) &&
        !intersectsPixelFarmCollision(
          PIXEL_FARM_COLLISION_INDEX,
          this.worldRectToLocalRect(left, top, right, bottom),
        )
      );
    };
  }

  private pickChickenWalkTarget(currentX: number, currentY: number): Phaser.Math.Vector2 | null {
    const currentCell = this.worldPointToGridCell(currentX, currentY);

    for (let attempt = 0; attempt < CHICKEN_ROAM_TARGET_MAX_ATTEMPTS; attempt += 1) {
      const targetIndex = Phaser.Math.Between(0, CHICKEN_PEN_LAYOUT.roamCells.length - 1);
      const targetCell = CHICKEN_PEN_LAYOUT.roamCells[targetIndex];
      if (!targetCell || cellDistance(currentCell, targetCell) < CHICKEN_ROAM_TARGET_MIN_DISTANCE) {
        continue;
      }

      const { x, y } = this.cellToWorldPosition(targetCell);
      return new Phaser.Math.Vector2(x, y);
    }

    return null;
  }

  private worldRectToLocalRect(
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): PixelFarmCollisionRect {
    return {
      left: (left - this.gridOrigin.x) / PIXEL_FARM_TILE_SIZE,
      top: (top - this.gridOrigin.y) / PIXEL_FARM_TILE_SIZE,
      right: (right - this.gridOrigin.x) / PIXEL_FARM_TILE_SIZE,
      bottom: (bottom - this.gridOrigin.y) / PIXEL_FARM_TILE_SIZE,
    };
  }

  private createAnimal(
    layout: PixelFarmAnimalPenLayout,
    cell: PixelFarmGridCell,
    npc: PixelFarmNpcState,
    index: number,
    chickenColorOffset: number,
    cowColorOffset: number,
  ): PixelFarmRenderedAnimal | null {
    const { x, y } = this.cellToWorldPosition(cell);
    const flipX = index % 2 === 1;
    const canOccupy = this.animalCanOccupy(layout);

    switch (npc.kind) {
      case "chicken": {
        const color = CHICKEN_RENDER_COLORS[
          (index + chickenColorOffset) % CHICKEN_RENDER_COLORS.length
        ]!;
        const chicken = new PixelFarmChicken({
          scene: this.scene,
          color,
          depth: DATA_ENTITY_DEPTH,
          startX: x,
          startY: y,
          canOccupy,
          pickWalkTarget: (currentX, currentY) => this.pickChickenWalkTarget(currentX, currentY),
        });

        chicken.setFlipX(flipX);
        this.animalGroup.add(chicken);
        return chicken;
      }
      case "baby-cow": {
        const palette = PIXEL_FARM_BUCKET_ANIMAL_PALETTES.find(
          (candidate) => candidate.tier === npc.kind,
        );
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
        const color = COW_RENDER_COLORS[(index + cowColorOffset) % COW_RENDER_COLORS.length]!;
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

  private createNpcInteractableTarget(
    npc: PixelFarmNpcState,
    animal: PixelFarmRenderedAnimal,
  ): PixelFarmInteractableTarget {
    const currentAnchor = () => ({
      x: animal.x,
      y: animal.y,
    });
    const currentCell = () => this.worldPointToGridCell(animal.x, animal.y);

    return {
      id: npc.id,
      bucketId: null,
      bucketTotalMemoryCount: null,
      endIndexExclusive: null,
      kind: "npc",
      memoryIds: [],
      plantId: null,
      startIndexInclusive: null,
      tagKey: null,
      tagLabel: npc.kind,
      getInteractionPoints: () => [
        {
          animalInstanceId: npc.id,
          occupiedCell: currentCell(),
          worldAnchor: currentAnchor(),
        },
      ],
      getOccupiedCells: () => [currentCell()],
      getWorldAnchors: () => [currentAnchor()],
    };
  }
}

function createAnimalPenLayoutFromCells(
  spawnCells: readonly PixelFarmGridCell[],
  fallbackBounds: PixelFarmCellBounds,
  roamCells: readonly PixelFarmGridCell[] = spawnCells,
): PixelFarmAnimalPenLayout {
  const walkableSpawnCells = [...spawnCells];
  const walkableRoamCells = [...roamCells];
  const spawnValidationCellKeys = new Set(
    [...walkableSpawnCells, ...walkableRoamCells].map((cell) => gridCellKey(cell.row, cell.column)),
  );
  const validSpawnCells = walkableSpawnCells.filter((cell) =>
    canSpawnFromWalkableSet(cell, spawnValidationCellKeys),
  );
  const bounds =
    walkableRoamCells.length > 0 ? measureCellBounds(walkableRoamCells) : fallbackBounds;

  return {
    animalCells: pickRandomCells(
      validSpawnCells,
      Math.min(16, validSpawnCells.length),
    ),
    allowedCellKeys: new Set(
      walkableRoamCells.map((cell) => gridCellKey(cell.row, cell.column)),
    ),
    bounds,
    roamCells: walkableRoamCells,
  };
}
