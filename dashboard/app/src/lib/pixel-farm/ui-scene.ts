import Phaser from "phaser";
import {
  PIXEL_FARM_MOUSE_CURSOR_TEXTURE_KEY,
  preloadPixelFarmDialogAsset,
} from "@/lib/pixel-farm/runtime-assets";
import { PixelFarmUIDialog, type PixelFarmDialogPayload } from "@/lib/pixel-farm/ui-dialog";

export class PixelFarmUIScene extends Phaser.Scene {
  private dialog: PixelFarmUIDialog | null = null;
  private cursorSprite: Phaser.GameObjects.Image | null = null;
  private pendingPayload: PixelFarmDialogPayload | null = null;
  private pointerOverCanvas = false;

  constructor() {
    super("pixel-farm-ui");
  }

  preload(): void {
    preloadPixelFarmDialogAsset(this);
  }

  create(): void {
    this.cameras.main.setBackgroundColor("rgba(0, 0, 0, 0)");
    this.cameras.main.setRoundPixels(true);
    this.dialog = new PixelFarmUIDialog(this);
    this.cursorSprite = this.add
      .image(0, 0, PIXEL_FARM_MOUSE_CURSOR_TEXTURE_KEY)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setScale(2)
      .setVisible(false)
      .setDepth(2000);
    this.game.canvas.addEventListener("mouseenter", this.handleCanvasMouseEnter);
    this.game.canvas.addEventListener("mouseleave", this.handleCanvasMouseLeave);
    this.syncCanvasHoverState();
    window.requestAnimationFrame(() => {
      if (this.sys.isActive()) {
        this.syncCanvasHoverState();
      }
    });
    this.scene.bringToTop();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);

    if (this.pendingPayload) {
      this.dialog.open(this.pendingPayload);
    } else {
      this.dialog.close();
    }
  }

  update(): void {
    if (!this.cursorSprite) {
      return;
    }

    if (!this.pointerOverCanvas) {
      this.cursorSprite.setVisible(false);
      return;
    }

    const pointer = this.input.activePointer;
    const withinBounds =
      pointer &&
      pointer.x >= 0 &&
      pointer.y >= 0 &&
      pointer.x <= this.scale.width &&
      pointer.y <= this.scale.height;

    if (!withinBounds) {
      this.cursorSprite.setVisible(false);
      return;
    }

    this.cursorSprite
      .setVisible(true)
      .setPosition(Math.round(pointer.x), Math.round(pointer.y));
  }

  openDialog(payload: PixelFarmDialogPayload): void {
    this.pendingPayload = payload;
    this.dialog?.open(payload);
  }

  closeDialog(): void {
    this.pendingPayload = null;
    this.dialog?.close();
  }

  refreshDialogAnchor(anchorScreenX: number, anchorScreenY: number): void {
    if (!this.pendingPayload) {
      return;
    }

    this.pendingPayload = {
      ...this.pendingPayload,
      anchorScreenX,
      anchorScreenY,
    };
    this.dialog?.open(this.pendingPayload);
  }

  private handleResize(): void {
    if (this.pendingPayload) {
      this.dialog?.open(this.pendingPayload);
    }
  }

  private syncCanvasHoverState(): void {
    this.updateCanvasHoverState(this.game.canvas.matches(":hover"));
  }

  private updateCanvasHoverState(isPointerOverCanvas: boolean): void {
    this.pointerOverCanvas = isPointerOverCanvas;
    this.game.canvas.style.cursor = isPointerOverCanvas ? "none" : "";

    if (!isPointerOverCanvas) {
      this.cursorSprite?.setVisible(false);
    }
  }

  private readonly handleCanvasMouseEnter = (): void => {
    this.updateCanvasHoverState(true);
  };

  private readonly handleCanvasMouseLeave = (): void => {
    this.updateCanvasHoverState(false);
  };

  private handleShutdown(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.game.canvas.removeEventListener("mouseenter", this.handleCanvasMouseEnter);
    this.game.canvas.removeEventListener("mouseleave", this.handleCanvasMouseLeave);
    this.game.canvas.style.cursor = "";
    this.cursorSprite?.destroy();
    this.cursorSprite = null;
    this.dialog?.destroy();
    this.dialog = null;
  }
}
