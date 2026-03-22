import { maskHasTile } from "@/lib/pixel-farm/island-mask";
import { PIXEL_FARM_AUTO_TILE_FRAMES } from "@/lib/pixel-farm/tileset-config";

export function pixelFarmAutoTileFrame(
  mask: readonly string[],
  row: number,
  column: number,
): number {
  const hasUp = maskHasTile(mask, row - 1, column);
  const hasRight = maskHasTile(mask, row, column + 1);
  const hasDown = maskHasTile(mask, row + 1, column);
  const hasLeft = maskHasTile(mask, row, column - 1);

  if (!hasUp && !hasLeft) {
    return PIXEL_FARM_AUTO_TILE_FRAMES.topLeft;
  }

  if (!hasUp && !hasRight) {
    return PIXEL_FARM_AUTO_TILE_FRAMES.topRight;
  }

  if (!hasDown && !hasLeft) {
    return PIXEL_FARM_AUTO_TILE_FRAMES.bottomLeft;
  }

  if (!hasDown && !hasRight) {
    return PIXEL_FARM_AUTO_TILE_FRAMES.bottomRight;
  }

  if (!hasUp) {
    return PIXEL_FARM_AUTO_TILE_FRAMES.top;
  }

  if (!hasDown) {
    return PIXEL_FARM_AUTO_TILE_FRAMES.bottom;
  }

  if (!hasLeft) {
    return PIXEL_FARM_AUTO_TILE_FRAMES.left;
  }

  if (!hasRight) {
    return PIXEL_FARM_AUTO_TILE_FRAMES.right;
  }

  return PIXEL_FARM_AUTO_TILE_FRAMES.center;
}
