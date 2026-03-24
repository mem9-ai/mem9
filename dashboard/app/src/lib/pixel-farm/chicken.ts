import Phaser from "phaser";
import { PIXEL_FARM_CHICKEN_TEXTURE_KEYS } from "@/lib/pixel-farm/runtime-assets";
import { pixelFarmDepthForSpriteBody } from "@/lib/pixel-farm/depth";
import { PIXEL_FARM_TILE_SIZE } from "@/lib/pixel-farm/tileset-config";

const CHICKEN_BODY_WIDTH = 8;
const CHICKEN_BODY_HEIGHT = 5;
const CHICKEN_WALK_SPEED = 36;
const CHICKEN_LOVE_COOLDOWN_MS = 2200;
const CHICKEN_TOP_FRAME_WIDTH = 16;
const CHICKEN_TOP_FRAME_HEIGHT = 16;
const CHICKEN_BOTTOM_FRAME_WIDTH = 32;
const CHICKEN_BOTTOM_FRAME_HEIGHT = 32;
const CHICKEN_BOTTOM_LOVE_FRAME_WIDTH = 16;
const CHICKEN_TOP_FRAMES_PER_ROW = 8;
const CHICKEN_TOP_ROW_COUNT = 13;
const CHICKEN_TOP_FRAME_COUNT = CHICKEN_TOP_ROW_COUNT * CHICKEN_TOP_FRAMES_PER_ROW;
const CHICKEN_BOTTOM_FRAME_START_Y = CHICKEN_TOP_ROW_COUNT * CHICKEN_TOP_FRAME_HEIGHT;
const CHICKEN_BODY_BOTTOM_MARGIN = 1;
const CHICKEN_HOVER_FRAME_COUNT = 6;
const CHICKEN_FLY_FRAME_COUNT = 5;
const CHICKEN_HOP_FRAME_COUNT = 4;
const CHICKEN_LOVE_FRAME_COUNT = 7;
const CHICKEN_HOVER_FRAME_START = CHICKEN_TOP_FRAME_COUNT;
const CHICKEN_FLY_FRAME_START = CHICKEN_HOVER_FRAME_START + CHICKEN_HOVER_FRAME_COUNT;
const CHICKEN_HOP_FRAME_START = CHICKEN_FLY_FRAME_START + CHICKEN_FLY_FRAME_COUNT;
const CHICKEN_LOVE_FRAME_START = CHICKEN_HOP_FRAME_START + CHICKEN_HOP_FRAME_COUNT;
const CHICKEN_STANDARD_ANCHOR_X = CHICKEN_TOP_FRAME_WIDTH * 0.5;
const CHICKEN_WIDE_FRAME_ANCHOR_X = CHICKEN_BOTTOM_FRAME_WIDTH - CHICKEN_STANDARD_ANCHOR_X;

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

function rangeFrames(start: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => start + index);
}

function chickenFrameName(index: number): string {
  return `frame-${index}`;
}

function chickenAnchorX(frameWidth: number): number {
  return frameWidth === CHICKEN_BOTTOM_FRAME_WIDTH
    ? CHICKEN_WIDE_FRAME_ANCHOR_X
    : CHICKEN_STANDARD_ANCHOR_X;
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
  hover: { frames: rangeFrames(CHICKEN_HOVER_FRAME_START, CHICKEN_HOVER_FRAME_COUNT), fps: 10, repeat: 0 },
  fly: { frames: rangeFrames(CHICKEN_FLY_FRAME_START, CHICKEN_FLY_FRAME_COUNT), fps: 10, repeat: -1 },
  hop: { frames: rangeFrames(CHICKEN_HOP_FRAME_START, CHICKEN_HOP_FRAME_COUNT), fps: 10, repeat: 0 },
  love: { frames: rangeFrames(CHICKEN_LOVE_FRAME_START, CHICKEN_LOVE_FRAME_COUNT), fps: 8, repeat: 0 },
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

  let bottomFrameIndex = CHICKEN_HOVER_FRAME_START;
  const bottomAnimationRows = [
    { row: 0, count: 4 },
    { row: 1, count: 2 },
    { row: 2, count: 4 },
    { row: 3, count: 1 },
    { row: 4, count: 4 },
  ] as const;

  for (const { row, count } of bottomAnimationRows) {
    for (let column = 0; column < count; column += 1) {
      addChickenFrame(
        texture,
        bottomFrameIndex,
        column * CHICKEN_BOTTOM_FRAME_WIDTH,
        CHICKEN_BOTTOM_FRAME_START_Y + row * CHICKEN_BOTTOM_FRAME_HEIGHT,
        CHICKEN_BOTTOM_FRAME_WIDTH,
        CHICKEN_BOTTOM_FRAME_HEIGHT,
      );
      bottomFrameIndex += 1;
    }
  }

  for (let column = 0; column < CHICKEN_LOVE_FRAME_COUNT; column += 1) {
    addChickenFrame(
      texture,
      CHICKEN_LOVE_FRAME_START + column,
      column * CHICKEN_BOTTOM_LOVE_FRAME_WIDTH,
      CHICKEN_BOTTOM_FRAME_START_Y + 6 * CHICKEN_BOTTOM_FRAME_HEIGHT,
      CHICKEN_BOTTOM_LOVE_FRAME_WIDTH,
      CHICKEN_BOTTOM_FRAME_HEIGHT,
    );
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

export class PixelFarmChicken extends Phaser.Physics.Arcade.Sprite {
  private readonly canOccupy: PixelFarmChickenConfig["canOccupy"];
  private readonly color: PixelFarmChickenColor;
  private readonly depthBase: number;
  private chickenState: PixelFarmChickenState = "idle";
  private debugPoseLocked = false;
  private stateTimerMs = 0;
  private loveCooldownMs = 0;
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

    this.loveCooldownMs = Math.max(0, this.loveCooldownMs - deltaMs);

    if (this.chickenState === "walk") {
      this.updateWalk(deltaMs);
      this.setDepth(pixelFarmDepthForSpriteBody(this, this.depthBase));
      return;
    }

    this.setVelocity(0, 0);

    if (
      this.chickenState === "sitDown" ||
      this.chickenState === "standUp" ||
      this.chickenState === "hover" ||
      this.chickenState === "hop" ||
      this.chickenState === "love"
    ) {
      this.setDepth(pixelFarmDepthForSpriteBody(this, this.depthBase));
      return;
    }

    this.stateTimerMs -= deltaMs;
    if (this.stateTimerMs <= 0) {
      this.chooseNextState();
    }

    this.setDepth(pixelFarmDepthForSpriteBody(this, this.depthBase));
  }

  triggerLove(sourceX: number): void {
    if (this.loveCooldownMs > 0 || this.chickenState === "love") {
      return;
    }

    this.setFlipX(sourceX < this.x);
    this.loveCooldownMs = CHICKEN_LOVE_COOLDOWN_MS;
    this.target = null;
    this.stateTimerMs = 0;
    this.chickenState = "love";
    this.setVelocity(0, 0);
    this.playState("love", false);
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
    let velocityX = normalizedX * CHICKEN_WALK_SPEED;
    let velocityY = normalizedY * CHICKEN_WALK_SPEED;

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
      this.enterTimedState("idle", randomRange(900, 1600));
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

    if (roll < 0.97) {
      this.chickenState = "hover";
      this.target = null;
      this.playState("hover", false);
      return;
    }

    this.enterTimedState("idle", randomRange(1000, 2000));
  }

  private startWalk(): boolean {
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
      return;
    }

    if (this.chickenState === "hover") {
      this.chickenState = "hop";
      this.playState("hop", false);
      return;
    }

    if (this.chickenState === "hop" || this.chickenState === "love") {
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
    const frameWidth = this.frame.realWidth;
    const frameHeight = this.frame.realHeight;
    const anchorX = chickenAnchorX(frameWidth);
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

    const frameWidth = this.frame.realWidth;
    const frameHeight = this.frame.realHeight;
    const anchorX = chickenAnchorX(frameWidth);
    const bodyOffsetX = Math.round(anchorX - CHICKEN_BODY_WIDTH * 0.5);
    const bodyOffsetY = frameHeight - CHICKEN_BODY_HEIGHT - CHICKEN_BODY_BOTTOM_MARGIN;

    this.setDisplayOrigin(anchorX, frameHeight);
    body.setSize(CHICKEN_BODY_WIDTH, CHICKEN_BODY_HEIGHT);
    body.setOffset(bodyOffsetX, bodyOffsetY);
  }

  private playState(state: PixelFarmChickenState, ignoreIfPlaying = true): void {
    this.anims.play(animationKey(this.color, state), ignoreIfPlaying);
  }
}
