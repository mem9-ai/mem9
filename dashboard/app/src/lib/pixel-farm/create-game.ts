import Phaser from "phaser";
import {
  PixelFarmBabyCow,
  type PixelFarmBabyCowColor,
  type PixelFarmBabyCowState,
  registerPixelFarmBabyCowAnimations,
} from "@/lib/pixel-farm/baby-cow";
import {
  PixelFarmChicken,
  type PixelFarmChickenColor,
  type PixelFarmChickenState,
  registerPixelFarmChickenAnimations,
} from "@/lib/pixel-farm/chicken";
import {
  PixelFarmCharacter,
  type PixelFarmCharacterAction,
  type PixelFarmCharacterDirection,
  type PixelFarmCharacterInput,
  type PixelFarmCharacterToolAction,
  measurePixelFarmCharacterBodyAt,
  registerPixelFarmCharacterAnimations,
} from "@/lib/pixel-farm/character";
import {
  PixelFarmCow,
  type PixelFarmCowColor,
  type PixelFarmCowState,
  registerPixelFarmCowAnimations,
} from "@/lib/pixel-farm/cow";
import {
  pixelFarmDepthForY,
} from "@/lib/pixel-farm/depth";
import {
  PIXEL_FARM_COLLISIONS,
  maskHasTile,
  PIXEL_FARM_LAYERS,
  PIXEL_FARM_MASK_BOUNDS,
  PIXEL_FARM_MASK_COLUMNS,
  PIXEL_FARM_MASK_ROWS,
  PIXEL_FARM_OBJECT_GROUPS,
  PIXEL_FARM_OBJECTS,
  PIXEL_FARM_ROOT_LAYER,
  tileOverrideAt,
} from "@/lib/pixel-farm/island-mask";
import {
  buildPixelFarmCollisionIndex,
  createPixelFarmStaticCollisionBodies,
  intersectsPixelFarmCollision,
  type PixelFarmCollisionRect,
} from "@/lib/pixel-farm/collision-layer";
import {
  PIXEL_FARM_BGM_TEXTURE_KEY,
  pixelFarmWaterTextureKey,
  preloadPixelFarmRuntimeAssets,
  PIXEL_FARM_WATER_TEXTURE_KEYS,
} from "@/lib/pixel-farm/runtime-assets";
import type { PixelFarmWorldState } from "@/lib/pixel-farm/data/types";
import { PixelFarmUIScene } from "@/lib/pixel-farm/ui-scene";
import {
  PIXEL_FARM_ASSET_SOURCE_CONFIG,
  PIXEL_FARM_TILE_SIZE,
} from "@/lib/pixel-farm/tileset-config";
import {
  type PixelFarmInteractableTarget,
  PixelFarmWorldRenderer,
} from "@/lib/pixel-farm/world-render";

const WATER_FRAME_DELAY = 180;
const BACKGROUND_COLOR = 0x0d141b;
const WORLD_COLUMNS = 128;
const WORLD_ROWS = 96;
const ISLAND_COLUMNS = PIXEL_FARM_MASK_COLUMNS;
const ISLAND_ROWS = PIXEL_FARM_MASK_ROWS;
const CAMERA_MAX_ZOOM = 3;
const CAMERA_TARGET_FILL = 0.92;
const CAMERA_FOLLOW_LERP = 0.12;
const CAMERA_DEADZONE_TILES_X = 5;
const CAMERA_DEADZONE_TILES_Y = 3;
const ACTOR_LAYER_DEPTH = 15;
const STATIC_OBJECT_LAYER_DEPTH = 15;
const INTERACTION_BUBBLE_OFFSET_Y = PIXEL_FARM_TILE_SIZE * 0.8;
const INTERACTION_FOCUS_FALLBACK_MS = 180;
const PIXEL_FARM_BGM_START_DELAY_MS = 3000;
const PIXEL_FARM_BGM_FADE_IN_MS = 5000;
const PIXEL_FARM_BGM_MAX_VOLUME = 0.2;
const PIXEL_FARM_BGM_RESTART_DELAY_MIN_MS = 30_000;
const PIXEL_FARM_BGM_RESTART_DELAY_MAX_MS = 60_000;
const INTERACTION_ORIGIN_MARKER_RADIUS = 4;
const INTERACTION_ANCHOR_MARKER_RADIUS = 3;
const WATER_FRAME_COUNT = PIXEL_FARM_WATER_TEXTURE_KEYS.length;
const ARCADE_DEBUG_ENABLED = false//import.meta.env.DEV;
const PIXEL_FARM_COLLISION_INDEX = buildPixelFarmCollisionIndex(PIXEL_FARM_COLLISIONS);
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
  interact: Phaser.Input.Keyboard.Key;
  hoe: Phaser.Input.Keyboard.Key;
  axe: Phaser.Input.Keyboard.Key;
  water: Phaser.Input.Keyboard.Key;
}

interface PixelFarmCell {
  row: number;
  column: number;
}

interface PixelFarmObjectRenderGroup {
  objects: Array<(typeof PIXEL_FARM_OBJECTS)[number]>;
  sortColumn: number;
  sortRow: number;
}

export const PIXEL_FARM_DEBUG_ACTOR_TYPES = [
  "character",
  "cow",
  "baby-cow",
  "chicken",
] as const;

export type PixelFarmDebugActorType = (typeof PIXEL_FARM_DEBUG_ACTOR_TYPES)[number];
export type PixelFarmDebugActorVariant =
  | "default"
  | PixelFarmCowColor
  | PixelFarmBabyCowColor
  | PixelFarmChickenColor;
export type PixelFarmDebugActorState =
  | PixelFarmCharacterAction
  | PixelFarmCowState
  | PixelFarmBabyCowState
  | PixelFarmChickenState;

export interface PixelFarmDebugState {
  direction: PixelFarmCharacterDirection;
  playing: boolean;
  replayNonce: number;
  state: PixelFarmDebugActorState;
  type: PixelFarmDebugActorType;
  variant: PixelFarmDebugActorVariant;
  visible: boolean;
}

export interface PixelFarmGameOptions {
  getDebugActorState?: () => PixelFarmDebugState | null;
  getMusicEnabled?: () => boolean;
  getPausedAnimalInstanceId?: () => string | null;
  onInteractionDebugChange?: (info: PixelFarmInteractionDebugInfo) => void;
  getShowInteractionDebug?: () => boolean;
  getShowSpatialDebug?: () => boolean;
  getWorldState?: () => PixelFarmWorldState | null;
  onPointerDebugChange?: (info: PixelFarmPointerDebugInfo) => void;
}

export interface PixelFarmPointerTile {
  column: number;
  row: number;
}

export interface PixelFarmPointerDebugInfo {
  islandTile: PixelFarmPointerTile | null;
  worldTile: PixelFarmPointerTile | null;
}

export interface PixelFarmInteractionTargetDebugInfo {
  animalInstanceId?: string | null;
  id: string;
  kind: "animal" | "crop";
  memoryCount: number;
  memoryIds: string[];
  occupiedCells?: PixelFarmPointerTile[];
  screenX: number;
  screenY: number;
  tagKey: string;
  tagLabel: string;
}

export interface PixelFarmInteractionDebugInfo {
  currentTile?: PixelFarmPointerTile | null;
  frontTile?: PixelFarmPointerTile | null;
  interactionNonce: number;
  lastInteractedTargetId: string | null;
  target: PixelFarmInteractionTargetDebugInfo | null;
}

export function createDefaultPixelFarmDebugState(
  type: PixelFarmDebugActorType = "chicken",
): PixelFarmDebugState {
  switch (type) {
    case "character":
      return {
        direction: "down",
        playing: true,
        replayNonce: 0,
        state: "idle",
        type,
        variant: "default",
        visible: false,
      };
    case "cow":
      return {
        direction: "right",
        playing: true,
        replayNonce: 0,
        state: "idle",
        type,
        variant: "brown",
        visible: false,
      };
    case "baby-cow":
      return {
        direction: "right",
        playing: true,
        replayNonce: 0,
        state: "idle",
        type,
        variant: "brown",
        visible: false,
      };
    case "chicken":
      return {
        direction: "right",
        playing: true,
        replayNonce: 0,
        state: "idle",
        type,
        variant: "default",
        visible: false,
      };
  }
}

function localCellKey(row: number, column: number): string {
  return `${row}:${column}`;
}

function asVolumeSound(sound: Phaser.Sound.BaseSound): Phaser.Sound.BaseSound & { volume: number } {
  return sound as Phaser.Sound.BaseSound & { volume: number };
}

interface PixelFarmInteractionCandidate {
  animalInstanceId: string | null;
  target: PixelFarmInteractableTarget;
  worldAnchor: { x: number; y: number };
}

interface PixelFarmInteractionSelectionState {
  currentTile: PixelFarmCell;
  frontTile: PixelFarmCell;
  origin: { x: number; y: number };
  facingVector: { x: number; y: number };
  candidates: PixelFarmInteractionCandidate[];
  focusedTarget: PixelFarmInteractionCandidate | null;
}

interface PixelFarmRecentInteractionFocus {
  candidate: PixelFarmInteractionCandidate;
  capturedAt: number;
}

function normalizeFacingVector(
  facing: { x: number; y: number },
): { x: number; y: number } {
  const length = Math.hypot(facing.x, facing.y);
  if (length < 0.001) {
    return { x: 0, y: 1 };
  }

  return {
    x: facing.x / length,
    y: facing.y / length,
  };
}

function groupPixelFarmObjectsForDepth(): PixelFarmObjectRenderGroup[] {
  const groupMetadata = new Map(
    PIXEL_FARM_OBJECT_GROUPS.map((group) => [group.id, group] as const),
  );
  const groups: PixelFarmObjectRenderGroup[] = [];
  const objectBuckets = new Map<string, Array<(typeof PIXEL_FARM_OBJECTS)[number]>>();

  for (const object of PIXEL_FARM_OBJECTS) {
    const key = object.groupId ?? object.id;
    const bucket = objectBuckets.get(key);
    if (bucket) {
      bucket.push(object);
    } else {
      objectBuckets.set(key, [object]);
    }
  }

  for (const [key, objects] of objectBuckets) {
    const metadata = groupMetadata.get(key);
    groups.push({
      objects,
      sortColumn: metadata?.sortColumn ?? objects[0]!.column,
      sortRow: metadata?.sortRow ?? Math.max(...objects.map((object) => object.row)),
    });
  }

  return groups.sort(
    (left, right) =>
      left.sortRow - right.sortRow ||
      left.sortColumn - right.sortColumn ||
      left.objects[0]!.id.localeCompare(right.objects[0]!.id),
  );
}

type PixelFarmPreviewActor =
  | PixelFarmCharacter
  | PixelFarmCow
  | PixelFarmBabyCow
  | PixelFarmChicken;

class PixelFarmSandboxScene extends Phaser.Scene {
  private oceanLayer?: Phaser.GameObjects.Container;
  private worldLayer?: Phaser.GameObjects.Container;
  private effectsLayer?: Phaser.GameObjects.Container;
  private worldDebugGraphics?: Phaser.GameObjects.Graphics;
  private worldRenderer?: PixelFarmWorldRenderer;
  private waterTiles: WaterTile[] = [];
  private waterFrame = 0;
  private waterTimer?: Phaser.Time.TimerEvent;
  private character?: PixelFarmCharacter;
  private collisionBlockerGroup?: Phaser.Physics.Arcade.StaticGroup;
  private debugActor?: PixelFarmPreviewActor;
  private debugActorKey?: string;
  private lastDebugActorSignature?: string;
  private interactionNonce = 0;
  private lastInteractedTargetId: string | null = null;
  private lastInteractionDebugSignature?: string;
  private lastPointerDebugSignature?: string;
  private lastWorldState?: PixelFarmWorldState | null;
  private lastInteractableStructureVersion?: number;
  private recentInteractionFocus: PixelFarmRecentInteractionFocus | null = null;
  private interactionSelectionFrame = 0;
  private cachedInteractionSelectionFrame?: number;
  private cachedInteractionSelectionState: PixelFarmInteractionSelectionState | null = null;
  private characterControls?: CharacterKeyboardControls;
  private dragState: DragState = {
    active: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
  };
  private bgmSound: Phaser.Sound.BaseSound | null = null;
  private bgmStartTimer: Phaser.Time.TimerEvent | null = null;
  private bgmRestartTimer: Phaser.Time.TimerEvent | null = null;
  private bgmFadeTween: Phaser.Tweens.Tween | null = null;
  // Browsers often require a user gesture before allowing audio playback.
  private hasUserInteracted = false;

  constructor(private readonly options: PixelFarmGameOptions = {}) {
    super("pixel-farm-sandbox");
  }

  preload(): void {
    preloadPixelFarmRuntimeAssets(this);
  }

  create(): void {
    // Keep farm audio running when the browser window loses focus.
    this.sound.pauseOnBlur = false;
    this.scene.launch("pixel-farm-ui");
    this.oceanLayer = this.add.container(0, 0);
    this.worldLayer = this.add.container(0, 0);
    this.effectsLayer = this.add.container(0, 0);
    this.worldDebugGraphics = this.add.graphics();
    this.layoutLayers();

    this.cameras.main.setBackgroundColor(BACKGROUND_COLOR);
    this.cameras.main.setBounds(0, 0, WORLD_PIXEL_WIDTH, WORLD_PIXEL_HEIGHT);
    this.cameras.main.setRoundPixels(true);
    this.physics.world.setBounds(0, 0, WORLD_PIXEL_WIDTH, WORLD_PIXEL_HEIGHT);

    this.rebuildWorld();
    registerPixelFarmBabyCowAnimations(this);
    registerPixelFarmChickenAnimations(this);
    registerPixelFarmCharacterAnimations(this);
    registerPixelFarmCowAnimations(this);
    this.worldRenderer = new PixelFarmWorldRenderer({
      scene: this,
      cellToWorldOrigin: (cell) => this.cellToWorldOrigin(cell),
      cellToWorldPosition: (cell) => this.cellToWorldPosition(cell),
    });
    this.applyWorldState();
    const characterSpawnCell = this.findCharacterSpawnCell();
    this.createCharacter(characterSpawnCell);

    this.bindActorPhysics();
    this.bindCharacterControls();
    this.fitCameraToIsland();
    this.startCameraFollow();
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
    this.worldDebugGraphics?.setDepth(1000);
  }

  private handleResize(): void {
    const camera = this.cameras.main;
    camera.setSize(this.scale.width, this.scale.height);
    this.fitCameraToIsland();
    this.startCameraFollow();
  }

  private handleShutdown(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.waterTimer?.destroy();
    this.character?.destroy();
    this.character = undefined;
    this.debugActor?.destroy();
    this.debugActor = undefined;
    this.debugActorKey = undefined;
    this.lastDebugActorSignature = undefined;
    this.worldDebugGraphics?.destroy();
    this.worldDebugGraphics = undefined;
    this.worldRenderer?.destroy();
    this.worldRenderer = undefined;
    this.lastWorldState = undefined;
    this.lastInteractionDebugSignature = undefined;
    this.interactionNonce = 0;
    this.lastInteractedTargetId = null;
    this.lastInteractableStructureVersion = undefined;
    this.recentInteractionFocus = null;
    this.interactionSelectionFrame = 0;
    this.cachedInteractionSelectionFrame = undefined;
    this.cachedInteractionSelectionState = null;
    this.lastPointerDebugSignature = undefined;
    this.options.onInteractionDebugChange?.({
      interactionNonce: 0,
      lastInteractedTargetId: null,
      target: null,
    });
    this.options.onPointerDebugChange?.({
      islandTile: null,
      worldTile: null,
    });
    this.collisionBlockerGroup?.clear(true, true);
    this.collisionBlockerGroup?.destroy(true);
    this.collisionBlockerGroup = undefined;
    this.unbindCameraControls();
    this.stopBgmCycle();
  }

  private rebuildWorld(): void {
    this.rebuildOcean();
    this.rebuildIsland();
    this.rebuildCollisionBodies();
  }

  private rebuildOcean(): void {
    if (!this.oceanLayer) {
      return;
    }

    this.oceanLayer.removeAll(true);
    this.waterTiles = [];

    for (let row = 0; row < WORLD_ROWS; row += 1) {
      for (let column = 0; column < WORLD_COLUMNS; column += 1) {
        const phase = (row + column) % WATER_FRAME_COUNT < 2 ? 0 : 2;
        const frameIndex = (this.waterFrame + phase) % WATER_FRAME_COUNT;
        const sprite = this.add.image(
          column * PIXEL_FARM_TILE_SIZE,
          row * PIXEL_FARM_TILE_SIZE,
          pixelFarmWaterTextureKey(frameIndex),
        );

        sprite.setOrigin(0, 0);
        this.oceanLayer.add(sprite);
        this.waterTiles.push({ sprite, phase });
      }
    }
  }

  private advanceWaterFrame(): void {
    this.waterFrame = (this.waterFrame + 1) % WATER_FRAME_COUNT;

    for (const tile of this.waterTiles) {
      const frameIndex = (this.waterFrame + tile.phase) % WATER_FRAME_COUNT;
      tile.sprite.setTexture(pixelFarmWaterTextureKey(frameIndex));
    }
  }

  private rebuildIsland(): void {
    if (!this.worldLayer) {
      return;
    }

    this.worldLayer.removeAll(true);

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
    }

    for (const group of groupPixelFarmObjectsForDepth()) {
      const depth = pixelFarmDepthForY(
        STATIC_OBJECT_LAYER_DEPTH,
        (ISLAND_START_ROW + group.sortRow + 1) * PIXEL_FARM_TILE_SIZE,
      );

      for (const object of group.objects) {
        const source = PIXEL_FARM_ASSET_SOURCE_CONFIG[object.sourceId];
        const sprite = this.add.image(
          (ISLAND_START_COLUMN + object.column) * PIXEL_FARM_TILE_SIZE,
          (ISLAND_START_ROW + object.row) * PIXEL_FARM_TILE_SIZE,
          source.textureKey,
          object.frame,
        );

        sprite.setOrigin(0, 0);
        sprite.setDepth(depth);
      }
    }
  }

  update(_time: number, delta: number): void {
    this.interactionSelectionFrame += 1;
    const characterInput = this.readCharacterInput();
    this.character?.update(delta, characterInput);
    this.updateBgmState(characterInput);
    this.worldRenderer?.setPausedAnimalInstanceId(
      this.options.getPausedAnimalInstanceId?.() ?? null,
    );
    this.worldRenderer?.update(delta);
    this.applyDebugActorState();
    this.applyWorldState();
    this.updateInteractionDebug();
    this.updateWorldDebugOverlay();
    this.updatePointerDebug();
  }

  private updateBgmState(input: PixelFarmCharacterInput): void {
    const musicEnabled = this.options.getMusicEnabled?.() ?? true;
    const controls = this.characterControls;
    const hasKeyboardInteraction =
      input.moveX !== 0 ||
      input.moveY !== 0 ||
      input.action !== null ||
      (controls?.interact.isDown ?? false);

    if (hasKeyboardInteraction) {
      this.hasUserInteracted = true;
    }

    if (!musicEnabled) {
      this.stopBgmCycle();
      return;
    }

    if (!this.hasUserInteracted) {
      return;
    }

    const isPlaying = this.bgmSound?.isPlaying ?? false;
    if (isPlaying || this.bgmStartTimer || this.bgmRestartTimer) {
      return;
    }

    this.bgmStartTimer = this.time.delayedCall(PIXEL_FARM_BGM_START_DELAY_MS, () => {
      this.bgmStartTimer = null;
      if ((this.options.getMusicEnabled?.() ?? true) && this.hasUserInteracted) {
        this.startBgmPlayback();
      }
    });
  }

  private startBgmPlayback(): void {
    this.bgmStartTimer?.destroy();
    this.bgmStartTimer = null;
    this.bgmRestartTimer?.destroy();
    this.bgmRestartTimer = null;
    this.bgmFadeTween?.destroy();
    this.bgmFadeTween = null;

    if (!this.sound.get(PIXEL_FARM_BGM_TEXTURE_KEY)) {
      this.bgmSound = this.sound.add(PIXEL_FARM_BGM_TEXTURE_KEY, {
        loop: false,
        volume: 0,
      });
    } else {
      this.bgmSound = this.sound.get(PIXEL_FARM_BGM_TEXTURE_KEY) ?? null;
      if (this.bgmSound) {
        asVolumeSound(this.bgmSound).volume = 0;
      }
    }

    if (!this.bgmSound) {
      return;
    }

    this.bgmSound.once(Phaser.Sound.Events.COMPLETE, this.handleBgmComplete, this);
    this.bgmSound.play();
    this.bgmFadeTween = this.tweens.add({
      targets: asVolumeSound(this.bgmSound),
      volume: PIXEL_FARM_BGM_MAX_VOLUME,
      duration: PIXEL_FARM_BGM_FADE_IN_MS,
      ease: "Linear",
      onComplete: () => {
        this.bgmFadeTween = null;
      },
    });
  }

  private handleBgmComplete(): void {
    this.bgmFadeTween?.destroy();
    this.bgmFadeTween = null;
    this.bgmSound = null;

    if (!(this.options.getMusicEnabled?.() ?? true) || !this.hasUserInteracted) {
      return;
    }

    const delay = Phaser.Math.Between(
      PIXEL_FARM_BGM_RESTART_DELAY_MIN_MS,
      PIXEL_FARM_BGM_RESTART_DELAY_MAX_MS,
    );
    this.bgmRestartTimer = this.time.delayedCall(delay, () => {
      this.bgmRestartTimer = null;
      if ((this.options.getMusicEnabled?.() ?? true) && this.hasUserInteracted) {
        this.startBgmPlayback();
      }
    });
  }

  private stopBgmCycle(): void {
    this.bgmStartTimer?.destroy();
    this.bgmStartTimer = null;
    this.bgmRestartTimer?.destroy();
    this.bgmRestartTimer = null;
    this.bgmFadeTween?.destroy();
    this.bgmFadeTween = null;
    this.bgmSound?.off(Phaser.Sound.Events.COMPLETE, this.handleBgmComplete, this);
    this.bgmSound?.stop();
    this.bgmSound?.destroy();
    this.bgmSound = null;
  }

  private bindCharacterControls(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) {
      return;
    }

    keyboard.addCapture(Phaser.Input.Keyboard.KeyCodes.SPACE);

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
      interact: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
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

  private bindActorPhysics(): void {
    const renderedAnimalGroup = this.worldRenderer?.getAnimalGroup();
    if (this.character && renderedAnimalGroup) {
      this.physics.add.overlap(
        this.character,
        renderedAnimalGroup,
        this.handleCharacterAnimalCollision,
        undefined,
        this,
      );
    }

    if (renderedAnimalGroup) {
      this.physics.add.collider(
        renderedAnimalGroup,
        renderedAnimalGroup,
        this.handleRenderedAnimalRoamingCollision,
        undefined,
        this,
      );
    }

    if (this.collisionBlockerGroup) {
      if (this.character) {
        this.physics.add.collider(this.character, this.collisionBlockerGroup);
      }
      if (renderedAnimalGroup) {
        this.physics.add.collider(renderedAnimalGroup, this.collisionBlockerGroup);
      }
    }
  }

  private handleRenderedAnimalRoamingCollision: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback = (
    leftObject,
    rightObject,
  ): void => {
    const leftAnimal = this.asRenderedAnimal(leftObject as Phaser.GameObjects.GameObject);
    const rightAnimal = this.asRenderedAnimal(rightObject as Phaser.GameObjects.GameObject);
    if (!leftAnimal || !rightAnimal || leftAnimal === rightAnimal) {
      return;
    }

    leftAnimal.handleRoamingCollision(rightAnimal.x, rightAnimal.y);
    rightAnimal.handleRoamingCollision(leftAnimal.x, leftAnimal.y);
  };

  private asRenderedAnimal(
    gameObject: Phaser.GameObjects.GameObject,
  ): PixelFarmCow | PixelFarmBabyCow | PixelFarmChicken | null {
    if (
      gameObject instanceof PixelFarmCow ||
      gameObject instanceof PixelFarmBabyCow ||
      gameObject instanceof PixelFarmChicken
    ) {
      return gameObject;
    }

    return null;
  }

  private handleCharacterAnimalCollision: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback = (
    characterObject,
    animalObject,
  ): void => {
    if (!(characterObject instanceof PixelFarmCharacter)) {
      return;
    }

    if (
      !(animalObject instanceof PixelFarmCow) &&
      !(animalObject instanceof PixelFarmBabyCow) &&
      !(animalObject instanceof PixelFarmChicken)
    ) {
      return;
    }

    animalObject.triggerLove(characterObject.x);
  };

  private createCharacter(spawnCell: PixelFarmCell): void {
    this.character?.destroy();

    const { x, y } = this.cellToWorldPosition(spawnCell);
    this.character = new PixelFarmCharacter({
      scene: this,
      depth: ACTOR_LAYER_DEPTH,
      startX: x,
      startY: y,
      canOccupy: this.canActorOccupy,
    });
  }

  private applyDebugActorState(): void {
    const debugState = this.options.getDebugActorState?.() ?? null;
    if (!debugState) {
      if (this.debugActor) {
        this.debugActor.setVisible(false);
      }
      this.lastDebugActorSignature = undefined;
      return;
    }

    const actorKey = `${debugState.type}:${debugState.variant}`;
    if (!this.debugActor || this.debugActorKey !== actorKey) {
      this.debugActor?.destroy();
      this.debugActor = this.createDebugActor(debugState);
      this.debugActorKey = actorKey;
      this.lastDebugActorSignature = undefined;
    }

    this.debugActor.setVisible(debugState.visible);
    if (!debugState.visible) {
      this.lastDebugActorSignature = undefined;
      return;
    }

    const signature = JSON.stringify(debugState);
    if (signature === this.lastDebugActorSignature) {
      return;
    }

    this.applyDebugPoseToActor(this.debugActor, debugState);
    this.lastDebugActorSignature = signature;
  }

  private applyWorldState(): void {
    if (!this.worldRenderer) {
      return;
    }

    const worldState = this.options.getWorldState?.() ?? null;
    if (worldState === this.lastWorldState) {
      return;
    }

    this.lastWorldState = worldState;
    this.worldRenderer.render(worldState);

    if (!worldState) {
      this.clearInteractionSelectionCache();
      this.lastInteractableStructureVersion = this.worldRenderer.getInteractableStructureVersion();
      this.recentInteractionFocus = null;
      return;
    }

    const interactableStructureVersion = this.worldRenderer.getInteractableStructureVersion();
    if (interactableStructureVersion !== this.lastInteractableStructureVersion) {
      this.clearInteractionSelectionCache();
      this.lastInteractableStructureVersion = interactableStructureVersion;
      this.recentInteractionFocus = null;
    }
  }

  private updateWorldDebugOverlay(): void {
    const graphics = this.worldDebugGraphics;
    if (!graphics) {
      return;
    }

    graphics.clear();

    if (this.options.getShowSpatialDebug?.()) {
      this.drawSpatialDebugOverlay();
    }

    if (this.options.getShowInteractionDebug?.()) {
      this.drawInteractionDebugOverlay();
    }
  }

  private drawSpatialDebugOverlay(): void {
    this.drawPhysicsDebugSprite(this.character, 0xffc857, 0xfff3bf);
    this.drawPhysicsDebugSprite(this.debugActor, 0x8bd3ff, 0xd4f0ff);

    for (const animal of this.worldRenderer?.getAnimals() ?? []) {
      this.drawPhysicsDebugSprite(animal, 0xff6b6b, 0xffc2c2);
    }

    this.drawCollisionBlockerDebug(0xff4d6d);

    for (const crop of this.worldRenderer?.getCropObjects() ?? []) {
      this.drawSortMarker(crop.x, crop.y, 0x6fe3ff);
    }
  }

  private drawInteractionDebugOverlay(): void {
    const basis = this.readInteractionDebugBasis();
    if (!basis) {
      return;
    }

    const { currentTile, facingVector, frontTile, origin } = basis;
    const interactionState = this.readInteractionSelectionState();
    const candidates = interactionState?.candidates ?? [];
    const debugTiles = this.collectRenderedInteractionDebugTiles();

    for (const tile of debugTiles) {
      const color = tile.kind === "animal" ? 0xff4d6d : 0x6dff8f;
      this.drawInteractionTileOutline(tile.cell, color, 1, 0.95);
    }

    this.drawInteractionFrontTile(currentTile, 0xfff3bf, 0.14);
    this.drawInteractionTileOutline(currentTile, 0xfff3bf, 1, 0.9);
    this.drawInteractionFrontTile(frontTile, 0x5cc8ff, 0.22);
    this.drawInteractionTileOutline(frontTile, 0x5cc8ff, 1, 1);
    this.drawInteractionOrigin(origin.x, origin.y, 0xfff3bf);
    this.drawFacingRay(origin, facingVector, 0xffd166);

    for (const candidate of candidates) {
      this.drawInteractionCandidate(candidate.worldAnchor, 0xbec6d1, false);
    }
  }

  private collectRenderedInteractionDebugTiles(): Array<{
    cell: PixelFarmCell;
    kind: "animal" | "crop";
  }> {
    const tiles = new Map<string, { cell: PixelFarmCell; kind: "animal" | "crop" }>();

    for (const animal of this.worldRenderer?.getAnimals() ?? []) {
      const body = animal.body as Phaser.Physics.Arcade.Body | undefined;
      const sampleX = body ? body.x + body.width * 0.5 : animal.x;
      const sampleY = body ? body.y + body.height - 1 : animal.y - 1;
      const cell = this.worldPointToLocalCell({ x: sampleX, y: sampleY });
      if (!cell) {
        continue;
      }

      tiles.set(localCellKey(cell.row, cell.column), { cell, kind: "animal" });
    }

    for (const crop of this.worldRenderer?.getCropObjects() ?? []) {
      const cell = this.worldPointToLocalCell({ x: crop.x, y: crop.y - 1 });
      if (!cell) {
        continue;
      }

      const key = localCellKey(cell.row, cell.column);
      if (tiles.has(key)) {
        continue;
      }

      tiles.set(key, { cell, kind: "crop" });
    }

    return [...tiles.values()];
  }

  private updateInteractionDebug(): void {
    const emitInteractionDebug = this.options.onInteractionDebugChange;
    if (!emitInteractionDebug) {
      return;
    }

    const info = this.readInteractionDebugInfo();
    const target = info.target;
    const signature = target
      ? [
          info.currentTile?.column ?? "",
          info.currentTile?.row ?? "",
          info.frontTile?.column ?? "",
          info.frontTile?.row ?? "",
          info.interactionNonce,
          info.lastInteractedTargetId ?? "",
          target.id,
          target.kind,
          target.memoryCount,
          target.screenX.toFixed(0),
          target.screenY.toFixed(0),
          target.tagLabel,
          target.occupiedCells?.map((cell) => `${cell.column}:${cell.row}`).join(",") ?? "",
        ].join("|")
      : [
          info.currentTile?.column ?? "",
          info.currentTile?.row ?? "",
          info.frontTile?.column ?? "",
          info.frontTile?.row ?? "",
          info.interactionNonce,
          info.lastInteractedTargetId ?? "",
          "no-target",
        ].join("|");

    if (signature === this.lastInteractionDebugSignature) {
      return;
    }

    this.lastInteractionDebugSignature = signature;
    emitInteractionDebug(info);
  }

  private updatePointerDebug(): void {
    const emitPointerDebug = this.options.onPointerDebugChange;
    if (!emitPointerDebug) {
      return;
    }

    const info = this.readPointerDebugInfo();
    const signature = JSON.stringify(info);
    if (signature === this.lastPointerDebugSignature) {
      return;
    }

    this.lastPointerDebugSignature = signature;
    emitPointerDebug(info);
  }

  private readInteractionDebugInfo(): PixelFarmInteractionDebugInfo {
    const selectionState = this.readInteractionSelectionState();
    const currentFocusedTarget = selectionState?.focusedTarget ?? null;
    const focusedTarget = this.resolveFocusedTargetForInteraction(currentFocusedTarget);
    const actionableTarget = focusedTarget;
    const controls = this.characterControls;
    const interactJustDown =
      controls ? Phaser.Input.Keyboard.JustDown(controls.interact) : false;

    if (actionableTarget && interactJustDown) {
      this.interactionNonce += 1;
      this.lastInteractedTargetId = actionableTarget.target.id;
    }

    if (!focusedTarget) {
      return {
        currentTile: selectionState?.currentTile ?? null,
        frontTile: selectionState?.frontTile ?? null,
        interactionNonce: this.interactionNonce,
        lastInteractedTargetId: this.lastInteractedTargetId,
        target: null,
      };
    }

    const screenAnchor = this.worldToScreenPoint(
      focusedTarget.worldAnchor.x,
      focusedTarget.worldAnchor.y - INTERACTION_BUBBLE_OFFSET_Y,
    );

    return {
      currentTile: selectionState?.currentTile ?? null,
      frontTile: selectionState?.frontTile ?? null,
      interactionNonce: this.interactionNonce,
      lastInteractedTargetId: this.lastInteractedTargetId,
      target: {
        animalInstanceId: focusedTarget.animalInstanceId,
        id: focusedTarget.target.id,
        kind: focusedTarget.target.kind,
        memoryCount: focusedTarget.target.totalMemoryCount,
        memoryIds: [...focusedTarget.target.memoryIds],
        occupiedCells: focusedTarget.target.getOccupiedCells().map((cell) => ({
          column: cell.column,
          row: cell.row,
        })),
        screenX: screenAnchor.x,
        screenY: screenAnchor.y,
        tagKey: focusedTarget.target.tagKey,
        tagLabel: focusedTarget.target.tagLabel,
      },
    };
  }

  private readInteractionDebugBasis(): {
    currentTile: PixelFarmCell;
    frontTile: PixelFarmCell;
    origin: { x: number; y: number };
    facingVector: { x: number; y: number };
  } | null {
    const character = this.character;
    if (!character) {
      return null;
    }

    const origin = this.interactionOriginForCharacter(character);
    if (!origin) {
      return null;
    }

    const facingVector = normalizeFacingVector(
      this.facingVector(character.getFacingDirection()),
    );
    const currentTile = this.worldPointToLocalCell(origin);
    if (!currentTile) {
      return null;
    }

    const frontTile = {
      row: currentTile.row + Math.round(facingVector.y),
      column: currentTile.column + Math.round(facingVector.x),
    };

    return {
      currentTile,
      frontTile,
      origin,
      facingVector,
    };
  }

  private readInteractionSelectionState(): PixelFarmInteractionSelectionState | null {
    if (this.cachedInteractionSelectionFrame === this.interactionSelectionFrame) {
      return this.cachedInteractionSelectionState;
    }

    const nextState = this.computeInteractionSelectionState();
    this.cachedInteractionSelectionFrame = this.interactionSelectionFrame;
    this.cachedInteractionSelectionState = nextState;
    return nextState;
  }

  private computeInteractionSelectionState(): PixelFarmInteractionSelectionState | null {
    const basis = this.readInteractionDebugBasis();
    if (!basis) {
      this.recentInteractionFocus = null;
      return null;
    }

    const targets = this.worldRenderer?.getInteractableTargets() ?? [];
    const candidates = this.collectInteractionCandidates(
      basis.currentTile,
      basis.frontTile,
      targets,
    );
    const focusedTarget = candidates[0] ?? null;

    if (focusedTarget) {
      this.recentInteractionFocus = {
        candidate: focusedTarget,
        capturedAt: this.time.now,
      };
    }

    return {
      currentTile: basis.currentTile,
      frontTile: basis.frontTile,
      origin: basis.origin,
      facingVector: basis.facingVector,
      candidates,
      focusedTarget,
    };
  }

  private resolveFocusedTargetForInteraction(
    currentFocusedTarget: PixelFarmInteractionCandidate | null,
  ): PixelFarmInteractionCandidate | null {
    if (currentFocusedTarget) {
      return currentFocusedTarget;
    }

    const recentFocus = this.recentInteractionFocus;
    if (!recentFocus) {
      return null;
    }

    if (this.time.now - recentFocus.capturedAt > INTERACTION_FOCUS_FALLBACK_MS) {
      this.recentInteractionFocus = null;
      return null;
    }

    return recentFocus.candidate;
  }

  private interactionOriginForCharacter(
    character: PixelFarmCharacter,
  ): { x: number; y: number } | null {
    const body = character.body as Phaser.Physics.Arcade.Body | undefined;
    if (!body) {
      return null;
    }

    return {
      x: body.x + body.width * 0.5,
      y: body.y + body.height - 1,
    };
  }

  private collectInteractionCandidates(
    currentTile: PixelFarmCell,
    frontTile: PixelFarmCell,
    targets: readonly PixelFarmInteractableTarget[],
  ): PixelFarmInteractionCandidate[] {
    const candidates: Array<PixelFarmInteractionCandidate & { tilePriority: number }> = [];

    for (const target of targets) {
      const interactionPoints = target.getInteractionPoints();
      const matchedPoint =
        interactionPoints.find(
          (point) =>
            point.occupiedCell.row === frontTile.row &&
            point.occupiedCell.column === frontTile.column,
        ) ??
        interactionPoints.find(
          (point) =>
            point.occupiedCell.row === currentTile.row &&
            point.occupiedCell.column === currentTile.column,
        );
      if (!matchedPoint) {
        continue;
      }

      const tilePriority =
        matchedPoint.occupiedCell.row === frontTile.row &&
        matchedPoint.occupiedCell.column === frontTile.column
          ? 0
          : 1;
      candidates.push({
        animalInstanceId: matchedPoint.animalInstanceId ?? null,
        target,
        worldAnchor: matchedPoint.worldAnchor,
        tilePriority,
      });
    }

    return candidates
      .sort((left, right) => {
        if (left.tilePriority !== right.tilePriority) {
          return left.tilePriority - right.tilePriority;
        }

        if (left.target.kind !== right.target.kind) {
          return left.target.kind === "crop" ? -1 : 1;
        }

        return left.target.id.localeCompare(right.target.id);
      })
      .map(({ animalInstanceId, target, worldAnchor }) => ({
        animalInstanceId,
        target,
        worldAnchor,
      }));
  }

  private clearInteractionSelectionCache(): void {
    this.cachedInteractionSelectionFrame = undefined;
    this.cachedInteractionSelectionState = null;
  }

  private worldPointToLocalCell(worldPoint: { x: number; y: number }): PixelFarmCell | null {
    const worldColumn = Math.floor(worldPoint.x / PIXEL_FARM_TILE_SIZE);
    const worldRow = Math.floor(worldPoint.y / PIXEL_FARM_TILE_SIZE);
    const column = worldColumn - ISLAND_START_COLUMN;
    const row = worldRow - ISLAND_START_ROW;

    if (!maskHasTile(PIXEL_FARM_ROOT_LAYER.mask, row, column)) {
      return null;
    }

    return { row, column };
  }

  private facingVector(direction: PixelFarmCharacterDirection): { x: number; y: number } {
    switch (direction) {
      case "up":
        return { x: 0, y: -1 };
      case "left":
        return { x: -1, y: 0 };
      case "right":
        return { x: 1, y: 0 };
      case "down":
      default:
        return { x: 0, y: 1 };
    }
  }

  private worldToScreenPoint(worldX: number, worldY: number): { x: number; y: number } {
    const camera = this.cameras.main;

    return {
      x: (worldX - camera.worldView.x) * camera.zoom,
      y: (worldY - camera.worldView.y) * camera.zoom,
    };
  }

  private readPointerDebugInfo(): PixelFarmPointerDebugInfo {
    const pointer = this.input.activePointer;
    if (
      !pointer ||
      pointer.x < 0 ||
      pointer.y < 0 ||
      pointer.x > this.scale.width ||
      pointer.y > this.scale.height
    ) {
      return {
        islandTile: null,
        worldTile: null,
      };
    }

    const worldPoint = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    const worldColumn = Math.floor(worldPoint.x / PIXEL_FARM_TILE_SIZE);
    const worldRow = Math.floor(worldPoint.y / PIXEL_FARM_TILE_SIZE);
    const worldTile =
      worldColumn < 0 ||
      worldRow < 0 ||
      worldColumn >= WORLD_COLUMNS ||
      worldRow >= WORLD_ROWS
        ? null
        : {
            column: worldColumn,
            row: worldRow,
          };

    if (!worldTile) {
      return {
        islandTile: null,
        worldTile: null,
      };
    }

    const islandColumn = worldTile.column - ISLAND_START_COLUMN;
    const islandRow = worldTile.row - ISLAND_START_ROW;
    const islandTile = maskHasTile(PIXEL_FARM_ROOT_LAYER.mask, islandRow, islandColumn)
      ? {
          column: islandColumn,
          row: islandRow,
        }
      : null;

    return {
      islandTile,
      worldTile,
    };
  }

  private drawPhysicsDebugSprite(
    sprite:
      | PixelFarmPreviewActor
      | PixelFarmCharacter
      | PixelFarmBabyCow
      | PixelFarmChicken
      | PixelFarmCow
      | undefined,
    bodyColor: number,
    sortColor: number,
  ): void {
    const graphics = this.worldDebugGraphics;
    if (!graphics || !sprite?.active) {
      return;
    }

    const body = sprite.body as Phaser.Physics.Arcade.Body | undefined;
    if (!body) {
      return;
    }

    graphics.lineStyle(1, bodyColor, 0.95);
    graphics.strokeRect(body.x, body.y, body.width, body.height);
    this.drawSortMarker(body.x + body.width * 0.5, body.y + body.height, sortColor);
  }

  private drawSortMarker(x: number, y: number, color: number): void {
    const graphics = this.worldDebugGraphics;
    if (!graphics) {
      return;
    }

    graphics.lineStyle(1, color, 1);
    graphics.strokeCircle(x, y, 2);
    graphics.lineBetween(x - 3, y, x + 3, y);
    graphics.lineBetween(x, y - 3, x, y + 3);
  }

  private drawCollisionBlockerDebug(color: number): void {
    const graphics = this.worldDebugGraphics;
    if (!graphics || !this.collisionBlockerGroup) {
      return;
    }

    graphics.lineStyle(1, color, 0.85);

    for (const child of this.collisionBlockerGroup.getChildren()) {
      const body = (child as Phaser.GameObjects.GameObject & {
        body?: Phaser.Physics.Arcade.StaticBody;
      }).body;
      if (!body) {
        continue;
      }

      graphics.strokeRect(body.x, body.y, body.width, body.height);
    }
  }

  private drawInteractionOrigin(x: number, y: number, color: number): void {
    const graphics = this.worldDebugGraphics;
    if (!graphics) {
      return;
    }

    graphics.lineStyle(2, color, 1);
    graphics.strokeCircle(x, y, INTERACTION_ORIGIN_MARKER_RADIUS);
    graphics.lineBetween(x - 6, y, x + 6, y);
    graphics.lineBetween(x, y - 6, x, y + 6);
  }

  private drawFacingRay(
    origin: { x: number; y: number },
    facingVector: { x: number; y: number },
    color: number,
  ): void {
    const graphics = this.worldDebugGraphics;
    if (!graphics) {
      return;
    }

    const rayLength = PIXEL_FARM_TILE_SIZE * 2.5;
    graphics.lineStyle(2, color, 0.95);
    graphics.lineBetween(
      origin.x,
      origin.y,
      origin.x + facingVector.x * rayLength,
      origin.y + facingVector.y * rayLength,
    );
  }

  private drawInteractionFrontTile(
    cell: PixelFarmCell,
    color: number,
    alpha: number,
  ): void {
    const graphics = this.worldDebugGraphics;
    if (!graphics) {
      return;
    }

    const origin = this.cellToWorldOrigin(cell);
    graphics.lineStyle(1, color, 0.8);
    graphics.fillStyle(color, alpha);
    graphics.strokeRect(origin.x, origin.y, PIXEL_FARM_TILE_SIZE, PIXEL_FARM_TILE_SIZE);
    graphics.fillRect(origin.x, origin.y, PIXEL_FARM_TILE_SIZE, PIXEL_FARM_TILE_SIZE);
  }

  private drawInteractionTileOutline(
    cell: PixelFarmCell,
    color: number,
    lineWidth: number,
    alpha: number,
  ): void {
    const graphics = this.worldDebugGraphics;
    if (!graphics) {
      return;
    }

    const origin = this.cellToWorldOrigin(cell);
    graphics.lineStyle(lineWidth, color, alpha);
    graphics.strokeRect(origin.x, origin.y, PIXEL_FARM_TILE_SIZE, PIXEL_FARM_TILE_SIZE);
  }

  private drawInteractionCandidate(
    worldAnchor: { x: number; y: number },
    color: number,
    focused: boolean,
  ): void {
    const graphics = this.worldDebugGraphics;
    if (!graphics) {
      return;
    }

    graphics.lineStyle(focused ? 2 : 1, color, focused ? 1 : 0.85);
    graphics.strokeCircle(worldAnchor.x, worldAnchor.y, INTERACTION_ANCHOR_MARKER_RADIUS + (focused ? 2 : 0));
    graphics.lineBetween(worldAnchor.x - 4, worldAnchor.y, worldAnchor.x + 4, worldAnchor.y);
    graphics.lineBetween(worldAnchor.x, worldAnchor.y - 4, worldAnchor.x, worldAnchor.y + 4);
  }

  private createDebugActor(debugState: PixelFarmDebugState): PixelFarmPreviewActor {
    const debugActorConfig = {
      scene: this,
      depth: ACTOR_LAYER_DEPTH + 1,
      startX: ISLAND_CENTER_X,
      startY: ISLAND_CENTER_Y + PIXEL_FARM_TILE_SIZE,
      canOccupy: this.canActorOccupy,
    };

    switch (debugState.type) {
      case "character":
        return new PixelFarmCharacter(debugActorConfig);
      case "cow":
        return new PixelFarmCow({
          ...debugActorConfig,
          color: debugState.variant as PixelFarmCowColor,
        });
      case "baby-cow":
        return new PixelFarmBabyCow({
          ...debugActorConfig,
          color: debugState.variant as PixelFarmBabyCowColor,
        });
      case "chicken":
        return new PixelFarmChicken({
          ...debugActorConfig,
          color: debugState.variant as PixelFarmChickenColor,
        });
    }
  }

  private applyDebugPoseToActor(
    actor: PixelFarmPreviewActor,
    debugState: PixelFarmDebugState,
  ): void {
    switch (debugState.type) {
      case "character":
        if (actor instanceof PixelFarmCharacter) {
          actor.applyDebugPose(
            debugState.state as PixelFarmCharacterAction,
            debugState.direction,
            debugState.playing,
          );
        }
        return;
      case "cow":
        if (actor instanceof PixelFarmCow) {
          actor.applyDebugPose(
            debugState.state as PixelFarmCowState,
            debugState.direction === "left",
            debugState.playing,
          );
        }
        return;
      case "baby-cow":
        if (actor instanceof PixelFarmBabyCow) {
          actor.applyDebugPose(
            debugState.state as PixelFarmBabyCowState,
            debugState.direction === "left",
            debugState.playing,
          );
        }
        return;
      case "chicken":
        if (actor instanceof PixelFarmChicken) {
          actor.applyDebugPose(
            debugState.state as PixelFarmChickenState,
            debugState.direction === "left",
            debugState.playing,
          );
        }
        return;
    }
  }

  private findCharacterSpawnCell(): PixelFarmCell {
    const centerRow = Math.round((PIXEL_FARM_MASK_BOUNDS.minRow + PIXEL_FARM_MASK_BOUNDS.maxRow) * 0.5);
    const centerColumn = Math.round(
      (PIXEL_FARM_MASK_BOUNDS.minColumn + PIXEL_FARM_MASK_BOUNDS.maxColumn) * 0.5,
    );
    let bestCell: PixelFarmCell | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let row = 0; row < ISLAND_ROWS; row += 1) {
      for (let column = 0; column < ISLAND_COLUMNS; column += 1) {
        if (!this.isSpawnableLocalCell(row, column)) {
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

  private cellToWorldPosition(cell: PixelFarmCell): { x: number; y: number } {
    return {
      x: (ISLAND_START_COLUMN + cell.column + 0.5) * PIXEL_FARM_TILE_SIZE,
      y: (ISLAND_START_ROW + cell.row + 1) * PIXEL_FARM_TILE_SIZE,
    };
  }

  private cellToWorldOrigin(cell: PixelFarmCell): { x: number; y: number } {
    return {
      x: (ISLAND_START_COLUMN + cell.column) * PIXEL_FARM_TILE_SIZE,
      y: (ISLAND_START_ROW + cell.row) * PIXEL_FARM_TILE_SIZE,
    };
  }

  private rebuildCollisionBodies(): void {
    this.collisionBlockerGroup = createPixelFarmStaticCollisionBodies({
      scene: this,
      segments: PIXEL_FARM_COLLISIONS,
      offsetX: ISLAND_START_COLUMN * PIXEL_FARM_TILE_SIZE,
      offsetY: ISLAND_START_ROW * PIXEL_FARM_TILE_SIZE,
      group: this.collisionBlockerGroup,
    });
  }

  private worldRectToLocalRect(
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): PixelFarmCollisionRect {
    return {
      left: left / PIXEL_FARM_TILE_SIZE - ISLAND_START_COLUMN,
      top: top / PIXEL_FARM_TILE_SIZE - ISLAND_START_ROW,
      right: right / PIXEL_FARM_TILE_SIZE - ISLAND_START_COLUMN,
      bottom: bottom / PIXEL_FARM_TILE_SIZE - ISLAND_START_ROW,
    };
  }

  private canCharacterStandAtCell(row: number, column: number): boolean {
    if (!maskHasTile(PIXEL_FARM_ROOT_LAYER.mask, row, column)) {
      return false;
    }

    const worldPosition = this.cellToWorldPosition({ row, column });
    const rect = measurePixelFarmCharacterBodyAt(worldPosition.x, worldPosition.y);
    return this.canActorOccupy(rect.left, rect.top, rect.right, rect.bottom);
  }

  private isSpawnableLocalCell(row: number, column: number): boolean {
    if (!this.canCharacterStandAtCell(row, column)) {
      return false;
    }

    const directions = [
      { row: -1, column: 0 },
      { row: 1, column: 0 },
      { row: 0, column: -1 },
      { row: 0, column: 1 },
    ] as const;

    return directions.some((direction) =>
      this.canCharacterStandAtCell(row + direction.row, column + direction.column),
    );
  }

  private canActorOccupy = (
    left: number,
    top: number,
    right: number,
    bottom: number,
    _moveX = 0,
    _moveY = 0,
  ): boolean => {
    const maxColumn = Math.floor((right - 0.001) / PIXEL_FARM_TILE_SIZE);
    const maxRow = Math.floor((bottom - 0.001) / PIXEL_FARM_TILE_SIZE);
    const minColumn = Math.floor(left / PIXEL_FARM_TILE_SIZE);
    const minRow = Math.floor(top / PIXEL_FARM_TILE_SIZE);

    for (let worldRow = minRow; worldRow <= maxRow; worldRow += 1) {
      for (let worldColumn = minColumn; worldColumn <= maxColumn; worldColumn += 1) {
        const localRow = worldRow - ISLAND_START_ROW;
        const localColumn = worldColumn - ISLAND_START_COLUMN;

        if (!maskHasTile(PIXEL_FARM_ROOT_LAYER.mask, localRow, localColumn)) {
          return false;
        }
      }
    }

    return !intersectsPixelFarmCollision(
      PIXEL_FARM_COLLISION_INDEX,
      this.worldRectToLocalRect(left, top, right, bottom),
    );
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
    this.hasUserInteracted = true;
    this.dragState.active = true;
    this.dragState.pointerId = pointer.id;
    this.dragState.lastX = pointer.x;
    this.dragState.lastY = pointer.y;
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.dragState.active || this.dragState.pointerId !== pointer.id) {
      return;
    }

    this.dragState.lastX = pointer.x;
    this.dragState.lastY = pointer.y;
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

  private startCameraFollow(): void {
    const camera = this.cameras.main;
    if (!this.character) {
      camera.stopFollow();
      return;
    }

    camera.setDeadzone(
      PIXEL_FARM_TILE_SIZE * CAMERA_DEADZONE_TILES_X,
      PIXEL_FARM_TILE_SIZE * CAMERA_DEADZONE_TILES_Y,
    );
    camera.startFollow(
      this.character,
      false,
      CAMERA_FOLLOW_LERP,
      CAMERA_FOLLOW_LERP,
    );
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

export function createPixelFarmGame(
  parent: HTMLElement,
  options: PixelFarmGameOptions = {},
): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: "#0d141b",
    pixelArt: true,
    physics: {
      default: "arcade",
      arcade: {
        gravity: { x: 0, y: 0 },
        debug: ARCADE_DEBUG_ENABLED,
        debugShowBody: ARCADE_DEBUG_ENABLED,
        debugShowVelocity: false,
      },
    },
    scene: [new PixelFarmSandboxScene(options), new PixelFarmUIScene()],
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
