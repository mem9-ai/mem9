import Phaser from "phaser";
import soilGroundTilesUrl from "@/assets/Soil_Ground_Tiles.png";
import water1Url from "@/assets/Water_1.png";
import water2Url from "@/assets/Water_2.png";
import water3Url from "@/assets/Water_3.png";
import water4Url from "@/assets/Water_4.png";

const WATER_TILE_SIZE = 16;
const WATER_FRAME_DELAY = 180;
const BACKGROUND_COLOR = 0x0d141b;
const WATER_TEXTURE_KEYS = [
  "pixel-farm-water-1",
  "pixel-farm-water-2",
  "pixel-farm-water-3",
  "pixel-farm-water-4",
] as const;
const SOIL_TILESET_KEY = "pixel-farm-soil-ground";
const SOIL_TILESET_COLUMNS = 11;
const SOIL_FRAME = {
  topLeft: 0,
  top: 1,
  topRight: 2,
  left: SOIL_TILESET_COLUMNS,
  center: SOIL_TILESET_COLUMNS + 1,
  right: SOIL_TILESET_COLUMNS + 2,
  bottomLeft: SOIL_TILESET_COLUMNS * 2,
  bottom: SOIL_TILESET_COLUMNS * 2 + 1,
  bottomRight: SOIL_TILESET_COLUMNS * 2 + 2,
} as const;

interface WaterTile {
  sprite: Phaser.GameObjects.Image;
  phase: number;
}

function waterTextureKey(index: number): (typeof WATER_TEXTURE_KEYS)[number] {
  return WATER_TEXTURE_KEYS[index % WATER_TEXTURE_KEYS.length]!;
}

function soilFrameForTile(
  hasUp: boolean,
  hasRight: boolean,
  hasDown: boolean,
  hasLeft: boolean,
): number {
  if (!hasUp && !hasLeft) {
    return SOIL_FRAME.topLeft;
  }

  if (!hasUp && !hasRight) {
    return SOIL_FRAME.topRight;
  }

  if (!hasDown && !hasLeft) {
    return SOIL_FRAME.bottomLeft;
  }

  if (!hasDown && !hasRight) {
    return SOIL_FRAME.bottomRight;
  }

  if (!hasUp) {
    return SOIL_FRAME.top;
  }

  if (!hasDown) {
    return SOIL_FRAME.bottom;
  }

  if (!hasLeft) {
    return SOIL_FRAME.left;
  }

  if (!hasRight) {
    return SOIL_FRAME.right;
  }

  return SOIL_FRAME.center;
}

class PixelFarmSandboxScene extends Phaser.Scene {
  private oceanLayer?: Phaser.GameObjects.Container;
  private terrainLayer?: Phaser.GameObjects.Container;
  private structureLayer?: Phaser.GameObjects.Container;
  private effectsLayer?: Phaser.GameObjects.Container;
  private waterTiles: WaterTile[] = [];
  private waterFrame = 0;
  private waterTimer?: Phaser.Time.TimerEvent;

  constructor() {
    super("pixel-farm-sandbox");
  }

  preload(): void {
    this.load.spritesheet(SOIL_TILESET_KEY, soilGroundTilesUrl, {
      frameWidth: WATER_TILE_SIZE,
      frameHeight: WATER_TILE_SIZE,
    });
    this.load.image(WATER_TEXTURE_KEYS[0], water1Url);
    this.load.image(WATER_TEXTURE_KEYS[1], water2Url);
    this.load.image(WATER_TEXTURE_KEYS[2], water3Url);
    this.load.image(WATER_TEXTURE_KEYS[3], water4Url);
  }

  create(): void {
    this.oceanLayer = this.add.container(0, 0);
    this.terrainLayer = this.add.container(0, 0);
    this.structureLayer = this.add.container(0, 0);
    this.effectsLayer = this.add.container(0, 0);
    this.layoutLayers();

    this.cameras.main.setBackgroundColor(BACKGROUND_COLOR);

    this.redraw();

    this.waterTimer = this.time.addEvent({
      delay: WATER_FRAME_DELAY,
      loop: true,
      callback: this.advanceWaterFrame,
      callbackScope: this,
    });

    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);
  }

  private handleResize(): void {
    this.redraw();
  }

  private handleShutdown(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.waterTimer?.destroy();
  }

  private redraw(): void {
    if (!this.oceanLayer || !this.terrainLayer) {
      return;
    }

    const width = this.scale.width;
    const height = this.scale.height;

    this.rebuildOcean(width, height);
    this.rebuildIsland(width, height);
  }

  private layoutLayers(): void {
    this.oceanLayer?.setDepth(0);
    this.terrainLayer?.setDepth(10);
    this.structureLayer?.setDepth(20);
    this.effectsLayer?.setDepth(30);
  }

  private rebuildOcean(width: number, height: number): void {
    if (!this.oceanLayer) {
      return;
    }

    this.oceanLayer.removeAll(true);
    this.waterTiles = [];

    const columns = Math.ceil(width / WATER_TILE_SIZE) + 1;
    const rows = Math.ceil(height / WATER_TILE_SIZE) + 1;

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const phase = (row + column) % WATER_TEXTURE_KEYS.length < 2 ? 0 : 2;
        const frameIndex = (this.waterFrame + phase) % WATER_TEXTURE_KEYS.length;
        const sprite = this.add.image(
          column * WATER_TILE_SIZE,
          row * WATER_TILE_SIZE,
          waterTextureKey(frameIndex),
        );

        sprite.setOrigin(0, 0);
        this.oceanLayer.add(sprite);
        this.waterTiles.push({ sprite, phase });
      }
    }
  }

  private advanceWaterFrame(): void {
    this.waterFrame = (this.waterFrame + 1) % WATER_TEXTURE_KEYS.length;

    for (const tile of this.waterTiles) {
      const frameIndex = (this.waterFrame + tile.phase) % WATER_TEXTURE_KEYS.length;
      tile.sprite.setTexture(waterTextureKey(frameIndex));
    }
  }

  private rebuildIsland(width: number, height: number): void {
    if (!this.terrainLayer) {
      return;
    }

    this.terrainLayer.removeAll(true);

    const tile = WATER_TILE_SIZE;
    const viewportColumns = Math.ceil(width / tile);
    const viewportRows = Math.ceil(height / tile);
    const islandColumns = Math.max(Math.floor(viewportColumns * 0.54), 18);
    const islandRows = Math.max(Math.floor(viewportRows * 0.38), 12);
    const startColumn = Math.floor((viewportColumns - islandColumns) / 2);
    const startRow = Math.floor((viewportRows - islandRows) / 2);
    const mask = this.buildIslandMask(islandColumns, islandRows);

    for (let row = 0; row < islandRows; row += 1) {
      for (let column = 0; column < islandColumns; column += 1) {
        if (!mask[row]?.[column]) {
          continue;
        }

        const hasUp = Boolean(mask[row - 1]?.[column]);
        const hasRight = Boolean(mask[row]?.[column + 1]);
        const hasDown = Boolean(mask[row + 1]?.[column]);
        const hasLeft = Boolean(mask[row]?.[column - 1]);
        const sprite = this.add.image(
          (startColumn + column) * tile,
          (startRow + row) * tile,
          SOIL_TILESET_KEY,
          soilFrameForTile(hasUp, hasRight, hasDown, hasLeft),
        );

        sprite.setOrigin(0, 0);
        this.terrainLayer.add(sprite);
      }
    }
  }

  private buildIslandMask(columns: number, rows: number): boolean[][] {
    const mask = Array.from({ length: rows }, () => Array.from({ length: columns }, () => false));
    const cornerCut = Math.max(Math.floor(Math.min(columns, rows) * 0.22), 4);

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const top = row;
        const left = column;
        const right = columns - 1 - column;
        const bottom = rows - 1 - row;

        let visible = true;

        if (top < cornerCut && left < cornerCut) {
          visible = top + left >= cornerCut - 2;
        } else if (top < cornerCut && right < cornerCut) {
          visible = top + right >= cornerCut - 2;
        } else if (bottom < cornerCut && left < cornerCut) {
          visible = bottom + left >= cornerCut - 2;
        } else if (bottom < cornerCut && right < cornerCut) {
          visible = bottom + right >= cornerCut - 2;
        }

        mask[row]![column] = visible;
      }
    }

    return mask;
  }
}

export function createPixelFarmGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: "#0d141b",
    pixelArt: true,
    scene: [PixelFarmSandboxScene],
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: parent.clientWidth,
      height: parent.clientHeight,
    },
    render: {
      antialias: false,
      antialiasGL: false,
      pixelArt: true,
      roundPixels: true,
      powerPreference: "high-performance",
    },
  });
}
