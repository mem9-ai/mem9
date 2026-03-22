import grassDarkTilesUrl from "@/assets/Grass_Tile.png";
import grassLightTilesUrl from "@/assets/Grass_Tile_Lighter.png";
import soilTilesUrl from "@/assets/Soil_Ground_Tiles.png";
import type { PixelFarmMaskLayerId } from "@/lib/pixel-farm/island-mask";

export const PIXEL_FARM_TILE_SIZE = 16;
export const PIXEL_FARM_TILESET_COLUMNS = 11;
export const PIXEL_FARM_TILESET_ROWS = 7;
export const PIXEL_FARM_TILESET_FRAME_COUNT =
  PIXEL_FARM_TILESET_COLUMNS * PIXEL_FARM_TILESET_ROWS;

export const PIXEL_FARM_AUTO_TILE_FRAMES = {
  topLeft: 0,
  top: 1,
  topRight: 2,
  left: PIXEL_FARM_TILESET_COLUMNS,
  center: PIXEL_FARM_TILESET_COLUMNS + 1,
  right: PIXEL_FARM_TILESET_COLUMNS + 2,
  bottomLeft: PIXEL_FARM_TILESET_COLUMNS * 2,
  bottom: PIXEL_FARM_TILESET_COLUMNS * 2 + 1,
  bottomRight: PIXEL_FARM_TILESET_COLUMNS * 2 + 2,
} as const;

export interface PixelFarmTilesetConfig {
  textureKey: string;
  imageUrl: string;
  columns: number;
  rows: number;
  frameCount: number;
}

export const PIXEL_FARM_TILESET_CONFIG: Record<PixelFarmMaskLayerId, PixelFarmTilesetConfig> = {
  soil: {
    textureKey: "pixel-farm-soil-ground",
    imageUrl: soilTilesUrl,
    columns: PIXEL_FARM_TILESET_COLUMNS,
    rows: PIXEL_FARM_TILESET_ROWS,
    frameCount: PIXEL_FARM_TILESET_FRAME_COUNT,
  },
  grassDark: {
    textureKey: "pixel-farm-grass-dark",
    imageUrl: grassDarkTilesUrl,
    columns: PIXEL_FARM_TILESET_COLUMNS,
    rows: PIXEL_FARM_TILESET_ROWS,
    frameCount: PIXEL_FARM_TILESET_FRAME_COUNT,
  },
  grassLight: {
    textureKey: "pixel-farm-grass-light",
    imageUrl: grassLightTilesUrl,
    columns: PIXEL_FARM_TILESET_COLUMNS,
    rows: PIXEL_FARM_TILESET_ROWS,
    frameCount: PIXEL_FARM_TILESET_FRAME_COUNT,
  },
};
