import Phaser from "phaser";
import { preloadPixelFarmDialogAsset } from "@/lib/pixel-farm/runtime-assets";
import { PixelFarmUIDialog, type PixelFarmDialogPayload } from "@/lib/pixel-farm/ui-dialog";

export class PixelFarmUIScene extends Phaser.Scene {
  private dialog: PixelFarmUIDialog | null = null;
  private pendingPayload: PixelFarmDialogPayload | null = null;

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
    this.scene.bringToTop();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);

    if (this.pendingPayload) {
      this.dialog.open(this.pendingPayload);
    } else {
      this.dialog.close();
    }
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

  private handleShutdown(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.dialog?.destroy();
    this.dialog = null;
  }
}
