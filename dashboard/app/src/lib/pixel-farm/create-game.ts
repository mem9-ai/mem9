import Phaser from "phaser";
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
const ISLAND_SAND_COLOR = 0xe0cb86;
const ISLAND_GRASS_COLOR = 0x6fb85d;
const ISLAND_SHADOW_COLOR = 0x4f8a4a;

interface WaterTile {
  sprite: Phaser.GameObjects.Image;
  phase: number;
}

function waterTextureKey(index: number): (typeof WATER_TEXTURE_KEYS)[number] {
  return WATER_TEXTURE_KEYS[index % WATER_TEXTURE_KEYS.length]!;
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
    const centerX = Math.floor(width / 2 / tile) * tile;
    const centerY = Math.floor(height / 2 / tile) * tile;
    const sandRadiusX = Math.max(Math.floor(width / tile / 5), 10);
    const sandRadiusY = Math.max(Math.floor(height / tile / 6), 7);
    const grassRadiusX = Math.max(sandRadiusX - 2, 6);
    const grassRadiusY = Math.max(sandRadiusY - 2, 4);

    const shadow = this.add.graphics();
    shadow.fillStyle(ISLAND_SHADOW_COLOR, 0.35);
    shadow.fillEllipse(centerX, centerY + tile * 2.5, sandRadiusX * tile * 1.8, sandRadiusY * tile);
    this.terrainLayer.add(shadow);

    const sand = this.add.graphics();
    const grass = this.add.graphics();

    for (let row = -sandRadiusY; row <= sandRadiusY; row += 1) {
      for (let column = -sandRadiusX; column <= sandRadiusX; column += 1) {
        const sandDistance =
          (column * column) / (sandRadiusX * sandRadiusX) +
          (row * row) / (sandRadiusY * sandRadiusY);
        const grassDistance =
          (column * column) / (grassRadiusX * grassRadiusX) +
          (row * row) / (grassRadiusY * grassRadiusY);
        const x = centerX + column * tile;
        const y = centerY + row * tile;

        if (sandDistance <= 1) {
          sand.fillStyle(ISLAND_SAND_COLOR, 1);
          sand.fillRect(x, y, tile, tile);
        }

        if (grassDistance <= 1) {
          grass.fillStyle(ISLAND_GRASS_COLOR, 1);
          grass.fillRect(x, y, tile, tile);
        }
      }
    }

    this.terrainLayer.add([sand, grass]);
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
