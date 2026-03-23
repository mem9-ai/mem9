import Phaser from "phaser";
import {
  PIXEL_FARM_COW_FRAME_HEIGHT,
  PIXEL_FARM_COW_FRAME_WIDTH,
  PIXEL_FARM_COW_TEXTURE_KEYS,
} from "@/lib/pixel-farm/runtime-assets";
import { PIXEL_FARM_TILE_SIZE } from "@/lib/pixel-farm/tileset-config";

const COW_SPRITE_ORIGIN_X = 0.5;
const COW_SPRITE_ORIGIN_Y = 0.8;
const COW_BODY_WIDTH = 18;
const COW_BODY_HEIGHT = 10;
const COW_BODY_OFFSET_X = 7;
const COW_BODY_OFFSET_Y = 18;
const COW_WALK_SPEED = 28;
const COW_LOVE_COOLDOWN_MS = 2600;

export const PIXEL_FARM_COW_COLORS = [
  "brown",
  "green",
  "light",
  "pink",
  "purple",
] as const;

const COW_STATES = {
  idle: { row: 0, frames: 3, fps: 4, repeat: -1 },
  walk: { row: 1, frames: 8, fps: 8, repeat: -1 },
  sitTransition: { row: 2, frames: 7, fps: 8, repeat: 0 },
  sitTail: { row: 3, frames: 3, fps: 4, repeat: -1 },
  sitHead: { row: 4, frames: 4, fps: 5, repeat: -1 },
  grazeDown: { row: 5, frames: 7, fps: 8, repeat: 0 },
  grazeChew: { row: 6, frames: 4, fps: 4, repeat: -1 },
  love: { row: 7, frames: 6, fps: 7, repeat: 0 },
} as const;

export type PixelFarmCowColor = (typeof PIXEL_FARM_COW_COLORS)[number];
export type PixelFarmCowState = keyof typeof COW_STATES;
export const PIXEL_FARM_COW_STATE_OPTIONS = Object.keys(COW_STATES) as PixelFarmCowState[];

export interface PixelFarmCowConfig {
  scene: Phaser.Scene;
  color: PixelFarmCowColor;
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

function actorDepth(baseDepth: number, y: number): number {
  return baseDepth + y / 10_000;
}

function animationKey(color: PixelFarmCowColor, state: PixelFarmCowState): string {
  return `pixel-farm-cow-${color}-${state}`;
}

function cowTextureKey(color: PixelFarmCowColor): string {
  return PIXEL_FARM_COW_TEXTURE_KEYS[color];
}

function randomRange(min: number, max: number): number {
  return Phaser.Math.Between(min, max);
}

export function registerPixelFarmCowAnimations(scene: Phaser.Scene): void {
  for (const color of PIXEL_FARM_COW_COLORS) {
    for (const [state, config] of Object.entries(COW_STATES) as Array<
      [PixelFarmCowState, (typeof COW_STATES)[PixelFarmCowState]]
    >) {
      const key = animationKey(color, state);
      if (scene.anims.exists(key)) {
        continue;
      }

      const start = config.row * 8;
      scene.anims.create({
        key,
        frames: scene.anims.generateFrameNumbers(cowTextureKey(color), {
          start,
          end: start + config.frames - 1,
        }),
        frameRate: config.fps,
        repeat: config.repeat,
      });
    }
  }
}

export class PixelFarmCow extends Phaser.Physics.Arcade.Sprite {
  private readonly canOccupy: PixelFarmCowConfig["canOccupy"];
  private readonly color: PixelFarmCowColor;
  private readonly depthBase: number;
  private cowState: PixelFarmCowState = "idle";
  private debugPoseLocked = false;
  private stateTimerMs = 0;
  private loveCooldownMs = 0;
  private target: Phaser.Math.Vector2 | null = null;

  constructor(config: PixelFarmCowConfig) {
    super(config.scene, config.startX, config.startY, cowTextureKey(config.color), 0);

    this.canOccupy = config.canOccupy;
    this.color = config.color;
    this.depthBase = config.depth;

    config.scene.add.existing(this);
    config.scene.physics.add.existing(this);

    this.setOrigin(COW_SPRITE_ORIGIN_X, COW_SPRITE_ORIGIN_Y);
    this.setDepth(actorDepth(this.depthBase, this.y));
    const body = this.body as Phaser.Physics.Arcade.Body;

    body.setSize(COW_BODY_WIDTH, COW_BODY_HEIGHT);
    body.setOffset(COW_BODY_OFFSET_X, COW_BODY_OFFSET_Y);
    body.setAllowGravity(false);
    body.setCollideWorldBounds(false);
    this.setDrag(800, 800);

    this.on(Phaser.Animations.Events.ANIMATION_COMPLETE, this.handleAnimationComplete, this);
    this.enterTimedState("idle", randomRange(1400, 2600));
  }

  override destroy(fromScene?: boolean): void {
    this.off(Phaser.Animations.Events.ANIMATION_COMPLETE, this.handleAnimationComplete, this);
    super.destroy(fromScene);
  }

  update(deltaMs: number): void {
    if (this.debugPoseLocked) {
      this.setVelocity(0, 0);
      this.setDepth(actorDepth(this.depthBase, this.y));
      return;
    }

    this.loveCooldownMs = Math.max(0, this.loveCooldownMs - deltaMs);

    if (this.cowState === "walk") {
      this.updateWalk(deltaMs);
      this.setDepth(actorDepth(this.depthBase, this.y));
      return;
    }

    this.setVelocity(0, 0);

    if (this.cowState === "sitTransition" || this.cowState === "grazeDown" || this.cowState === "love") {
      this.setDepth(actorDepth(this.depthBase, this.y));
      return;
    }

    this.stateTimerMs -= deltaMs;
    if (this.stateTimerMs <= 0) {
      this.chooseNextState();
    }

    this.setDepth(actorDepth(this.depthBase, this.y));
  }

  triggerLove(sourceX: number): void {
    if (this.loveCooldownMs > 0 || this.cowState === "love") {
      return;
    }

    this.setFlipX(sourceX < this.x);
    this.loveCooldownMs = COW_LOVE_COOLDOWN_MS;
    this.target = null;
    this.stateTimerMs = 0;
    this.cowState = "love";
    this.setVelocity(0, 0);
    this.playState("love", false);
  }

  applyDebugPose(state: PixelFarmCowState, flipX: boolean, playing: boolean): void {
    this.debugPoseLocked = true;
    this.cowState = state;
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

  private updateWalk(deltaMs: number): void {
    if (!this.target) {
      this.enterTimedState("idle", randomRange(900, 1800));
      return;
    }

    const deltaSeconds = deltaMs / 1000;
    const deltaX = this.target.x - this.x;
    const deltaY = this.target.y - this.y;
    const distance = Math.hypot(deltaX, deltaY);

    if (distance <= 4) {
      this.enterTimedState("idle", randomRange(1200, 2400));
      return;
    }

    const normalizedX = deltaX / distance;
    const normalizedY = deltaY / distance;
    let velocityX = normalizedX * COW_WALK_SPEED;
    let velocityY = normalizedY * COW_WALK_SPEED;

    if (!this.canOccupyAt(this.x + velocityX * deltaSeconds, this.y, velocityX, 0)) {
      velocityX = 0;
    }

    if (!this.canOccupyAt(
      this.x + velocityX * deltaSeconds,
      this.y + velocityY * deltaSeconds,
      velocityX,
      velocityY,
    )) {
      velocityY = 0;
    }

    if (velocityX === 0 && velocityY === 0) {
      this.enterTimedState("idle", randomRange(1000, 1800));
      return;
    }

    if (Math.abs(velocityX) > 0.5) {
      this.setFlipX(velocityX < 0);
    }

    this.setVelocity(velocityX, velocityY);
    this.stateTimerMs -= deltaMs;
    if (this.stateTimerMs <= 0) {
      this.enterTimedState("idle", randomRange(1000, 1800));
    }
  }

  private chooseNextState(): void {
    const roll = Math.random();

    if (roll < 0.34 && this.startWalk()) {
      return;
    }

    if (roll < 0.56) {
      this.cowState = "sitTransition";
      this.target = null;
      this.playState("sitTransition", false);
      return;
    }

    if (roll < 0.82) {
      this.cowState = "grazeDown";
      this.target = null;
      this.playState("grazeDown", false);
      return;
    }

    this.enterTimedState("idle", randomRange(1200, 2200));
  }

  private startWalk(): boolean {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const offsetColumn = randomRange(-4, 4);
      const offsetRow = randomRange(-4, 4);

      if (offsetColumn === 0 && offsetRow === 0) {
        continue;
      }

      const targetX = this.x + offsetColumn * PIXEL_FARM_TILE_SIZE;
      const targetY = this.y + offsetRow * PIXEL_FARM_TILE_SIZE;
      if (!this.canOccupyAt(targetX, targetY)) {
        continue;
      }

      this.target = new Phaser.Math.Vector2(targetX, targetY);
      this.cowState = "walk";
      this.stateTimerMs = randomRange(1800, 4200);
      this.playState("walk");
      return true;
    }

    return false;
  }

  private handleAnimationComplete(): void {
    if (this.debugPoseLocked) {
      return;
    }

    if (this.cowState === "sitTransition") {
      this.enterTimedState(Math.random() < 0.5 ? "sitTail" : "sitHead", randomRange(1600, 2800));
      return;
    }

    if (this.cowState === "grazeDown") {
      this.enterTimedState("grazeChew", randomRange(1500, 2600));
      return;
    }

    if (this.cowState === "love") {
      this.enterTimedState("idle", randomRange(1000, 1800));
    }
  }

  private enterTimedState(state: Extract<PixelFarmCowState, "idle" | "sitTail" | "sitHead" | "grazeChew">, durationMs: number): void {
    this.cowState = state;
    this.stateTimerMs = durationMs;
    this.target = null;
    this.setVelocity(0, 0);
    this.playState(state, false);
  }

  private canOccupyAt(x: number, y: number, moveX = 0, moveY = 0): boolean {
    const left = x - PIXEL_FARM_COW_FRAME_WIDTH * COW_SPRITE_ORIGIN_X + COW_BODY_OFFSET_X;
    const top = y - PIXEL_FARM_COW_FRAME_HEIGHT * COW_SPRITE_ORIGIN_Y + COW_BODY_OFFSET_Y;

    return this.canOccupy(left, top, left + COW_BODY_WIDTH, top + COW_BODY_HEIGHT, moveX, moveY);
  }

  private playState(state: PixelFarmCowState, ignoreIfPlaying = true): void {
    this.anims.play(animationKey(this.color, state), ignoreIfPlaying);
  }
}
