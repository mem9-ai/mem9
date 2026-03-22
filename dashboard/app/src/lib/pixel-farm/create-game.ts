import Phaser from "phaser";
import water1Url from "@/assets/water-frame-1.png";
import water2Url from "@/assets/water-frame-2.png";
import water3Url from "@/assets/water-frame-3.png";
import water4Url from "@/assets/water-frame-4.png";
import {
  maskHasTile,
  PIXEL_FARM_LAYERS,
  PIXEL_FARM_MASK_BOUNDS,
  PIXEL_FARM_MASK_COLUMNS,
  PIXEL_FARM_MASK_ROWS,
  PIXEL_FARM_OBJECTS,
  tileOverrideAt,
} from "@/lib/pixel-farm/island-mask";
import {
  PIXEL_FARM_ASSET_SOURCE_CONFIG,
  PIXEL_FARM_ASSET_SOURCE_IDS,
  PIXEL_FARM_TILE_SIZE,
} from "@/lib/pixel-farm/tileset-config";

const WATER_FRAME_DELAY = 180;
const BACKGROUND_COLOR = 0x0d141b;
const WORLD_COLUMNS = 128;
const WORLD_ROWS = 96;
const ISLAND_COLUMNS = PIXEL_FARM_MASK_COLUMNS;
const ISLAND_ROWS = PIXEL_FARM_MASK_ROWS;
const CAMERA_MAX_ZOOM = 3;
const CAMERA_TARGET_FILL = 0.8;
const CAMERA_ZOOM_STEP = 0.12;
const WORLD_PIXEL_WIDTH = WORLD_COLUMNS * PIXEL_FARM_TILE_SIZE;
const WORLD_PIXEL_HEIGHT = WORLD_ROWS * PIXEL_FARM_TILE_SIZE;
const ISLAND_PIXEL_WIDTH = PIXEL_FARM_MASK_BOUNDS.width * PIXEL_FARM_TILE_SIZE;
const ISLAND_PIXEL_HEIGHT = PIXEL_FARM_MASK_BOUNDS.height * PIXEL_FARM_TILE_SIZE;
const ISLAND_START_COLUMN = Math.floor((WORLD_COLUMNS - ISLAND_COLUMNS) / 2);
const ISLAND_START_ROW = Math.floor((WORLD_ROWS - ISLAND_ROWS) / 2);
const ISLAND_CENTER_X =
  ISLAND_START_COLUMN * PIXEL_FARM_TILE_SIZE +
  (PIXEL_FARM_MASK_BOUNDS.minColumn + PIXEL_FARM_MASK_BOUNDS.maxColumn + 1) *
    PIXEL_FARM_TILE_SIZE *
    0.5;
const ISLAND_CENTER_Y =
  ISLAND_START_ROW * PIXEL_FARM_TILE_SIZE +
  (PIXEL_FARM_MASK_BOUNDS.minRow + PIXEL_FARM_MASK_BOUNDS.maxRow + 1) *
    PIXEL_FARM_TILE_SIZE *
    0.5;
const WATER_TEXTURE_KEYS = [
  "pixel-farm-water-1",
  "pixel-farm-water-2",
  "pixel-farm-water-3",
  "pixel-farm-water-4",
] as const;

interface WaterTile {
  sprite: Phaser.GameObjects.Image;
  phase: number;
}

interface DragState {
  active: boolean;
  pointerId: number | null;
  lastX: number;
  lastY: number;
}

function waterTextureKey(index: number): (typeof WATER_TEXTURE_KEYS)[number] {
  return WATER_TEXTURE_KEYS[index % WATER_TEXTURE_KEYS.length]!;
}

class PixelFarmSandboxScene extends Phaser.Scene {
  private oceanLayer?: Phaser.GameObjects.Container;
  private worldLayer?: Phaser.GameObjects.Container;
  private effectsLayer?: Phaser.GameObjects.Container;
  private waterTiles: WaterTile[] = [];
  private waterFrame = 0;
  private waterTimer?: Phaser.Time.TimerEvent;
  private dragState: DragState = {
    active: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
  };
  private hasCameraInteraction = false;

  constructor() {
    super("pixel-farm-sandbox");
  }

  preload(): void {
    for (const sourceId of PIXEL_FARM_ASSET_SOURCE_IDS) {
      const source = PIXEL_FARM_ASSET_SOURCE_CONFIG[sourceId];
      this.load.spritesheet(source.textureKey, source.imageUrl, {
        frameWidth: PIXEL_FARM_TILE_SIZE,
        frameHeight: PIXEL_FARM_TILE_SIZE,
      });
    }

    this.load.image(WATER_TEXTURE_KEYS[0], water1Url);
    this.load.image(WATER_TEXTURE_KEYS[1], water2Url);
    this.load.image(WATER_TEXTURE_KEYS[2], water3Url);
    this.load.image(WATER_TEXTURE_KEYS[3], water4Url);
  }

  create(): void {
    this.oceanLayer = this.add.container(0, 0);
    this.worldLayer = this.add.container(0, 0);
    this.effectsLayer = this.add.container(0, 0);
    this.layoutLayers();

    this.cameras.main.setBackgroundColor(BACKGROUND_COLOR);
    this.cameras.main.setBounds(0, 0, WORLD_PIXEL_WIDTH, WORLD_PIXEL_HEIGHT);
    this.cameras.main.setRoundPixels(true);

    this.rebuildWorld();
    this.fitCameraToIsland();
    this.bindCameraControls();

    this.waterTimer = this.time.addEvent({
      delay: WATER_FRAME_DELAY,
      loop: true,
      callback: this.advanceWaterFrame,
      callbackScope: this,
    });

    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);
  }

  private layoutLayers(): void {
    this.oceanLayer?.setDepth(0);
    this.worldLayer?.setDepth(10);
    this.effectsLayer?.setDepth(20);
  }

  private handleResize(): void {
    const camera = this.cameras.main;
    camera.setSize(this.scale.width, this.scale.height);

    if (this.hasCameraInteraction) {
      this.clampCamera(camera);
      return;
    }

    this.fitCameraToIsland();
  }

  private handleShutdown(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.waterTimer?.destroy();
    this.unbindCameraControls();
  }

  private rebuildWorld(): void {
    this.rebuildOcean();
    this.rebuildIsland();
  }

  private rebuildOcean(): void {
    if (!this.oceanLayer) {
      return;
    }

    this.oceanLayer.removeAll(true);
    this.waterTiles = [];

    for (let row = 0; row < WORLD_ROWS; row += 1) {
      for (let column = 0; column < WORLD_COLUMNS; column += 1) {
        const phase = (row + column) % WATER_TEXTURE_KEYS.length < 2 ? 0 : 2;
        const frameIndex = (this.waterFrame + phase) % WATER_TEXTURE_KEYS.length;
        const sprite = this.add.image(
          column * PIXEL_FARM_TILE_SIZE,
          row * PIXEL_FARM_TILE_SIZE,
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

  private rebuildIsland(): void {
    if (!this.worldLayer) {
      return;
    }

    this.worldLayer.removeAll(true);
    const objectsByLayer = new Map(
      PIXEL_FARM_LAYERS.map((layer) => [
        layer.id,
        PIXEL_FARM_OBJECTS.filter((object) => object.layerId === layer.id),
      ]),
    );

    for (const layer of PIXEL_FARM_LAYERS) {
      for (let row = 0; row < ISLAND_ROWS; row += 1) {
        for (let column = 0; column < ISLAND_COLUMNS; column += 1) {
          if (!maskHasTile(layer.mask, row, column)) {
            continue;
          }

          const tile = tileOverrideAt(layer.overrides, row, column) ?? layer.baseTile;
          const source = PIXEL_FARM_ASSET_SOURCE_CONFIG[tile.sourceId];
          const sprite = this.add.image(
            (ISLAND_START_COLUMN + column) * PIXEL_FARM_TILE_SIZE,
            (ISLAND_START_ROW + row) * PIXEL_FARM_TILE_SIZE,
            source.textureKey,
            tile.frame,
          );

          sprite.setOrigin(0, 0);
          this.worldLayer.add(sprite);
        }
      }

      for (const object of objectsByLayer.get(layer.id) ?? []) {
        const source = PIXEL_FARM_ASSET_SOURCE_CONFIG[object.sourceId];
        const sprite = this.add.image(
          (ISLAND_START_COLUMN + object.column) * PIXEL_FARM_TILE_SIZE,
          (ISLAND_START_ROW + object.row) * PIXEL_FARM_TILE_SIZE,
          source.textureKey,
          object.frame,
        );

        sprite.setOrigin(0, 0);
        this.worldLayer.add(sprite);
      }
    }
  }

  private bindCameraControls(): void {
    this.input.on("pointerdown", this.handlePointerDown, this);
    this.input.on("pointermove", this.handlePointerMove, this);
    this.input.on("pointerup", this.handlePointerUp, this);
    this.input.on("pointerupoutside", this.handlePointerUp, this);
    this.input.on("wheel", this.handleWheel, this);
  }

  private unbindCameraControls(): void {
    this.input.off("pointerdown", this.handlePointerDown, this);
    this.input.off("pointermove", this.handlePointerMove, this);
    this.input.off("pointerup", this.handlePointerUp, this);
    this.input.off("pointerupoutside", this.handlePointerUp, this);
    this.input.off("wheel", this.handleWheel, this);
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    this.dragState.active = true;
    this.dragState.pointerId = pointer.id;
    this.dragState.lastX = pointer.x;
    this.dragState.lastY = pointer.y;
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.dragState.active || this.dragState.pointerId !== pointer.id) {
      return;
    }

    const camera = this.cameras.main;
    const deltaX = pointer.x - this.dragState.lastX;
    const deltaY = pointer.y - this.dragState.lastY;

    camera.setScroll(
      camera.scrollX - deltaX / camera.zoom,
      camera.scrollY - deltaY / camera.zoom,
    );
    this.clampCamera(camera);

    this.dragState.lastX = pointer.x;
    this.dragState.lastY = pointer.y;
    this.hasCameraInteraction = true;
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    if (this.dragState.pointerId !== pointer.id) {
      return;
    }

    this.dragState.active = false;
    this.dragState.pointerId = null;
  }

  private handleWheel(
    _pointer: Phaser.Input.Pointer,
    _currentlyOver: Phaser.GameObjects.GameObject[],
    _deltaX: number,
    deltaY: number,
  ): void {
    const camera = this.cameras.main;
    const centerX = camera.scrollX + camera.width / (2 * camera.zoom);
    const centerY = camera.scrollY + camera.height / (2 * camera.zoom);
    const zoomFactor = deltaY > 0 ? 1 - CAMERA_ZOOM_STEP : 1 + CAMERA_ZOOM_STEP;
    const nextZoom = this.clampZoom(camera.zoom * zoomFactor);

    camera.setZoom(nextZoom);
    camera.centerOn(centerX, centerY);
    this.clampCamera(camera);
    this.hasCameraInteraction = true;
  }

  private fitCameraToIsland(): void {
    const camera = this.cameras.main;
    const zoomX = (camera.width * CAMERA_TARGET_FILL) / ISLAND_PIXEL_WIDTH;
    const zoomY = (camera.height * CAMERA_TARGET_FILL) / ISLAND_PIXEL_HEIGHT;
    const zoom = this.clampZoom(Math.min(zoomX, zoomY));

    camera.setZoom(zoom);
    camera.centerOn(ISLAND_CENTER_X, ISLAND_CENTER_Y);
    this.clampCamera(camera);
  }

  private clampZoom(zoom: number): number {
    return Phaser.Math.Clamp(zoom, this.minZoom(), CAMERA_MAX_ZOOM);
  }

  private minZoom(): number {
    return Math.max(
      this.cameras.main.width / WORLD_PIXEL_WIDTH,
      this.cameras.main.height / WORLD_PIXEL_HEIGHT,
    );
  }

  private clampCamera(camera: Phaser.Cameras.Scene2D.Camera): void {
    const viewWidth = camera.width / camera.zoom;
    const viewHeight = camera.height / camera.zoom;
    const maxScrollX = WORLD_PIXEL_WIDTH - viewWidth;
    const maxScrollY = WORLD_PIXEL_HEIGHT - viewHeight;
    const scrollX =
      maxScrollX <= 0
        ? (WORLD_PIXEL_WIDTH - viewWidth) / 2
        : Phaser.Math.Clamp(camera.scrollX, 0, maxScrollX);
    const scrollY =
      maxScrollY <= 0
        ? (WORLD_PIXEL_HEIGHT - viewHeight) / 2
        : Phaser.Math.Clamp(camera.scrollY, 0, maxScrollY);

    camera.setScroll(scrollX, scrollY);
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
