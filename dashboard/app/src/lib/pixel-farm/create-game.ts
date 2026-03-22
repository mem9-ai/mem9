import Phaser from "phaser";
import soilGroundTilesUrl from "@/assets/Soil_Ground_Tiles.png";
import water1Url from "@/assets/Water_1.png";
import water2Url from "@/assets/Water_2.png";
import water3Url from "@/assets/Water_3.png";
import water4Url from "@/assets/Water_4.png";
import {
  maskHasTile,
  SOIL_MASK,
  SOIL_MASK_BOUNDS,
  SOIL_MASK_COLUMNS,
  SOIL_MASK_ROWS,
} from "@/lib/pixel-farm/island-mask";

const WATER_TILE_SIZE = 16;
const WATER_FRAME_DELAY = 180;
const BACKGROUND_COLOR = 0x0d141b;
const WORLD_COLUMNS = 128;
const WORLD_ROWS = 96;
const ISLAND_COLUMNS = SOIL_MASK_COLUMNS;
const ISLAND_ROWS = SOIL_MASK_ROWS;
const CAMERA_MAX_ZOOM = 3;
const CAMERA_TARGET_FILL = 0.8;
const CAMERA_ZOOM_STEP = 0.12;
const WORLD_PIXEL_WIDTH = WORLD_COLUMNS * WATER_TILE_SIZE;
const WORLD_PIXEL_HEIGHT = WORLD_ROWS * WATER_TILE_SIZE;
const ISLAND_PIXEL_WIDTH = SOIL_MASK_BOUNDS.width * WATER_TILE_SIZE;
const ISLAND_PIXEL_HEIGHT = SOIL_MASK_BOUNDS.height * WATER_TILE_SIZE;
const ISLAND_START_COLUMN = Math.floor((WORLD_COLUMNS - ISLAND_COLUMNS) / 2);
const ISLAND_START_ROW = Math.floor((WORLD_ROWS - ISLAND_ROWS) / 2);
const ISLAND_CENTER_X =
  ISLAND_START_COLUMN * WATER_TILE_SIZE +
  (SOIL_MASK_BOUNDS.minColumn + SOIL_MASK_BOUNDS.maxColumn + 1) * WATER_TILE_SIZE * 0.5;
const ISLAND_CENTER_Y =
  ISLAND_START_ROW * WATER_TILE_SIZE +
  (SOIL_MASK_BOUNDS.minRow + SOIL_MASK_BOUNDS.maxRow + 1) * WATER_TILE_SIZE * 0.5;
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

interface DragState {
  active: boolean;
  pointerId: number | null;
  lastX: number;
  lastY: number;
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
    this.cameras.main.setBounds(0, 0, WORLD_PIXEL_WIDTH, WORLD_PIXEL_HEIGHT);
    this.cameras.main.setRoundPixels(true);

    this.buildWorld();
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

  private buildWorld(): void {
    if (!this.oceanLayer || !this.terrainLayer) {
      return;
    }

    this.rebuildOcean();
    this.rebuildIsland();
  }

  private layoutLayers(): void {
    this.oceanLayer?.setDepth(0);
    this.terrainLayer?.setDepth(10);
    this.structureLayer?.setDepth(20);
    this.effectsLayer?.setDepth(30);
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

  private rebuildIsland(): void {
    if (!this.terrainLayer) {
      return;
    }

    this.terrainLayer.removeAll(true);

    for (let row = 0; row < ISLAND_ROWS; row += 1) {
      for (let column = 0; column < ISLAND_COLUMNS; column += 1) {
        if (!maskHasTile(SOIL_MASK, row, column)) {
          continue;
        }

        const hasUp = maskHasTile(SOIL_MASK, row - 1, column);
        const hasRight = maskHasTile(SOIL_MASK, row, column + 1);
        const hasDown = maskHasTile(SOIL_MASK, row + 1, column);
        const hasLeft = maskHasTile(SOIL_MASK, row, column - 1);
        const sprite = this.add.image(
          (ISLAND_START_COLUMN + column) * WATER_TILE_SIZE,
          (ISLAND_START_ROW + row) * WATER_TILE_SIZE,
          SOIL_TILESET_KEY,
          soilFrameForTile(hasUp, hasRight, hasDown, hasLeft),
        );

        sprite.setOrigin(0, 0);
        this.terrainLayer.add(sprite);
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
