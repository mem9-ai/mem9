import bushTilesUrl from "@/assets/Bush_Tiles.png";
import grassDarkTilesUrl from "@/assets/Grass_Tile.png";
import grassLightTilesUrl from "@/assets/Grass_Tile_Lighter.png";
import soilTilesUrl from "@/assets/Soil_Ground_Tiles.png";
import type { PixelFarmMaskLayerId } from "@/lib/pixel-farm/island-mask";

export const PIXEL_FARM_TILE_SIZE = 16;
export const PIXEL_FARM_TILESET_COLUMNS = 11;
export const PIXEL_FARM_BASE_TILESET_ROWS = 7;
export const PIXEL_FARM_BASE_TILESET_FRAME_COUNT =
  PIXEL_FARM_TILESET_COLUMNS * PIXEL_FARM_BASE_TILESET_ROWS;
export const PIXEL_FARM_BUSH_TILESET_ROWS = 11;
export const PIXEL_FARM_BUSH_TILESET_FRAME_COUNT =
  PIXEL_FARM_TILESET_COLUMNS * PIXEL_FARM_BUSH_TILESET_ROWS;
export const PIXEL_FARM_BASE_DEFAULT_FRAME = PIXEL_FARM_TILESET_COLUMNS + 1;
export const PIXEL_FARM_BUSH_DEFAULT_FRAME = 0;

export interface PixelFarmTilesetConfig {
  textureKey: string;
  imageUrl: string;
  columns: number;
  rows: number;
  frameCount: number;
  defaultFrame: number;
}

export const PIXEL_FARM_TILESET_CONFIG: Record<PixelFarmMaskLayerId, PixelFarmTilesetConfig> = {
  soil: {
    textureKey: "pixel-farm-soil-ground",
    imageUrl: soilTilesUrl,
    columns: PIXEL_FARM_TILESET_COLUMNS,
    rows: PIXEL_FARM_BASE_TILESET_ROWS,
    frameCount: PIXEL_FARM_BASE_TILESET_FRAME_COUNT,
    defaultFrame: PIXEL_FARM_BASE_DEFAULT_FRAME,
  },
  grassDark: {
    textureKey: "pixel-farm-grass-dark",
    imageUrl: grassDarkTilesUrl,
    columns: PIXEL_FARM_TILESET_COLUMNS,
    rows: PIXEL_FARM_BASE_TILESET_ROWS,
    frameCount: PIXEL_FARM_BASE_TILESET_FRAME_COUNT,
    defaultFrame: PIXEL_FARM_BASE_DEFAULT_FRAME,
  },
  grassLight: {
    textureKey: "pixel-farm-grass-light",
    imageUrl: grassLightTilesUrl,
    columns: PIXEL_FARM_TILESET_COLUMNS,
    rows: PIXEL_FARM_BASE_TILESET_ROWS,
    frameCount: PIXEL_FARM_BASE_TILESET_FRAME_COUNT,
    defaultFrame: PIXEL_FARM_BASE_DEFAULT_FRAME,
  },
  bush: {
    textureKey: "pixel-farm-bush",
    imageUrl: bushTilesUrl,
    columns: PIXEL_FARM_TILESET_COLUMNS,
    rows: PIXEL_FARM_BUSH_TILESET_ROWS,
    frameCount: PIXEL_FARM_BUSH_TILESET_FRAME_COUNT,
    defaultFrame: PIXEL_FARM_BUSH_DEFAULT_FRAME,
  },
};
