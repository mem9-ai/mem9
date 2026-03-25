import Phaser from "phaser";
import type { PixelFarmCollisionCell } from "@/lib/pixel-farm/island-mask";
import { PIXEL_FARM_TILE_SIZE } from "@/lib/pixel-farm/tileset-config";

const QUARTER_TILE = 0.5;
const EPSILON = 0.0001;

export interface PixelFarmCollisionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface PixelFarmCompiledCollisionCell {
  id: string;
  halfTileRow: number;
  halfTileColumn: number;
  rect: PixelFarmCollisionRect;
}

export interface PixelFarmCollisionIndex {
  segments: readonly PixelFarmCompiledCollisionCell[];
  halfCellIndex: ReadonlyMap<string, readonly number[]>;
}

export interface PixelFarmStaticCollisionBodyConfig {
  scene: Phaser.Scene;
  segments?: readonly PixelFarmCollisionCell[];
  offsetX: number;
  offsetY: number;
  group?: Phaser.Physics.Arcade.StaticGroup;
}

function halfCellKey(halfRow: number, halfColumn: number): string {
  return `${halfRow}:${halfColumn}`;
}

function collisionRectForSegment(segment: PixelFarmCollisionCell): PixelFarmCollisionRect {
  const left = segment.halfTileColumn * QUARTER_TILE;
  const top = segment.halfTileRow * QUARTER_TILE;

  return {
    left,
    top,
    right: left + QUARTER_TILE,
    bottom: top + QUARTER_TILE,
  };
}

function occupiedHalfCells(segment: PixelFarmCollisionCell): Array<[number, number]> {
  const startHalfRow = Math.floor(segment.halfTileRow / 2);
  const endHalfRow = Math.floor((segment.halfTileRow + 1) / 2);
  const startHalfColumn = Math.floor(segment.halfTileColumn / 2);
  const endHalfColumn = Math.floor((segment.halfTileColumn + 1) / 2);
  const cells: Array<[number, number]> = [];

  for (let halfRow = startHalfRow; halfRow <= endHalfRow; halfRow += 1) {
    for (let halfColumn = startHalfColumn; halfColumn <= endHalfColumn; halfColumn += 1) {
      cells.push([halfRow, halfColumn]);
    }
  }

  return cells;
}

function rectsIntersect(left: PixelFarmCollisionRect, right: PixelFarmCollisionRect): boolean {
  return (
    left.left < right.right - EPSILON &&
    left.right > right.left + EPSILON &&
    left.top < right.bottom - EPSILON &&
    left.bottom > right.top + EPSILON
  );
}

export function buildPixelFarmCollisionIndex(
  segments: readonly PixelFarmCollisionCell[],
): PixelFarmCollisionIndex {
  const halfCellIndex = new Map<string, number[]>();
  const compiled = segments.map((segment, index) => {
    for (const [halfRow, halfColumn] of occupiedHalfCells(segment)) {
      const key = halfCellKey(halfRow, halfColumn);
      const bucket = halfCellIndex.get(key);
      if (bucket) {
        bucket.push(index);
      } else {
        halfCellIndex.set(key, [index]);
      }
    }

    return {
      id: segment.id,
      halfTileRow: segment.halfTileRow,
      halfTileColumn: segment.halfTileColumn,
      rect: collisionRectForSegment(segment),
    };
  });

  return {
    segments: compiled,
    halfCellIndex,
  };
}

export function createPixelFarmStaticCollisionBodies(
  config: PixelFarmStaticCollisionBodyConfig,
): Phaser.Physics.Arcade.StaticGroup {
  const group = config.group ?? config.scene.physics.add.staticGroup();
  group.clear(true, true);

  for (const segment of config.segments ?? []) {
    const rect = collisionRectForSegment(segment);
    const width = (rect.right - rect.left) * PIXEL_FARM_TILE_SIZE;
    const height = (rect.bottom - rect.top) * PIXEL_FARM_TILE_SIZE;
    const centerX = config.offsetX + (rect.left + rect.right) * PIXEL_FARM_TILE_SIZE * 0.5;
    const centerY = config.offsetY + (rect.top + rect.bottom) * PIXEL_FARM_TILE_SIZE * 0.5;
    const blocker = config.scene.physics.add.staticImage(centerX, centerY, "__WHITE");

    blocker.setDisplaySize(width, height);
    blocker.setVisible(false);
    blocker.refreshBody();
    group.add(blocker);
  }

  return group;
}

export function intersectsPixelFarmCollision(
  index: PixelFarmCollisionIndex,
  rect: PixelFarmCollisionRect,
): boolean {
  const minHalfRow = Math.floor(rect.top * 2);
  const maxHalfRow = Math.ceil((rect.bottom - EPSILON) * 2) - 1;
  const minHalfColumn = Math.floor(rect.left * 2);
  const maxHalfColumn = Math.ceil((rect.right - EPSILON) * 2) - 1;
  const seen = new Set<number>();

  for (let halfRow = minHalfRow; halfRow <= maxHalfRow; halfRow += 1) {
    for (let halfColumn = minHalfColumn; halfColumn <= maxHalfColumn; halfColumn += 1) {
      for (const segmentIndex of index.halfCellIndex.get(halfCellKey(halfRow, halfColumn)) ?? []) {
        if (seen.has(segmentIndex)) {
          continue;
        }

        seen.add(segmentIndex);
        if (rectsIntersect(index.segments[segmentIndex]!.rect, rect)) {
          return true;
        }
      }
    }
  }

  return false;
}
