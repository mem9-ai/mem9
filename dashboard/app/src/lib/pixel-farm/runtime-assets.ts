import Phaser from "phaser";
import premiumCharacterUrl from "@/assets/game-objects/characters/Premium Charakter Spritesheet.png";
import water1Url from "@/assets/water-frame-1.png";
import water2Url from "@/assets/water-frame-2.png";
import water3Url from "@/assets/water-frame-3.png";
import water4Url from "@/assets/water-frame-4.png";
import {
  PIXEL_FARM_ASSET_SOURCE_CONFIG,
  PIXEL_FARM_ASSET_SOURCE_IDS,
  PIXEL_FARM_TILE_SIZE,
} from "@/lib/pixel-farm/tileset-config";

export const PIXEL_FARM_CHARACTER_TEXTURE_KEY = "pixel-farm-character-premium";
export const PIXEL_FARM_CHARACTER_FRAME_WIDTH = 48;
export const PIXEL_FARM_CHARACTER_FRAME_HEIGHT = 48;

export const PIXEL_FARM_WATER_TEXTURE_KEYS = [
  "pixel-farm-water-1",
  "pixel-farm-water-2",
  "pixel-farm-water-3",
  "pixel-farm-water-4",
] as const;

const PIXEL_FARM_WATER_TEXTURE_URLS = [
  water1Url,
  water2Url,
  water3Url,
  water4Url,
] as const;

export function preloadPixelFarmRuntimeAssets(scene: Phaser.Scene): void {
  for (const sourceId of PIXEL_FARM_ASSET_SOURCE_IDS) {
    const source = PIXEL_FARM_ASSET_SOURCE_CONFIG[sourceId];
    scene.load.spritesheet(source.textureKey, source.imageUrl, {
      frameWidth: PIXEL_FARM_TILE_SIZE,
      frameHeight: PIXEL_FARM_TILE_SIZE,
    });
  }

  for (const [index, textureKey] of PIXEL_FARM_WATER_TEXTURE_KEYS.entries()) {
    scene.load.image(textureKey, PIXEL_FARM_WATER_TEXTURE_URLS[index]!);
  }

  scene.load.spritesheet(PIXEL_FARM_CHARACTER_TEXTURE_KEY, premiumCharacterUrl, {
    frameWidth: PIXEL_FARM_CHARACTER_FRAME_WIDTH,
    frameHeight: PIXEL_FARM_CHARACTER_FRAME_HEIGHT,
  });
}

export function pixelFarmWaterTextureKey(
  index: number,
): (typeof PIXEL_FARM_WATER_TEXTURE_KEYS)[number] {
  return PIXEL_FARM_WATER_TEXTURE_KEYS[index % PIXEL_FARM_WATER_TEXTURE_KEYS.length]!;
}
