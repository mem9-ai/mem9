import barnStructuresUrl from "@/assets/barn-structures.png";
import boatsUrl from "@/assets/boats.png";
import bushTilesUrl from "@/assets/bush-tiles.png";
import chickenHousesUrl from "@/assets/chicken-houses.png";
import farmingPlantsUrl from "@/assets/farming-plants.png";
import fencesUrl from "@/assets/fences.png";
import grassHillTilesSlopesUrl from "@/assets/grass-hill-tiles-slopes-v2.png";
import grassHillTilesUrl from "@/assets/grass-hill-tiles-v2.png";
import grassDarkTilesUrl from "@/assets/grass-tile.png";
import grassLightTilesUrl from "@/assets/grass-tile-lighter.png";
import mushroomsFlowersStonesUrl from "@/assets/mushrooms-flowers-stones.png";
import signsUrl from "@/assets/signs.png";
import signsSidesUrl from "@/assets/signs-sides.png";
import soilTilesUrl from "@/assets/soil-ground-tiles.png";
import stonePathUrl from "@/assets/stone-path.png";
import tiledDirtUrl from "@/assets/tiled-dirt.png";
import tilledDirtWideUrl from "@/assets/tilled-dirt-wide.png";
import treesStumpsBushesUrl from "@/assets/trees-stumps-bushes.png";
import waterObjectsUrl from "@/assets/water-objects.png";
import waterTrayUrl from "@/assets/water-tray.png";
import waterWellUrl from "@/assets/water-well.png";
import woodenBridgeUrl from "@/assets/wooden-bridge-v2.png";
import workStationUrl from "@/assets/work-station.png";

export const PIXEL_FARM_TILE_SIZE = 16;
export const PIXEL_FARM_BASE_DEFAULT_FRAME = 12;

export const PIXEL_FARM_ASSET_SOURCE_IDS = [
  "soil",
  "tiledDirt",
  "tilledDirtWide",
  "grassDark",
  "grassLight",
  "grassHill",
  "grassHillSlopes",
  "bush",
  "stonePath",
  "fences",
  "woodenBridge",
  "barnStructures",
  "chickenHouses",
  "farmingPlants",
  "mushroomsFlowersStones",
  "treesStumpsBushes",
  "boats",
  "waterTray",
  "waterObjects",
  "waterWell",
  "signs",
  "signsSides",
  "workStation",
] as const;

export type PixelFarmAssetSourceId = (typeof PIXEL_FARM_ASSET_SOURCE_IDS)[number];

export interface PixelFarmAssetTileSelection {
  sourceId: PixelFarmAssetSourceId;
  frame: number;
}

export interface PixelFarmAssetSourceConfig {
  textureKey: string;
  imageUrl: string;
  columns: number;
  rows: number;
  frameCount: number;
  defaultFrame: number;
}

function defineAssetSource(
  textureKey: string,
  imageUrl: string,
  columns: number,
  rows: number,
  defaultFrame = 0,
): PixelFarmAssetSourceConfig {
  return {
    textureKey,
    imageUrl,
    columns,
    rows,
    frameCount: columns * rows,
    defaultFrame,
  };
}

export const PIXEL_FARM_ASSET_SOURCE_CONFIG: Record<
  PixelFarmAssetSourceId,
  PixelFarmAssetSourceConfig
> = {
  soil: defineAssetSource("pixel-farm-soil-ground", soilTilesUrl, 11, 7, PIXEL_FARM_BASE_DEFAULT_FRAME),
  tiledDirt: defineAssetSource("pixel-farm-tiled-dirt", tiledDirtUrl, 11, 7, PIXEL_FARM_BASE_DEFAULT_FRAME),
  tilledDirtWide: defineAssetSource(
    "pixel-farm-tilled-dirt-wide",
    tilledDirtWideUrl,
    11,
    7,
    PIXEL_FARM_BASE_DEFAULT_FRAME,
  ),
  grassDark: defineAssetSource(
    "pixel-farm-grass-dark",
    grassDarkTilesUrl,
    11,
    7,
    PIXEL_FARM_BASE_DEFAULT_FRAME,
  ),
  grassLight: defineAssetSource(
    "pixel-farm-grass-light",
    grassLightTilesUrl,
    11,
    7,
    PIXEL_FARM_BASE_DEFAULT_FRAME,
  ),
  grassHill: defineAssetSource("pixel-farm-grass-hill", grassHillTilesUrl, 11, 7, PIXEL_FARM_BASE_DEFAULT_FRAME),
  grassHillSlopes: defineAssetSource(
    "pixel-farm-grass-hill-slopes",
    grassHillTilesSlopesUrl,
    6,
    3,
  ),
  bush: defineAssetSource("pixel-farm-bush", bushTilesUrl, 11, 11),
  stonePath: defineAssetSource("pixel-farm-stone-path", stonePathUrl, 4, 4),
  fences: defineAssetSource("pixel-farm-fences", fencesUrl, 8, 4),
  woodenBridge: defineAssetSource("pixel-farm-wooden-bridge", woodenBridgeUrl, 4, 3),
  barnStructures: defineAssetSource("pixel-farm-barn-structures", barnStructuresUrl, 3, 4),
  chickenHouses: defineAssetSource("pixel-farm-chicken-houses", chickenHousesUrl, 24, 11),
  farmingPlants: defineAssetSource("pixel-farm-farming-plants", farmingPlantsUrl, 5, 15),
  mushroomsFlowersStones: defineAssetSource(
    "pixel-farm-mushrooms-flowers-stones",
    mushroomsFlowersStonesUrl,
    12,
    5,
  ),
  treesStumpsBushes: defineAssetSource(
    "pixel-farm-trees-stumps-bushes",
    treesStumpsBushesUrl,
    12,
    7,
  ),
  boats: defineAssetSource("pixel-farm-boats", boatsUrl, 9, 6),
  waterTray: defineAssetSource("pixel-farm-water-tray", waterTrayUrl, 6, 1),
  waterObjects: defineAssetSource("pixel-farm-water-objects", waterObjectsUrl, 12, 2),
  waterWell: defineAssetSource("pixel-farm-water-well", waterWellUrl, 2, 2),
  signs: defineAssetSource("pixel-farm-signs", signsUrl, 6, 4),
  signsSides: defineAssetSource("pixel-farm-signs-sides", signsSidesUrl, 8, 2),
  workStation: defineAssetSource("pixel-farm-work-station", workStationUrl, 2, 2),
};

export type PixelFarmTilesetConfig = PixelFarmAssetSourceConfig;
export const PIXEL_FARM_TILESET_CONFIG = PIXEL_FARM_ASSET_SOURCE_CONFIG;
