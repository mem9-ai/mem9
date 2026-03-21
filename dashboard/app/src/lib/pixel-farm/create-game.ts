import Phaser from "phaser";

const GRID_SIZE = 48;
const FRAME_MARGIN = 28;
const BACKGROUND_COLOR = 0x0d141b;
const GRID_COLOR = 0x1b3448;
const FRAME_COLOR = 0x8fd8ff;
const ANCHOR_COLOR = 0xf6dca6;

class PixelFarmSandboxScene extends Phaser.Scene {
  private stage?: Phaser.GameObjects.Graphics;

  constructor() {
    super("pixel-farm-sandbox");
  }

  create(): void {
    this.stage = this.add.graphics();
    this.cameras.main.setBackgroundColor(BACKGROUND_COLOR);

    this.redraw();

    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);
  }

  private handleResize(): void {
    this.redraw();
  }

  private handleShutdown(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
  }

  private redraw(): void {
    if (!this.stage) {
      return;
    }

    const width = this.scale.width;
    const height = this.scale.height;
    const innerWidth = Math.max(width - FRAME_MARGIN * 2, 0);
    const innerHeight = Math.max(height - FRAME_MARGIN * 2, 0);

    this.stage.clear();
    this.stage.fillStyle(BACKGROUND_COLOR, 1);
    this.stage.fillRect(0, 0, width, height);

    this.stage.fillStyle(0x101c26, 1);
    this.stage.fillRect(FRAME_MARGIN, FRAME_MARGIN, innerWidth, innerHeight);

    this.stage.lineStyle(1, GRID_COLOR, 0.55);
    for (let x = FRAME_MARGIN; x <= width - FRAME_MARGIN; x += GRID_SIZE) {
      this.stage.lineBetween(x, FRAME_MARGIN, x, height - FRAME_MARGIN);
    }

    for (let y = FRAME_MARGIN; y <= height - FRAME_MARGIN; y += GRID_SIZE) {
      this.stage.lineBetween(FRAME_MARGIN, y, width - FRAME_MARGIN, y);
    }

    this.stage.lineStyle(3, FRAME_COLOR, 0.8);
    this.stage.strokeRect(FRAME_MARGIN, FRAME_MARGIN, innerWidth, innerHeight);

    this.stage.fillStyle(ANCHOR_COLOR, 1);
    this.stage.fillCircle(width / 2, height / 2, 4);
    this.stage.fillCircle(FRAME_MARGIN, FRAME_MARGIN, 3);
    this.stage.fillCircle(width - FRAME_MARGIN, FRAME_MARGIN, 3);
    this.stage.fillCircle(FRAME_MARGIN, height - FRAME_MARGIN, 3);
    this.stage.fillCircle(width - FRAME_MARGIN, height - FRAME_MARGIN, 3);
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
