import Phaser from "phaser";
import {
  PIXEL_FARM_BABY_COW_FRAME_HEIGHT,
  PIXEL_FARM_BABY_COW_FRAME_WIDTH,
  PIXEL_FARM_BABY_COW_TEXTURE_KEYS,
} from "@/lib/pixel-farm/runtime-assets";
import { pixelFarmDepthForSpriteBody } from "@/lib/pixel-farm/depth";
import { PIXEL_FARM_TILE_SIZE } from "@/lib/pixel-farm/tileset-config";

const BABY_COW_SPRITE_ORIGIN_X = 0.5;
const BABY_COW_SPRITE_ORIGIN_Y = 0.8;
const BABY_COW_BODY_WIDTH = 14;
const BABY_COW_BODY_HEIGHT = 8;
const BABY_COW_BODY_OFFSET_X = 9;
const BABY_COW_BODY_OFFSET_Y = 20;
const BABY_COW_RUN_SPEED = 40;
const BABY_COW_LOVE_COOLDOWN_MS = 2600;
const BABY_COW_AI_THINK_INTERVAL_MS = 180;
const BABY_COW_ROAMING_COLLISION_COOLDOWN_MS = 350;
const BABY_COW_ROAMING_COLLISION_IDLE_MS = 350;
const BABY_COW_ROAMING_COLLISION_RETREAT_MS = 550;
const BABY_COW_ROAMING_COLLISION_FACE_THRESHOLD = 2;
const BABY_COW_BLOCKED_IDLE_MS = 240;

export const PIXEL_FARM_BABY_COW_COLORS = [
  "brown",
  "green",
  "light",
  "pink",
  "purple",
] as const;

const BABY_COW_STATES = {
  idle: { row: 0, frames: 2, fps: 4, repeat: -1 },
  headBob: { row: 1, frames: 4, fps: 6, repeat: -1 },
  run: { row: 2, frames: 4, fps: 10, repeat: -1 },
  hop: { row: 3, frames: 3, fps: 10, repeat: 0 },
  sit: { row: 4, frames: 4, fps: 8, repeat: 0 },
  sitNap: { row: 5, frames: 2, fps: 2, repeat: -1 },
  grazeDown: { row: 6, frames: 8, fps: 10, repeat: 0 },
  grazeChew: { row: 7, frames: 4, fps: 4, repeat: -1 },
  love: { row: 8, frames: 6, fps: 8, repeat: 0 },
} as const;

export type PixelFarmBabyCowColor = (typeof PIXEL_FARM_BABY_COW_COLORS)[number];
export type PixelFarmBabyCowState = keyof typeof BABY_COW_STATES;
export const PIXEL_FARM_BABY_COW_STATE_OPTIONS = Object.keys(
  BABY_COW_STATES,
) as PixelFarmBabyCowState[];

export interface PixelFarmBabyCowConfig {
  scene: Phaser.Scene;
  color: PixelFarmBabyCowColor;
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
}

function animationKey(color: PixelFarmBabyCowColor, state: PixelFarmBabyCowState): string {
  return `pixel-farm-baby-cow-${color}-${state}`;
}

function babyCowTextureKey(color: PixelFarmBabyCowColor): string {
  return PIXEL_FARM_BABY_COW_TEXTURE_KEYS[color];
}

function randomRange(min: number, max: number): number {
  return Phaser.Math.Between(min, max);
}

export function registerPixelFarmBabyCowAnimations(scene: Phaser.Scene): void {
  for (const color of PIXEL_FARM_BABY_COW_COLORS) {
    for (const [state, config] of Object.entries(BABY_COW_STATES) as Array<
      [PixelFarmBabyCowState, (typeof BABY_COW_STATES)[PixelFarmBabyCowState]]
    >) {
      const key = animationKey(color, state);
      if (scene.anims.exists(key)) {
        continue;
      }

      const start = config.row * 8;
      scene.anims.create({
        key,
        frames: scene.anims.generateFrameNumbers(babyCowTextureKey(color), {
          start,
          end: start + config.frames - 1,
        }),
        frameRate: config.fps,
        repeat: config.repeat,
      });
    }
  }
}

export function measurePixelFarmBabyCowBodyAt(
  x: number,
  y: number,
): { left: number; top: number; right: number; bottom: number } {
  const left =
    x - PIXEL_FARM_BABY_COW_FRAME_WIDTH * BABY_COW_SPRITE_ORIGIN_X + BABY_COW_BODY_OFFSET_X;
  const top =
    y - PIXEL_FARM_BABY_COW_FRAME_HEIGHT * BABY_COW_SPRITE_ORIGIN_Y + BABY_COW_BODY_OFFSET_Y;

  return {
    left,
    top,
    right: left + BABY_COW_BODY_WIDTH,
    bottom: top + BABY_COW_BODY_HEIGHT,
  };
}

export class PixelFarmBabyCow extends Phaser.Physics.Arcade.Sprite {
  private readonly canOccupy: PixelFarmBabyCowConfig["canOccupy"];
  private readonly color: PixelFarmBabyCowColor;
  private readonly depthBase: number;
  private babyCowState: PixelFarmBabyCowState = "idle";
  private debugPoseLocked = false;
  private interactionHeld = false;
  private stateTimerMs = 0;
  private aiThinkCooldownMs = 0;
  private loveCooldownMs = 0;
  private roamingCollisionCooldownMs = 0;
  private readonly retreatBiasY = Math.random() < 0.5 ? -1 : 1;
  private target: Phaser.Math.Vector2 | null = null;

  constructor(config: PixelFarmBabyCowConfig) {
    super(config.scene, config.startX, config.startY, babyCowTextureKey(config.color), 0);

    this.canOccupy = config.canOccupy;
    this.color = config.color;
    this.depthBase = config.depth;

    config.scene.add.existing(this);
    config.scene.physics.add.existing(this);

    this.setOrigin(BABY_COW_SPRITE_ORIGIN_X, BABY_COW_SPRITE_ORIGIN_Y);
    const body = this.body as Phaser.Physics.Arcade.Body;

    body.setSize(BABY_COW_BODY_WIDTH, BABY_COW_BODY_HEIGHT);
    body.setOffset(BABY_COW_BODY_OFFSET_X, BABY_COW_BODY_OFFSET_Y);
    body.setAllowGravity(false);
    body.setCollideWorldBounds(false);
    this.setDrag(900, 900);
    this.setDepth(pixelFarmDepthForSpriteBody(this, this.depthBase));

    this.on(Phaser.Animations.Events.ANIMATION_COMPLETE, this.handleAnimationComplete, this);
    this.enterTimedState("idle", randomRange(1200, 2200));
  }

  override destroy(fromScene?: boolean): void {
    this.off(Phaser.Animations.Events.ANIMATION_COMPLETE, this.handleAnimationComplete, this);
    super.destroy(fromScene);
  }

  update(deltaMs: number): void {
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

    this.loveCooldownMs = Math.max(0, this.loveCooldownMs - deltaMs);
    this.roamingCollisionCooldownMs = Math.max(0, this.roamingCollisionCooldownMs - deltaMs);
    this.aiThinkCooldownMs = Math.max(0, this.aiThinkCooldownMs - deltaMs);

    if (this.babyCowState === "run") {
      this.updateRun(deltaMs);
      this.setDepth(pixelFarmDepthForSpriteBody(this, this.depthBase));
      return;
    }

    this.setVelocity(0, 0);

    if (
      this.babyCowState === "hop" ||
      this.babyCowState === "sit" ||
      this.babyCowState === "grazeDown" ||
      this.babyCowState === "love"
    ) {
      this.setDepth(pixelFarmDepthForSpriteBody(this, this.depthBase));
      return;
    }

    this.stateTimerMs -= deltaMs;
    if (this.stateTimerMs <= 0 && this.aiThinkCooldownMs <= 0) {
      this.aiThinkCooldownMs = BABY_COW_AI_THINK_INTERVAL_MS;
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

    this.enterTimedState("idle", randomRange(1200, 2200));
  }

  triggerLove(sourceX: number): void {
    if (this.loveCooldownMs > 0 || this.babyCowState === "love") {
      return;
    }

    this.setFlipX(sourceX < this.x);
    this.loveCooldownMs = BABY_COW_LOVE_COOLDOWN_MS;
    this.target = null;
    this.stateTimerMs = 0;
    this.babyCowState = "love";
    this.setVelocity(0, 0);
    this.playState("love", false);
  }

  applyDebugPose(state: PixelFarmBabyCowState, flipX: boolean, playing: boolean): void {
    this.debugPoseLocked = true;
    this.babyCowState = state;
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
  }

  handleRoamingCollision(otherX: number, _otherY: number): void {
    if (this.debugPoseLocked) {
      return;
    }

    if (
      this.babyCowState === "love" ||
      this.babyCowState === "hop" ||
      this.babyCowState === "sit" ||
      this.babyCowState === "grazeDown" ||
      this.roamingCollisionCooldownMs > 0
    ) {
      return;
    }

    this.roamingCollisionCooldownMs = BABY_COW_ROAMING_COLLISION_COOLDOWN_MS;
    this.target = null;
    this.stateTimerMs = 0;
    this.setVelocity(0, 0);

    const deltaX = this.x - otherX;
    if (Math.abs(deltaX) >= BABY_COW_ROAMING_COLLISION_FACE_THRESHOLD) {
      this.setFlipX(deltaX < 0);
    }

    if (this.startCollisionRetreat(otherX)) {
      return;
    }

    this.enterTimedState("idle", BABY_COW_ROAMING_COLLISION_IDLE_MS);
  }

  private updateRun(deltaMs: number): void {
    if (!this.target) {
      this.enterTimedState("idle", randomRange(800, 1400));
      return;
    }

    const deltaSeconds = deltaMs / 1000;
    const deltaX = this.target.x - this.x;
    const deltaY = this.target.y - this.y;
    const distance = Math.hypot(deltaX, deltaY);

    if (distance <= 4) {
      this.enterTimedState("idle", randomRange(900, 1600));
      return;
    }

    const normalizedX = deltaX / distance;
    const normalizedY = deltaY / distance;
    const velocityX = normalizedX * BABY_COW_RUN_SPEED;
    const velocityY = normalizedY * BABY_COW_RUN_SPEED;

    if (!this.canOccupyAt(
      this.x + velocityX * deltaSeconds,
      this.y + velocityY * deltaSeconds,
      velocityX,
      velocityY,
    )) {
      this.handleBlockedRun();
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

  private handleBlockedRun(): void {
    this.target = null;
    this.aiThinkCooldownMs = BABY_COW_AI_THINK_INTERVAL_MS;
    this.enterTimedState("idle", BABY_COW_BLOCKED_IDLE_MS);
  }

  private chooseNextState(): void {
    const roll = Math.random();

    if (roll < 0.28 && this.startRun()) {
      return;
    }

    if (roll < 0.42) {
      this.cueOneShotState("hop");
      return;
    }

    if (roll < 0.58) {
      this.enterTimedState("headBob", randomRange(1200, 2200));
      return;
    }

    if (roll < 0.76) {
      this.cueOneShotState("sit");
      return;
    }

    if (roll < 0.9) {
      this.cueOneShotState("grazeDown");
      return;
    }

    this.enterTimedState("idle", randomRange(1200, 2200));
  }

  private startRun(): boolean {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const offsetColumn = randomRange(-7, 7);
      const offsetRow = randomRange(-7, 7);

      if (offsetColumn === 0 && offsetRow === 0) {
        continue;
      }

      const targetX = this.x + offsetColumn * PIXEL_FARM_TILE_SIZE;
      const targetY = this.y + offsetRow * PIXEL_FARM_TILE_SIZE;
      if (!this.canOccupyAt(targetX, targetY)) {
        continue;
      }

      this.target = new Phaser.Math.Vector2(targetX, targetY);
      this.babyCowState = "run";
      this.stateTimerMs = randomRange(1200, 2400);
      this.playState("run");
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
      this.babyCowState = "run";
      this.stateTimerMs = BABY_COW_ROAMING_COLLISION_RETREAT_MS;
      this.aiThinkCooldownMs = BABY_COW_AI_THINK_INTERVAL_MS;
      this.playState("run");
      return true;
    }

    return false;
  }

  private handleAnimationComplete(): void {
    if (this.debugPoseLocked) {
      return;
    }

    if (this.babyCowState === "hop") {
      this.enterTimedState("idle", randomRange(1000, 1800));
      return;
    }

    if (this.babyCowState === "sit") {
      this.enterTimedState("sitNap", randomRange(1400, 2400));
      return;
    }

    if (this.babyCowState === "grazeDown") {
      this.enterTimedState("grazeChew", randomRange(1400, 2400));
      return;
    }

    if (this.babyCowState === "love") {
      this.enterTimedState("idle", randomRange(900, 1600));
    }
  }

  private cueOneShotState(state: Extract<PixelFarmBabyCowState, "hop" | "sit" | "grazeDown">): void {
    this.babyCowState = state;
    this.target = null;
    this.stateTimerMs = 0;
    this.setVelocity(0, 0);
    this.playState(state, false);
  }

  private enterTimedState(
    state: Extract<PixelFarmBabyCowState, "idle" | "headBob" | "sitNap" | "grazeChew">,
    durationMs: number,
  ): void {
    this.babyCowState = state;
    this.stateTimerMs = durationMs;
    this.target = null;
    this.setVelocity(0, 0);
    this.playState(state, false);
  }

  private canOccupyAt(x: number, y: number, moveX = 0, moveY = 0): boolean {
    const rect = measurePixelFarmBabyCowBodyAt(x, y);

    return this.canOccupy(
      rect.left,
      rect.top,
      rect.right,
      rect.bottom,
      moveX,
      moveY,
    );
  }

  private playState(state: PixelFarmBabyCowState, ignoreIfPlaying = true): void {
    this.anims.play(animationKey(this.color, state), ignoreIfPlaying);
  }
}
