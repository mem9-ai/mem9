import Phaser from "phaser";
import { PIXEL_FARM_CHICKEN_TEXTURE_KEYS } from "@/lib/pixel-farm/runtime-assets";
import { pixelFarmDepthForSpriteBody } from "@/lib/pixel-farm/depth";
import { PIXEL_FARM_TILE_SIZE } from "@/lib/pixel-farm/tileset-config";

const CHICKEN_BODY_WIDTH = 8;
const CHICKEN_BODY_HEIGHT = 5;
const CHICKEN_WALK_SPEED = 36;
const CHICKEN_AI_THINK_INTERVAL_MS = 160;
const CHICKEN_TOP_FRAME_WIDTH = 16;
const CHICKEN_TOP_FRAME_HEIGHT = 16;
const CHICKEN_TOP_FRAMES_PER_ROW = 8;
const CHICKEN_TOP_ROW_COUNT = 26;
const CHICKEN_BODY_BOTTOM_MARGIN = 1;
const CHICKEN_ROAMING_COLLISION_COOLDOWN_MS = 400;
const CHICKEN_ROAMING_COLLISION_IDLE_MS = 400;
const CHICKEN_ROAMING_COLLISION_RETREAT_MS = 220;
const CHICKEN_ROAMING_COLLISION_FACE_THRESHOLD = 2;
const CHICKEN_BLOCKED_IDLE_MS = 280;
const CHICKEN_STANDARD_ANCHOR_X = CHICKEN_TOP_FRAME_WIDTH * 0.5;

export const PIXEL_FARM_CHICKEN_COLORS = [
  "blue",
  "brown",
  "default",
  "green",
  "red",
] as const;

type ChickenAnimationConfig = {
  frames: readonly number[];
  fps: number;
  repeat: number;
};

function topRowFrames(row: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => row * CHICKEN_TOP_FRAMES_PER_ROW + index);
}

function chickenFrameName(index: number): string {
  return `frame-${index}`;
}

function chickenAnchorX(_state: PixelFarmChickenState): number {
  return CHICKEN_STANDARD_ANCHOR_X;
}

function chickenFrameHeight(state: PixelFarmChickenState): number {
  void state;
  return CHICKEN_TOP_FRAME_HEIGHT;
}

const CHICKEN_STATES = {
  idle: { frames: topRowFrames(0, 4), fps: 5, repeat: -1 },
  walk: { frames: topRowFrames(1, 7), fps: 9, repeat: -1 },
  strut: { frames: topRowFrames(2, 8), fps: 9, repeat: -1 },
  peck: { frames: topRowFrames(3, 7), fps: 8, repeat: -1 },
  look: { frames: topRowFrames(4, 7), fps: 7, repeat: -1 },
  preen: { frames: topRowFrames(5, 7), fps: 7, repeat: -1 },
  shake: { frames: topRowFrames(6, 7), fps: 7, repeat: -1 },
  sitDown: { frames: topRowFrames(7, 5), fps: 7, repeat: 0 },
  sitIdle: { frames: topRowFrames(8, 4), fps: 4, repeat: -1 },
  sitLook: { frames: topRowFrames(9, 5), fps: 5, repeat: -1 },
  standUp: { frames: topRowFrames(10, 4), fps: 8, repeat: 0 },
  groundFlutter: { frames: topRowFrames(11, 6), fps: 10, repeat: -1 },
  blink: { frames: topRowFrames(12, 2), fps: 6, repeat: -1 },
} as const satisfies Record<string, ChickenAnimationConfig>;

export type PixelFarmChickenColor = (typeof PIXEL_FARM_CHICKEN_COLORS)[number];
export type PixelFarmChickenState = keyof typeof CHICKEN_STATES;
export const PIXEL_FARM_CHICKEN_STATE_OPTIONS = Object.keys(
  CHICKEN_STATES,
) as PixelFarmChickenState[];

export interface PixelFarmChickenConfig {
  scene: Phaser.Scene;
  color: PixelFarmChickenColor;
  depth: number;
  startX: number;
  startY: number;
  canOccupy: (
    left: number,
    top: number,
    right: number,
    bottom: number,
    moveX?: number,
    moveY?: number,
  ) => boolean;
  pickWalkTarget?: (currentX: number, currentY: number) => Phaser.Math.Vector2 | null;
}

function animationKey(color: PixelFarmChickenColor, state: PixelFarmChickenState): string {
  return `pixel-farm-chicken-${color}-${state}`;
}

function chickenTextureKey(color: PixelFarmChickenColor): string {
  return PIXEL_FARM_CHICKEN_TEXTURE_KEYS[color];
}

function randomRange(min: number, max: number): number {
  return Phaser.Math.Between(min, max);
}

function addChickenFrame(
  texture: Phaser.Textures.Texture,
  index: number,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  texture.add(chickenFrameName(index), 0, x, y, width, height);
}

function registerChickenFramesForColor(scene: Phaser.Scene, color: PixelFarmChickenColor): void {
  const texture = scene.textures.get(chickenTextureKey(color));
  if (!texture || texture.has(chickenFrameName(0))) {
    return;
  }

  for (let row = 0; row < CHICKEN_TOP_ROW_COUNT; row += 1) {
    for (let column = 0; column < CHICKEN_TOP_FRAMES_PER_ROW; column += 1) {
      const index = row * CHICKEN_TOP_FRAMES_PER_ROW + column;
      addChickenFrame(
        texture,
        index,
        column * CHICKEN_TOP_FRAME_WIDTH,
        row * CHICKEN_TOP_FRAME_HEIGHT,
        CHICKEN_TOP_FRAME_WIDTH,
        CHICKEN_TOP_FRAME_HEIGHT,
      );
    }
  }
}

export function registerPixelFarmChickenAnimations(scene: Phaser.Scene): void {
  for (const color of PIXEL_FARM_CHICKEN_COLORS) {
    registerChickenFramesForColor(scene, color);

    for (const [state, config] of Object.entries(CHICKEN_STATES) as Array<
      [PixelFarmChickenState, (typeof CHICKEN_STATES)[PixelFarmChickenState]]
    >) {
      const key = animationKey(color, state);
      if (scene.anims.exists(key)) {
        continue;
      }

      scene.anims.create({
        key,
        frames: config.frames.map((frame) => ({
          key: chickenTextureKey(color),
          frame: chickenFrameName(frame),
        })),
        frameRate: config.fps,
        repeat: config.repeat,
      });
    }
  }
}

export function measurePixelFarmChickenBodyAt(
  x: number,
  y: number,
): { left: number; top: number; right: number; bottom: number } {
  const anchorX = chickenAnchorX("idle");
  const frameHeight = chickenFrameHeight("idle");
  const bodyOffsetX = Math.round(anchorX - CHICKEN_BODY_WIDTH * 0.5);
  const bodyOffsetY = frameHeight - CHICKEN_BODY_HEIGHT - CHICKEN_BODY_BOTTOM_MARGIN;
  const left = x - anchorX + bodyOffsetX;
  const top = y - frameHeight + bodyOffsetY;

  return {
    left,
    top,
    right: left + CHICKEN_BODY_WIDTH,
    bottom: top + CHICKEN_BODY_HEIGHT,
  };
}

export class PixelFarmChicken extends Phaser.Physics.Arcade.Sprite {
  private readonly canOccupy: PixelFarmChickenConfig["canOccupy"];
  private readonly color: PixelFarmChickenColor;
  private readonly depthBase: number;
  private readonly pickWalkTarget?: PixelFarmChickenConfig["pickWalkTarget"];
  private chickenState: PixelFarmChickenState = "idle";
  private debugPoseLocked = false;
  private interactionHeld = false;
  private stateTimerMs = 0;
  private aiThinkCooldownMs = 0;
  private roamingCollisionCooldownMs = 0;
  private readonly retreatBiasY = Math.random() < 0.5 ? -1 : 1;
  private target: Phaser.Math.Vector2 | null = null;

  constructor(config: PixelFarmChickenConfig) {
    super(
      config.scene,
      config.startX,
      config.startY,
      chickenTextureKey(config.color),
      chickenFrameName(CHICKEN_STATES.idle.frames[0]!),
    );

    this.canOccupy = config.canOccupy;
    this.color = config.color;
    this.depthBase = config.depth;
    this.pickWalkTarget = config.pickWalkTarget;

    config.scene.add.existing(this);
    config.scene.physics.add.existing(this);

    this.setOrigin(0, 1);
    const body = this.body as Phaser.Physics.Arcade.Body;

    body.setSize(CHICKEN_BODY_WIDTH, CHICKEN_BODY_HEIGHT);
    body.setAllowGravity(false);
    body.setCollideWorldBounds(false);
    this.setDrag(900, 900);
    this.syncBody();
    this.setDepth(pixelFarmDepthForSpriteBody(this, this.depthBase));

    this.on(Phaser.Animations.Events.ANIMATION_COMPLETE, this.handleAnimationComplete, this);
    this.enterTimedState("idle", randomRange(1000, 2000));
  }

  override destroy(fromScene?: boolean): void {
    this.off(Phaser.Animations.Events.ANIMATION_COMPLETE, this.handleAnimationComplete, this);
    super.destroy(fromScene);
  }

  update(deltaMs: number): void {
    this.syncBody();

    if (this.debugPoseLocked) {
      this.setVelocity(0, 0);
      this.setDepth(pixelFarmDepthForSpriteBody(this, this.depthBase));
      return;
    }

    if (this.interactionHeld) {
      this.setVelocity(0, 0);
      this.setDepth(pixelFarmDepthForSpriteBody(this, this.depthBase));
      return;
    }
    this.roamingCollisionCooldownMs = Math.max(0, this.roamingCollisionCooldownMs - deltaMs);
    this.aiThinkCooldownMs = Math.max(0, this.aiThinkCooldownMs - deltaMs);

    if (this.chickenState === "walk") {
      this.updateWalk(deltaMs);
      this.setDepth(pixelFarmDepthForSpriteBody(this, this.depthBase));
      return;
    }

    this.setVelocity(0, 0);

    if (
      this.chickenState === "sitDown" ||
      this.chickenState === "standUp"
    ) {
      this.setDepth(pixelFarmDepthForSpriteBody(this, this.depthBase));
      return;
    }

    this.stateTimerMs -= deltaMs;
    if (this.stateTimerMs <= 0 && this.aiThinkCooldownMs <= 0) {
      this.aiThinkCooldownMs = CHICKEN_AI_THINK_INTERVAL_MS;
      this.chooseNextState();
    }

    this.setDepth(pixelFarmDepthForSpriteBody(this, this.depthBase));
  }

  setInteractionHeld(held: boolean): void {
    if (this.interactionHeld === held) {
      return;
    }

    this.interactionHeld = held;
    if (!held || this.debugPoseLocked) {
      return;
    }

    this.enterTimedState("idle", randomRange(1000, 2000));
  }

  triggerLove(sourceX: number): void {
    void sourceX;
  }

  applyDebugPose(state: PixelFarmChickenState, flipX: boolean, playing: boolean): void {
    this.debugPoseLocked = true;
    this.chickenState = state;
    this.target = null;
    this.stateTimerMs = 0;
    this.setVelocity(0, 0);
    this.setFlipX(flipX);
    this.playState(state, false);

    if (playing) {
      this.anims.resume();
    } else {
      this.anims.pause();
    }

    this.syncBody();
  }

  handleRoamingCollision(otherX: number, _otherY: number): void {
    if (this.debugPoseLocked) {
      return;
    }

    if (
      this.chickenState === "sitDown" ||
      this.chickenState === "standUp" ||
      this.roamingCollisionCooldownMs > 0
    ) {
      return;
    }

    this.roamingCollisionCooldownMs = CHICKEN_ROAMING_COLLISION_COOLDOWN_MS;
    this.target = null;
    this.stateTimerMs = 0;
    this.setVelocity(0, 0);

    const deltaX = this.x - otherX;
    if (Math.abs(deltaX) >= CHICKEN_ROAMING_COLLISION_FACE_THRESHOLD) {
      this.setFlipX(deltaX < 0);
    }

    if (this.startCollisionRetreat(otherX)) {
      return;
    }

    this.enterTimedState("idle", CHICKEN_ROAMING_COLLISION_IDLE_MS);
  }

  private updateWalk(deltaMs: number): void {
    if (!this.target) {
      this.enterTimedState("idle", randomRange(900, 1600));
      return;
    }

    const deltaSeconds = deltaMs / 1000;
    const deltaX = this.target.x - this.x;
    const deltaY = this.target.y - this.y;
    const distance = Math.hypot(deltaX, deltaY);

    if (distance <= 3) {
      this.enterTimedState("idle", randomRange(900, 1600));
      return;
    }

    const normalizedX = deltaX / distance;
    const normalizedY = deltaY / distance;
    const velocityX = normalizedX * CHICKEN_WALK_SPEED;
    const velocityY = normalizedY * CHICKEN_WALK_SPEED;

    if (!this.canOccupyAt(
      this.x + velocityX * deltaSeconds,
      this.y + velocityY * deltaSeconds,
      velocityX,
      velocityY,
    )) {
      this.handleBlockedWalk();
      return;
    }

    if (Math.abs(velocityX) > 0.5) {
      this.setFlipX(velocityX < 0);
    }

    this.setVelocity(velocityX, velocityY);
    this.stateTimerMs -= deltaMs;
    if (this.stateTimerMs <= 0) {
      this.enterTimedState("idle", randomRange(900, 1600));
    }
  }

  private handleBlockedWalk(): void {
    this.target = null;
    this.aiThinkCooldownMs = CHICKEN_AI_THINK_INTERVAL_MS;
    this.enterTimedState("idle", CHICKEN_BLOCKED_IDLE_MS);
  }

  private chooseNextState(): void {
    const roll = Math.random();

    if (roll < 0.3 && this.startWalk()) {
      return;
    }

    if (roll < 0.56) {
      this.enterTimedState("peck", randomRange(1200, 2200));
      return;
    }

    if (roll < 0.74) {
      const calmStates: Array<Extract<
        PixelFarmChickenState,
        "look" | "preen" | "shake" | "blink"
      >> = ["look", "preen", "shake", "blink"];
      this.enterTimedState(
        Phaser.Utils.Array.GetRandom(calmStates),
        randomRange(1200, 2200),
      );
      return;
    }

    if (roll < 0.88) {
      this.chickenState = "sitDown";
      this.target = null;
      this.playState("sitDown", false);
      return;
    }

    this.enterTimedState("idle", randomRange(1000, 2000));
  }

  private startWalk(): boolean {
    const pickedTarget = this.pickWalkTarget?.(this.x, this.y) ?? null;
    if (pickedTarget) {
      this.target = pickedTarget;
      this.chickenState = "walk";
      this.stateTimerMs = randomRange(1200, 2600);
      this.playState("walk");
      return true;
    }

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const offsetColumn = randomRange(-5, 5);
      const offsetRow = randomRange(-5, 5);

      if (offsetColumn === 0 && offsetRow === 0) {
        continue;
      }

      const targetX = this.x + offsetColumn * PIXEL_FARM_TILE_SIZE;
      const targetY = this.y + offsetRow * PIXEL_FARM_TILE_SIZE;
      if (!this.canOccupyAt(targetX, targetY)) {
        continue;
      }

      this.target = new Phaser.Math.Vector2(targetX, targetY);
      this.chickenState = "walk";
      this.stateTimerMs = randomRange(1200, 2600);
      this.playState("walk");
      return true;
    }

    return false;
  }

  private startCollisionRetreat(otherX: number): boolean {
    const currentColumn = Math.round(this.x / PIXEL_FARM_TILE_SIZE);
    const currentRow = Math.round(this.y / PIXEL_FARM_TILE_SIZE);
    const horizontalDirection = this.x >= otherX ? 1 : -1;
    const awayColumn = horizontalDirection;
    const preferredRow = this.retreatBiasY;
    const candidateOffsets = [
      { column: awayColumn, row: 0 },
      { column: 0, row: preferredRow },
      { column: 0, row: -preferredRow },
      { column: awayColumn, row: preferredRow },
      { column: awayColumn, row: -preferredRow },
      { column: -awayColumn, row: 0 },
      { column: -awayColumn, row: preferredRow },
      { column: -awayColumn, row: -preferredRow },
    ];

    for (const offset of candidateOffsets) {
      const targetX = (currentColumn + offset.column) * PIXEL_FARM_TILE_SIZE;
      const targetY = (currentRow + offset.row) * PIXEL_FARM_TILE_SIZE;
      if (!this.canOccupyAt(targetX, targetY)) {
        continue;
      }

      this.target = new Phaser.Math.Vector2(targetX, targetY);
      this.chickenState = "walk";
      this.stateTimerMs = CHICKEN_ROAMING_COLLISION_RETREAT_MS;
      this.aiThinkCooldownMs = CHICKEN_AI_THINK_INTERVAL_MS;
      this.playState("walk");
      return true;
    }

    return false;
  }

  private handleAnimationComplete(): void {
    if (this.debugPoseLocked) {
      return;
    }

    if (this.chickenState === "sitDown") {
      this.enterTimedState(Math.random() < 0.5 ? "sitIdle" : "sitLook", randomRange(1400, 2400));
      return;
    }

    if (this.chickenState === "standUp") {
      this.enterTimedState("idle", randomRange(900, 1600));
    }
  }

  private enterTimedState(
    state: Extract<
      PixelFarmChickenState,
      "idle" | "peck" | "look" | "preen" | "shake" | "blink" | "sitIdle" | "sitLook"
    >,
    durationMs: number,
  ): void {
    this.chickenState = state;
    this.stateTimerMs = durationMs;
    this.target = null;
    this.setVelocity(0, 0);
    this.playState(state, false);
  }

  private canOccupyAt(x: number, y: number, moveX = 0, moveY = 0): boolean {
    const frameHeight = chickenFrameHeight(this.chickenState);
    const anchorX = chickenAnchorX(this.chickenState);
    const bodyOffsetX = Math.round(anchorX - CHICKEN_BODY_WIDTH * 0.5);
    const bodyOffsetY = frameHeight - CHICKEN_BODY_HEIGHT - CHICKEN_BODY_BOTTOM_MARGIN;
    const left = x - anchorX + bodyOffsetX;
    const top = y - frameHeight + bodyOffsetY;

    return this.canOccupy(
      left,
      top,
      left + CHICKEN_BODY_WIDTH,
      top + CHICKEN_BODY_HEIGHT,
      moveX,
      moveY,
    );
  }

  private syncBody(): void {
    const body = this.body as Phaser.Physics.Arcade.Body | undefined;
    if (!body) {
      return;
    }

    const anchorWorldX = this.x;
    const anchorWorldY = this.y;
    const frameHeight = chickenFrameHeight(this.chickenState);
    const anchorX = chickenAnchorX(this.chickenState);
    const bodyOffsetX = Math.round(anchorX - CHICKEN_BODY_WIDTH * 0.5);
    const bodyOffsetY = frameHeight - CHICKEN_BODY_HEIGHT - CHICKEN_BODY_BOTTOM_MARGIN;

    this.setDisplayOrigin(anchorX, frameHeight);
    this.setPosition(anchorWorldX, anchorWorldY);
    body.setSize(CHICKEN_BODY_WIDTH, CHICKEN_BODY_HEIGHT);
    body.setOffset(bodyOffsetX, bodyOffsetY);
  }

  private playState(state: PixelFarmChickenState, ignoreIfPlaying = true): void {
    this.anims.play(animationKey(this.color, state), ignoreIfPlaying);
    this.syncBody();
  }
}
