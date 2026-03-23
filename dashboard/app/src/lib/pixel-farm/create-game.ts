import Phaser from "phaser";
import premiumCharacterUrl from "@/assets/game-objects/characters/Premium Charakter Spritesheet.png";
import water1Url from "@/assets/water-frame-1.png";
import water2Url from "@/assets/water-frame-2.png";
import water3Url from "@/assets/water-frame-3.png";
import water4Url from "@/assets/water-frame-4.png";
import {
  PIXEL_FARM_CHARACTER_FRAME_HEIGHT,
  PIXEL_FARM_CHARACTER_FRAME_WIDTH,
  PIXEL_FARM_CHARACTER_TEXTURE_KEY,
  PixelFarmCharacter,
  type PixelFarmCharacterInput,
  type PixelFarmCharacterToolAction,
  registerPixelFarmCharacterAnimations,
} from "@/lib/pixel-farm/character";
import {
  maskHasTile,
  PIXEL_FARM_LAYERS,
  PIXEL_FARM_MASK_BOUNDS,
  PIXEL_FARM_MASK_COLUMNS,
  PIXEL_FARM_MASK_ROWS,
  PIXEL_FARM_OBJECTS,
  PIXEL_FARM_ROOT_LAYER,
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
const ACTOR_LAYER_DEPTH = 15;
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

interface CharacterKeyboardControls {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  altUp: Phaser.Input.Keyboard.Key;
  altDown: Phaser.Input.Keyboard.Key;
  altLeft: Phaser.Input.Keyboard.Key;
  altRight: Phaser.Input.Keyboard.Key;
  run: Phaser.Input.Keyboard.Key;
  hoe: Phaser.Input.Keyboard.Key;
  axe: Phaser.Input.Keyboard.Key;
  water: Phaser.Input.Keyboard.Key;
}

function waterTextureKey(index: number): (typeof WATER_TEXTURE_KEYS)[number] {
  return WATER_TEXTURE_KEYS[index % WATER_TEXTURE_KEYS.length]!;
}

function localCellKey(row: number, column: number): string {
  return `${row}:${column}`;
}

class PixelFarmSandboxScene extends Phaser.Scene {
  private oceanLayer?: Phaser.GameObjects.Container;
  private worldLayer?: Phaser.GameObjects.Container;
  private actorLayer?: Phaser.GameObjects.Container;
  private effectsLayer?: Phaser.GameObjects.Container;
  private waterTiles: WaterTile[] = [];
  private waterFrame = 0;
  private waterTimer?: Phaser.Time.TimerEvent;
  private character?: PixelFarmCharacter;
  private characterControls?: CharacterKeyboardControls;
  private readonly blockedCells = new Set<string>();
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
    this.load.spritesheet(PIXEL_FARM_CHARACTER_TEXTURE_KEY, premiumCharacterUrl, {
      frameWidth: PIXEL_FARM_CHARACTER_FRAME_WIDTH,
      frameHeight: PIXEL_FARM_CHARACTER_FRAME_HEIGHT,
    });
  }

  create(): void {
    this.oceanLayer = this.add.container(0, 0);
    this.worldLayer = this.add.container(0, 0);
    this.actorLayer = this.add.container(0, 0);
    this.effectsLayer = this.add.container(0, 0);
    this.layoutLayers();

    this.cameras.main.setBackgroundColor(BACKGROUND_COLOR);
    this.cameras.main.setBounds(0, 0, WORLD_PIXEL_WIDTH, WORLD_PIXEL_HEIGHT);
    this.cameras.main.setRoundPixels(true);

    this.rebuildWorld();
    registerPixelFarmCharacterAnimations(this);
    this.createCharacter();
    this.bindCharacterControls();
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
    this.actorLayer?.setDepth(ACTOR_LAYER_DEPTH);
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
    this.character?.destroy();
    this.character = undefined;
    this.unbindCameraControls();
  }

  private rebuildWorld(): void {
    this.rebuildOcean();
    this.rebuildIsland();
    this.rebuildCollisionMap();
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

  update(_time: number, delta: number): void {
    this.character?.update(delta, this.readCharacterInput());
  }

  private bindCharacterControls(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) {
      return;
    }

    this.characterControls = {
      up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      altUp: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      altDown: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      altLeft: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      altRight: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      run: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
      hoe: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.J),
      axe: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.K),
      water: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.L),
    };
  }

  private readCharacterInput(): PixelFarmCharacterInput {
    const controls = this.characterControls;
    if (!controls) {
      return {
        moveX: 0,
        moveY: 0,
        running: false,
        action: null,
      };
    }

    const up = controls.up.isDown || controls.altUp.isDown;
    const down = controls.down.isDown || controls.altDown.isDown;
    const left = controls.left.isDown || controls.altLeft.isDown;
    const right = controls.right.isDown || controls.altRight.isDown;

    return {
      moveX: Number(right) - Number(left),
      moveY: Number(down) - Number(up),
      running: controls.run.isDown,
      action: this.readCharacterAction(controls),
    };
  }

  private readCharacterAction(
    controls: CharacterKeyboardControls,
  ): PixelFarmCharacterToolAction | null {
    if (Phaser.Input.Keyboard.JustDown(controls.hoe)) {
      return "hoe";
    }

    if (Phaser.Input.Keyboard.JustDown(controls.axe)) {
      return "axe";
    }

    if (Phaser.Input.Keyboard.JustDown(controls.water)) {
      return "water";
    }

    return null;
  }

  private createCharacter(): void {
    this.character?.destroy();

    const spawnCell = this.findCharacterSpawnCell();
    this.character = new PixelFarmCharacter({
      scene: this,
      layer: this.actorLayer,
      startX: (ISLAND_START_COLUMN + spawnCell.column + 0.5) * PIXEL_FARM_TILE_SIZE,
      startY: (ISLAND_START_ROW + spawnCell.row + 1) * PIXEL_FARM_TILE_SIZE,
      canOccupy: this.canCharacterOccupy,
    });
  }

  private findCharacterSpawnCell(): { row: number; column: number } {
    const centerRow = Math.round((PIXEL_FARM_MASK_BOUNDS.minRow + PIXEL_FARM_MASK_BOUNDS.maxRow) * 0.5);
    const centerColumn = Math.round(
      (PIXEL_FARM_MASK_BOUNDS.minColumn + PIXEL_FARM_MASK_BOUNDS.maxColumn) * 0.5,
    );
    let bestCell: { row: number; column: number } | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let row = 0; row < ISLAND_ROWS; row += 1) {
      for (let column = 0; column < ISLAND_COLUMNS; column += 1) {
        if (!this.isWalkableLocalCell(row, column)) {
          continue;
        }

        const distance = Math.abs(row - centerRow) + Math.abs(column - centerColumn);
        if (distance >= bestDistance) {
          continue;
        }

        bestCell = { row, column };
        bestDistance = distance;
      }
    }

    if (!bestCell) {
      throw new Error("Pixel farm needs at least one walkable cell for the character spawn.");
    }

    return bestCell;
  }

  private rebuildCollisionMap(): void {
    this.blockedCells.clear();

    for (const object of PIXEL_FARM_OBJECTS) {
      if (object.walkable) {
        continue;
      }

      for (let row = object.row; row < object.row + object.footprint.rows; row += 1) {
        for (let column = object.column; column < object.column + object.footprint.columns; column += 1) {
          this.blockedCells.add(localCellKey(row, column));
        }
      }
    }
  }

  private isWalkableLocalCell(row: number, column: number): boolean {
    return (
      maskHasTile(PIXEL_FARM_ROOT_LAYER.mask, row, column) &&
      !this.blockedCells.has(localCellKey(row, column))
    );
  }

  private canCharacterOccupy = (
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): boolean => {
    const maxColumn = Math.floor((right - 0.001) / PIXEL_FARM_TILE_SIZE);
    const maxRow = Math.floor((bottom - 0.001) / PIXEL_FARM_TILE_SIZE);
    const minColumn = Math.floor(left / PIXEL_FARM_TILE_SIZE);
    const minRow = Math.floor(top / PIXEL_FARM_TILE_SIZE);

    for (let worldRow = minRow; worldRow <= maxRow; worldRow += 1) {
      for (let worldColumn = minColumn; worldColumn <= maxColumn; worldColumn += 1) {
        const localRow = worldRow - ISLAND_START_ROW;
        const localColumn = worldColumn - ISLAND_START_COLUMN;

        if (!this.isWalkableLocalCell(localRow, localColumn)) {
          return false;
        }
      }
    }

    return true;
  };

  private bindCameraControls(): void {
    this.input.on("pointerdown", this.handlePointerDown, this);
    this.input.on("pointermove", this.handlePointerMove, this);
    this.input.on("pointerup", this.handlePointerUp, this);
    this.input.on("pointerupoutside", this.handlePointerUp, this);
  }

  private unbindCameraControls(): void {
    this.input.off("pointerdown", this.handlePointerDown, this);
    this.input.off("pointermove", this.handlePointerMove, this);
    this.input.off("pointerup", this.handlePointerUp, this);
    this.input.off("pointerupoutside", this.handlePointerUp, this);
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
