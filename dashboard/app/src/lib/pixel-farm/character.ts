import Phaser from "phaser";
import {
  PIXEL_FARM_CHARACTER_FRAME_HEIGHT,
  PIXEL_FARM_CHARACTER_FRAME_WIDTH,
  PIXEL_FARM_CHARACTER_TEXTURE_KEY,
} from "@/lib/pixel-farm/runtime-assets";
import { pixelFarmDepthForSpriteBody } from "@/lib/pixel-farm/depth";

const CHARACTER_SPRITE_ORIGIN_X = 0.5;
const CHARACTER_SPRITE_ORIGIN_Y = 0.9;
const CHARACTER_BODY_WIDTH = 10;
const CHARACTER_BODY_HEIGHT = 6;
const CHARACTER_BODY_OFFSET_X = 19;
const CHARACTER_BODY_OFFSET_Y = 24;
const CHARACTER_WALK_SPEED = 72;
const CHARACTER_RUN_SPEED = 112;
const CHARACTER_FRAMES_PER_ROW = 8;

const CHARACTER_ACTION_ROWS = {
  idle: 0,
  walk: 4,
  run: 8,
  hoe: 12,
  axe: 16,
  water: 20,
} as const;

const CHARACTER_ANIMATION_FPS = {
  idle: 4,
  walk: 8,
  run: 12,
  hoe: 10,
  axe: 10,
  water: 10,
} as const;

export const PIXEL_FARM_CHARACTER_DIRECTIONS = ["down", "up", "right", "left"] as const;
const CHARACTER_TOOL_ACTIONS = ["hoe", "axe", "water"] as const;

export type PixelFarmCharacterDirection = (typeof PIXEL_FARM_CHARACTER_DIRECTIONS)[number];
export type PixelFarmCharacterToolAction = (typeof CHARACTER_TOOL_ACTIONS)[number];
export type PixelFarmCharacterAction =
  | "idle"
  | "walk"
  | "run"
  | PixelFarmCharacterToolAction;
export const PIXEL_FARM_CHARACTER_ACTION_OPTIONS = Object.keys(
  CHARACTER_ACTION_ROWS,
) as PixelFarmCharacterAction[];

export interface PixelFarmCharacterInput {
  moveX: number;
  moveY: number;
  running: boolean;
  action: PixelFarmCharacterToolAction | null;
}

export interface PixelFarmCharacterConfig {
  scene: Phaser.Scene;
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

export interface PixelFarmBodyRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function animationKey(
  action: PixelFarmCharacterAction,
  direction: PixelFarmCharacterDirection,
): string {
  return `pixel-farm-character-${action}-${direction}`;
}

function directionForVector(
  currentDirection: PixelFarmCharacterDirection,
  moveX: number,
  moveY: number,
): PixelFarmCharacterDirection {
  if (moveX === 0 && moveY === 0) {
    return currentDirection;
  }

  if (Math.abs(moveX) > Math.abs(moveY)) {
    return moveX > 0 ? "right" : "left";
  }

  return moveY > 0 ? "down" : "up";
}

export function registerPixelFarmCharacterAnimations(scene: Phaser.Scene): void {
  for (const [action, baseRow] of Object.entries(CHARACTER_ACTION_ROWS) as Array<
    [PixelFarmCharacterAction, number]
  >) {
    for (const [directionIndex, direction] of PIXEL_FARM_CHARACTER_DIRECTIONS.entries()) {
      const key = animationKey(action, direction);
      if (scene.anims.exists(key)) {
        continue;
      }

      const row = baseRow + directionIndex;
      const start = row * CHARACTER_FRAMES_PER_ROW;

      scene.anims.create({
        key,
        frames: scene.anims.generateFrameNumbers(PIXEL_FARM_CHARACTER_TEXTURE_KEY, {
          start,
          end: start + CHARACTER_FRAMES_PER_ROW - 1,
        }),
        frameRate: CHARACTER_ANIMATION_FPS[action],
        repeat: action === "idle" || action === "walk" || action === "run" ? -1 : 0,
      });
    }
  }
}

export function measurePixelFarmCharacterBodyAt(x: number, y: number): PixelFarmBodyRect {
  const left = x - PIXEL_FARM_CHARACTER_FRAME_WIDTH * CHARACTER_SPRITE_ORIGIN_X + CHARACTER_BODY_OFFSET_X;
  const top = y - PIXEL_FARM_CHARACTER_FRAME_HEIGHT * CHARACTER_SPRITE_ORIGIN_Y + CHARACTER_BODY_OFFSET_Y;

  return {
    left,
    top,
    right: left + CHARACTER_BODY_WIDTH,
    bottom: top + CHARACTER_BODY_HEIGHT,
  };
}

export class PixelFarmCharacter extends Phaser.Physics.Arcade.Sprite {
  private readonly canOccupy: PixelFarmCharacterConfig["canOccupy"];
  private readonly depthBase: number;
  private debugPoseLocked = false;
  private facing: PixelFarmCharacterDirection = "down";
  private locomotionAction: "idle" | "walk" | "run" = "idle";
  private lockedAction: PixelFarmCharacterToolAction | null = null;

  constructor(config: PixelFarmCharacterConfig) {
    super(config.scene, config.startX, config.startY, PIXEL_FARM_CHARACTER_TEXTURE_KEY, 0);

    this.canOccupy = config.canOccupy;
    this.depthBase = config.depth;

    config.scene.add.existing(this);
    config.scene.physics.add.existing(this);

    this.setOrigin(CHARACTER_SPRITE_ORIGIN_X, CHARACTER_SPRITE_ORIGIN_Y);
    const body = this.body as Phaser.Physics.Arcade.Body;

    body.setSize(CHARACTER_BODY_WIDTH, CHARACTER_BODY_HEIGHT);
    body.setOffset(CHARACTER_BODY_OFFSET_X, CHARACTER_BODY_OFFSET_Y);
    body.setAllowGravity(false);
    body.setCollideWorldBounds(false);
    this.setDepth(pixelFarmDepthForSpriteBody(this, this.depthBase));

    this.on(Phaser.Animations.Events.ANIMATION_COMPLETE, this.handleAnimationComplete, this);
    this.playAnimation("idle");
  }

  override destroy(fromScene?: boolean): void {
    this.off(Phaser.Animations.Events.ANIMATION_COMPLETE, this.handleAnimationComplete, this);
    super.destroy(fromScene);
  }

  update(deltaMs: number, input: PixelFarmCharacterInput): void {
    if (this.debugPoseLocked) {
      this.setVelocity(0, 0);
      this.setDepth(pixelFarmDepthForSpriteBody(this, this.depthBase));
      return;
    }

    if (input.action && !this.lockedAction) {
      this.startToolAction(input.action);
      this.setDepth(pixelFarmDepthForSpriteBody(this, this.depthBase));
      return;
    }

    if (this.lockedAction) {
      this.setVelocity(0, 0);
      this.setDepth(pixelFarmDepthForSpriteBody(this, this.depthBase));
      return;
    }

    this.updateLocomotion(deltaMs, input);
    this.setDepth(pixelFarmDepthForSpriteBody(this, this.depthBase));
  }

  getFacingDirection(): PixelFarmCharacterDirection {
    return this.facing;
  }

  private handleAnimationComplete(): void {
    if (this.debugPoseLocked) {
      return;
    }

    if (!this.lockedAction) {
      return;
    }

    this.lockedAction = null;
    this.locomotionAction = "idle";
    this.playAnimation("idle", false);
  }

  applyDebugPose(
    action: PixelFarmCharacterAction,
    direction: PixelFarmCharacterDirection,
    playing: boolean,
  ): void {
    this.debugPoseLocked = true;
    this.facing = direction;
    this.lockedAction = null;
    this.locomotionAction =
      action === "idle" || action === "walk" || action === "run" ? action : "idle";
    this.setVelocity(0, 0);
    this.playAnimation(action, false);

    if (playing) {
      this.anims.resume();
    } else {
      this.anims.pause();
    }
  }

  private updateLocomotion(deltaMs: number, input: PixelFarmCharacterInput): void {
    const { moveX, moveY } = input;
    this.facing = directionForVector(this.facing, moveX, moveY);

    if (moveX === 0 && moveY === 0) {
      this.setVelocity(0, 0);
      this.setLocomotionAction("idle");
      return;
    }

    const magnitude = Math.hypot(moveX, moveY);
    const normalizedX = moveX / magnitude;
    const normalizedY = moveY / magnitude;
    const speed = input.running ? CHARACTER_RUN_SPEED : CHARACTER_WALK_SPEED;
    const deltaSeconds = deltaMs / 1000;
    let velocityX = normalizedX * speed;
    let velocityY = normalizedY * speed;

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

    this.setVelocity(velocityX, velocityY);
    this.setLocomotionAction(input.running ? "run" : "walk");
  }

  private canOccupyAt(x: number, y: number, moveX = 0, moveY = 0): boolean {
    const rect = measurePixelFarmCharacterBodyAt(x, y);

    return this.canOccupy(
      rect.left,
      rect.top,
      rect.right,
      rect.bottom,
      moveX,
      moveY,
    );
  }

  private setLocomotionAction(action: "idle" | "walk" | "run"): void {
    if (this.locomotionAction === action) {
      this.playAnimation(action);
      return;
    }

    this.locomotionAction = action;
    this.playAnimation(action);
  }

  private startToolAction(action: PixelFarmCharacterToolAction): void {
    this.lockedAction = action;
    this.setVelocity(0, 0);
    this.playAnimation(action, false);
  }

  private playAnimation(action: PixelFarmCharacterAction, ignoreIfPlaying = true): void {
    const key = animationKey(action, this.facing);
    this.anims.play(key, ignoreIfPlaying);
  }
}
