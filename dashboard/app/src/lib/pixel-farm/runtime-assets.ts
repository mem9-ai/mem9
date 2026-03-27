import Phaser from "phaser";
import bgmFullLoopUrl from "@/assets/audio/bgm10-full-loop.opus";
import bubbleAppearSoundUrl from "@/assets/audio/blup_1.wav";
import babyCowBrownUrl from "@/assets/game-objects/animals/cow-baby/cow-baby-brown-spritesheet.png";
import babyCowGreenUrl from "@/assets/game-objects/animals/cow-baby/cow-baby-green-spritesheet.png";
import babyCowLightUrl from "@/assets/game-objects/animals/cow-baby/cow-baby-light-spritesheet.png";
import babyCowPinkUrl from "@/assets/game-objects/animals/cow-baby/cow-baby-pink-spritesheet.png";
import babyCowPurpleUrl from "@/assets/game-objects/animals/cow-baby/cow-baby-purple-spritesheet.png";
import chickenBlueUrl from "@/assets/game-objects/animals/chicken/chicken-blue-spritesheet.png";
import chickenBrownUrl from "@/assets/game-objects/animals/chicken/chicken-brown-spritesheet.png";
import chickenDefaultUrl from "@/assets/game-objects/animals/chicken/chicken-default-spritesheet.png";
import chickenGreenUrl from "@/assets/game-objects/animals/chicken/chicken-green-spritesheet.png";
import chickenRedUrl from "@/assets/game-objects/animals/chicken/chicken-red-spritesheet.png";
import cowBrownUrl from "@/assets/game-objects/animals/cow/cow-brown-spritesheet.png";
import cowGreenUrl from "@/assets/game-objects/animals/cow/cow-green-spritesheet.png";
import cowLightUrl from "@/assets/game-objects/animals/cow/cow-light-spritesheet.png";
import cowPinkUrl from "@/assets/game-objects/animals/cow/cow-pink-spritesheet.png";
import cowPurpleUrl from "@/assets/game-objects/animals/cow/cow-purple-spritesheet.png";
import dialogBoxUrl from "@/assets/ui/dialog-box.png";
import mouseCursorUrl from "@/assets/ui/mouse.png";
import premiumCharacterUrl from "@/assets/game-objects/characters/premium-character-spritesheet.png";
import water1Url from "@/assets/water-frame-1.png";
import water2Url from "@/assets/water-frame-2.png";
import water3Url from "@/assets/water-frame-3.png";
import water4Url from "@/assets/water-frame-4.png";
import {
  PIXEL_FARM_ASSET_SOURCE_CONFIG,
  PIXEL_FARM_ASSET_SOURCE_IDS,
  PIXEL_FARM_TILE_SIZE,
} from "@/lib/pixel-farm/tileset-config";

export const PIXEL_FARM_BUBBLE_APPEAR_SOUND_KEY = "pixel-farm-bubble-appear";
export const PIXEL_FARM_BUBBLE_APPEAR_SOUND_DURATION_MS = 500;
export const PIXEL_FARM_BGM_TEXTURE_KEY = "pixel-farm-bgm";
export const PIXEL_FARM_DIALOG_TEXTURE_KEY = "pixel-farm-dialog-box";
export const PIXEL_FARM_MOUSE_CURSOR_TEXTURE_KEY = "pixel-farm-mouse-cursor";

export const PIXEL_FARM_CHARACTER_TEXTURE_KEY = "pixel-farm-character-premium";
export const PIXEL_FARM_CHARACTER_FRAME_WIDTH = 48;
export const PIXEL_FARM_CHARACTER_FRAME_HEIGHT = 48;
export const PIXEL_FARM_COW_FRAME_WIDTH = 32;
export const PIXEL_FARM_COW_FRAME_HEIGHT = 32;
export const PIXEL_FARM_BABY_COW_FRAME_WIDTH = 32;
export const PIXEL_FARM_BABY_COW_FRAME_HEIGHT = 32;

export const PIXEL_FARM_COW_TEXTURE_KEYS = {
  brown: "pixel-farm-cow-brown",
  green: "pixel-farm-cow-green",
  light: "pixel-farm-cow-light",
  pink: "pixel-farm-cow-pink",
  purple: "pixel-farm-cow-purple",
} as const;

export const PIXEL_FARM_BABY_COW_TEXTURE_KEYS = {
  brown: "pixel-farm-baby-cow-brown",
  green: "pixel-farm-baby-cow-green",
  light: "pixel-farm-baby-cow-light",
  pink: "pixel-farm-baby-cow-pink",
  purple: "pixel-farm-baby-cow-purple",
} as const;

export const PIXEL_FARM_CHICKEN_TEXTURE_KEYS = {
  blue: "pixel-farm-chicken-blue",
  brown: "pixel-farm-chicken-brown",
  default: "pixel-farm-chicken-default",
  green: "pixel-farm-chicken-green",
  red: "pixel-farm-chicken-red",
} as const;

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

const PIXEL_FARM_COW_TEXTURE_URLS: Record<keyof typeof PIXEL_FARM_COW_TEXTURE_KEYS, string> = {
  brown: cowBrownUrl,
  green: cowGreenUrl,
  light: cowLightUrl,
  pink: cowPinkUrl,
  purple: cowPurpleUrl,
};

const PIXEL_FARM_BABY_COW_TEXTURE_URLS: Record<
  keyof typeof PIXEL_FARM_BABY_COW_TEXTURE_KEYS,
  string
> = {
  brown: babyCowBrownUrl,
  green: babyCowGreenUrl,
  light: babyCowLightUrl,
  pink: babyCowPinkUrl,
  purple: babyCowPurpleUrl,
};

const PIXEL_FARM_CHICKEN_TEXTURE_URLS: Record<
  keyof typeof PIXEL_FARM_CHICKEN_TEXTURE_KEYS,
  string
> = {
  blue: chickenBlueUrl,
  brown: chickenBrownUrl,
  default: chickenDefaultUrl,
  green: chickenGreenUrl,
  red: chickenRedUrl,
};

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

  scene.load.image(PIXEL_FARM_DIALOG_TEXTURE_KEY, dialogBoxUrl);
  scene.load.audio(PIXEL_FARM_BUBBLE_APPEAR_SOUND_KEY, bubbleAppearSoundUrl);
  scene.load.audio(PIXEL_FARM_BGM_TEXTURE_KEY, bgmFullLoopUrl);

  scene.load.spritesheet(PIXEL_FARM_CHARACTER_TEXTURE_KEY, premiumCharacterUrl, {
    frameWidth: PIXEL_FARM_CHARACTER_FRAME_WIDTH,
    frameHeight: PIXEL_FARM_CHARACTER_FRAME_HEIGHT,
  });

  for (const [color, textureKey] of Object.entries(PIXEL_FARM_COW_TEXTURE_KEYS) as Array<
    [keyof typeof PIXEL_FARM_COW_TEXTURE_KEYS, string]
  >) {
    scene.load.spritesheet(textureKey, PIXEL_FARM_COW_TEXTURE_URLS[color], {
      frameWidth: PIXEL_FARM_COW_FRAME_WIDTH,
      frameHeight: PIXEL_FARM_COW_FRAME_HEIGHT,
    });
  }

  for (const [color, textureKey] of Object.entries(PIXEL_FARM_BABY_COW_TEXTURE_KEYS) as Array<
    [keyof typeof PIXEL_FARM_BABY_COW_TEXTURE_KEYS, string]
  >) {
    scene.load.spritesheet(textureKey, PIXEL_FARM_BABY_COW_TEXTURE_URLS[color], {
      frameWidth: PIXEL_FARM_BABY_COW_FRAME_WIDTH,
      frameHeight: PIXEL_FARM_BABY_COW_FRAME_HEIGHT,
    });
  }

  for (const [color, textureKey] of Object.entries(PIXEL_FARM_CHICKEN_TEXTURE_KEYS) as Array<
    [keyof typeof PIXEL_FARM_CHICKEN_TEXTURE_KEYS, string]
  >) {
    scene.load.image(textureKey, PIXEL_FARM_CHICKEN_TEXTURE_URLS[color]);
  }
}

export function preloadPixelFarmDialogAsset(scene: Phaser.Scene): void {
  scene.load.image(PIXEL_FARM_DIALOG_TEXTURE_KEY, dialogBoxUrl);
  scene.load.image(PIXEL_FARM_MOUSE_CURSOR_TEXTURE_KEY, mouseCursorUrl);
}

export function pixelFarmWaterTextureKey(
  index: number,
): (typeof PIXEL_FARM_WATER_TEXTURE_KEYS)[number] {
  return PIXEL_FARM_WATER_TEXTURE_KEYS[index % PIXEL_FARM_WATER_TEXTURE_KEYS.length]!;
}
