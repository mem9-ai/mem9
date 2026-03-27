import type Phaser from "phaser";

export function pixelFarmDepthForY(baseDepth: number, y: number): number {
  return baseDepth + y / 10_000;
}

export function pixelFarmDepthForSpriteBody(
  sprite: Phaser.Physics.Arcade.Sprite,
  baseDepth: number,
): number {
  const body = sprite.body as Phaser.Physics.Arcade.Body | undefined;
  const sortY = body ? body.y + body.height : sprite.y;

  return pixelFarmDepthForY(baseDepth, sortY);
}
