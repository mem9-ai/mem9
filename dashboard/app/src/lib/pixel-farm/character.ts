import Phaser from "phaser";
import { PIXEL_FARM_CHARACTER_TEXTURE_KEY } from "@/lib/pixel-farm/runtime-assets";

const CHARACTER_SPRITE_ORIGIN_X = 0.5;
const CHARACTER_SPRITE_ORIGIN_Y = 0.9;
const CHARACTER_COLLISION_WIDTH = 10;
const CHARACTER_COLLISION_HEIGHT = 6;
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

const CHARACTER_DIRECTIONS = ["down", "up", "right", "left"] as const;
const CHARACTER_TOOL_ACTIONS = ["hoe", "axe", "water"] as const;

export type PixelFarmCharacterDirection = (typeof CHARACTER_DIRECTIONS)[number];
export type PixelFarmCharacterToolAction = (typeof CHARACTER_TOOL_ACTIONS)[number];
export type PixelFarmCharacterAction =
  | "idle"
  | "walk"
  | "run"
  | PixelFarmCharacterToolAction;

export interface PixelFarmCharacterInput {
  moveX: number;
  moveY: number;
  running: boolean;
  action: PixelFarmCharacterToolAction | null;
}

export interface PixelFarmCharacterConfig {
  scene: Phaser.Scene;
  layer?: Phaser.GameObjects.Container;
  startX: number;
  startY: number;
  canOccupy: (left: number, top: number, right: number, bottom: number) => boolean;
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
    for (const [directionIndex, direction] of CHARACTER_DIRECTIONS.entries()) {
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

export class PixelFarmCharacter {
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly canOccupy: PixelFarmCharacterConfig["canOccupy"];
  private facing: PixelFarmCharacterDirection = "down";
  private locomotionAction: "idle" | "walk" | "run" = "idle";
  private lockedAction: PixelFarmCharacterToolAction | null = null;

  constructor(config: PixelFarmCharacterConfig) {
    this.canOccupy = config.canOccupy;
    this.sprite = config.scene.add.sprite(
      config.startX,
      config.startY,
      PIXEL_FARM_CHARACTER_TEXTURE_KEY,
      0,
    );

    this.sprite.setOrigin(CHARACTER_SPRITE_ORIGIN_X, CHARACTER_SPRITE_ORIGIN_Y);
    this.sprite.on(
      Phaser.Animations.Events.ANIMATION_COMPLETE,
      this.handleAnimationComplete,
      this,
    );

    config.layer?.add(this.sprite);

    this.playAnimation("idle");
  }

  destroy(): void {
    this.sprite.off(
      Phaser.Animations.Events.ANIMATION_COMPLETE,
      this.handleAnimationComplete,
      this,
    );
    this.sprite.destroy();
  }

  update(deltaMs: number, input: PixelFarmCharacterInput): void {
    if (input.action && !this.lockedAction) {
      this.startToolAction(input.action);
      return;
    }

    if (this.lockedAction) {
      return;
    }

    this.updateLocomotion(deltaMs, input);
  }

  private handleAnimationComplete(): void {
    if (!this.lockedAction) {
      return;
    }

    this.lockedAction = null;
    this.locomotionAction = "idle";
    this.playAnimation("idle");
  }

  private updateLocomotion(deltaMs: number, input: PixelFarmCharacterInput): void {
    const { moveX, moveY } = input;
    this.facing = directionForVector(this.facing, moveX, moveY);

    if (moveX === 0 && moveY === 0) {
      this.setLocomotionAction("idle");
      return;
    }

    const magnitude = Math.hypot(moveX, moveY);
    const normalizedX = moveX / magnitude;
    const normalizedY = moveY / magnitude;
    const speed = input.running ? CHARACTER_RUN_SPEED : CHARACTER_WALK_SPEED;
    const distance = (speed * deltaMs) / 1000;

    this.moveBy(normalizedX * distance, normalizedY * distance);
    this.setLocomotionAction(input.running ? "run" : "walk");
  }

  private moveBy(deltaX: number, deltaY: number): void {
    const currentX = this.sprite.x;
    const currentY = this.sprite.y;
    let nextX = currentX;
    let nextY = currentY;

    if (deltaX !== 0 && this.canOccupyAt(currentX + deltaX, currentY)) {
      nextX = currentX + deltaX;
    }

    if (deltaY !== 0 && this.canOccupyAt(nextX, currentY + deltaY)) {
      nextY = currentY + deltaY;
    }

    if (nextX === currentX && nextY === currentY) {
      return;
    }

    this.sprite.setPosition(nextX, nextY);
  }

  private canOccupyAt(x: number, y: number): boolean {
    const halfWidth = CHARACTER_COLLISION_WIDTH * 0.5;

    return this.canOccupy(
      x - halfWidth,
      y - CHARACTER_COLLISION_HEIGHT,
      x + halfWidth,
      y - 1,
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
    this.playAnimation(action, false);
  }

  private playAnimation(action: PixelFarmCharacterAction, ignoreIfPlaying = true): void {
    const key = animationKey(action, this.facing);
    this.sprite.play(key, ignoreIfPlaying);
  }
}
