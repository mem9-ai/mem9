import type { PixelFarmBabyCowColor } from "@/lib/pixel-farm/baby-cow";
import type { PixelFarmChickenColor } from "@/lib/pixel-farm/chicken";
import type { PixelFarmCowColor } from "@/lib/pixel-farm/cow";
import type { PixelFarmAssetTileSelection } from "@/lib/pixel-farm/tileset-config";

const FARMING_PLANTS_COLUMNS = 5;
const MUSHROOMS_FLOWERS_STONES_COLUMNS = 12;

export const PIXEL_FARM_MAIN_FIELD_COUNT = 5;
export const PIXEL_FARM_TOP_CROP_TAG_COUNT = 13;

export type PixelFarmCropStage = "seed" | "sprout" | "growing" | "mature";
export type PixelFarmBucketAnimalTier = "chicken" | "baby-cow" | "cow";

export interface PixelFarmCropFamilyPalette {
  family: string;
  stages: Record<PixelFarmCropStage, PixelFarmAssetTileSelection>;
}

export interface PixelFarmDecorationPalette {
  family: string;
  frames: PixelFarmAssetTileSelection[];
}

export interface PixelFarmBucketAnimalPalette {
  color: PixelFarmBabyCowColor | PixelFarmChickenColor | PixelFarmCowColor;
  tier: PixelFarmBucketAnimalTier;
  type: PixelFarmBucketAnimalTier;
}

function frameAt(columns: number, row: number, column: number): number {
  return row * columns + column;
}

function farmingPlant(row: number, column: number): PixelFarmAssetTileSelection {
  return {
    sourceId: "farmingPlants",
    frame: frameAt(FARMING_PLANTS_COLUMNS, row, column),
  };
}

function otherDecoration(row: number, column: number): PixelFarmAssetTileSelection {
  return {
    sourceId: "mushroomsFlowersStones",
    frame: frameAt(MUSHROOMS_FLOWERS_STONES_COLUMNS, row, column),
  };
}

function singleTileCropPalette(row: number, family: string): PixelFarmCropFamilyPalette {
  return {
    family,
    stages: {
      // Normal crop rows use four populated columns; the last column is blank.
      seed: farmingPlant(row, 0),
      sprout: farmingPlant(row, 1),
      growing: farmingPlant(row, 2),
      mature: farmingPlant(row, 3),
    },
  };
}

// ---------------------------------------------------------------------------
// Main field crops
// ---------------------------------------------------------------------------

// Avoid the first farmingPlants row for now. The user flagged the corn row as
// visually tall, so keep it out of the base bucket maturity chain.
export const PIXEL_FARM_CROP_BUCKET_PALETTES: readonly PixelFarmCropFamilyPalette[] = [
  singleTileCropPalette(2, "crop-01"),
  singleTileCropPalette(3, "crop-02"),
  singleTileCropPalette(4, "crop-03"),
  singleTileCropPalette(5, "crop-04"),
  singleTileCropPalette(6, "crop-05"),
  singleTileCropPalette(7, "crop-06"),
  singleTileCropPalette(8, "crop-07"),
  singleTileCropPalette(9, "crop-08"),
  singleTileCropPalette(10, "crop-09"),
  singleTileCropPalette(11, "crop-10"),
  singleTileCropPalette(12, "crop-11"),
  singleTileCropPalette(13, "crop-12"),
  singleTileCropPalette(14, "crop-13"),
] as const;

export const PIXEL_FARM_SPECIAL_TALL_CROP_CANDIDATE: PixelFarmCropFamilyPalette = {
  family: "corn",
  stages: {
    seed: farmingPlant(0, 0),
    sprout: farmingPlant(0, 1),
    growing: farmingPlant(0, 2),
    mature: farmingPlant(0, 4),
  },
};

// ---------------------------------------------------------------------------
// Other zone decorations
// ---------------------------------------------------------------------------

// Confirmed sheet usage for v1:
// row 0 col 0-2: red mushroom small -> large
// row 1 col 0-5: stones small -> large
// row 2 col 0-3: grass small -> large
export const PIXEL_FARM_OTHER_ZONE_DECORATIONS = {
  grass: {
    family: "grass",
    frames: [
      otherDecoration(2, 0),
      otherDecoration(2, 1),
      otherDecoration(2, 2),
      otherDecoration(2, 3),
    ],
  },
  redMushroom: {
    family: "red-mushroom",
    frames: [
      otherDecoration(0, 0),
      otherDecoration(0, 1),
      otherDecoration(0, 2),
    ],
  },
  stone: {
    family: "stone",
    frames: [
      otherDecoration(1, 0),
      otherDecoration(1, 1),
      otherDecoration(1, 2),
      otherDecoration(1, 3),
      otherDecoration(1, 4),
      otherDecoration(1, 5),
    ],
  },
} as const satisfies Record<string, PixelFarmDecorationPalette>;

// ---------------------------------------------------------------------------
// Bucket animals
// ---------------------------------------------------------------------------

export const PIXEL_FARM_BUCKET_ANIMAL_PALETTES: readonly PixelFarmBucketAnimalPalette[] = [
  {
    tier: "chicken",
    type: "chicken",
    color: "default",
  },
  {
    tier: "baby-cow",
    type: "baby-cow",
    color: "brown",
  },
  {
    tier: "cow",
    type: "cow",
    color: "brown",
  },
] as const;
