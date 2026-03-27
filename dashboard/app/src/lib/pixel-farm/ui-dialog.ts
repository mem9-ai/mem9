import Phaser from "phaser";
import { PIXEL_FARM_DIALOG_TEXTURE_KEY } from "@/lib/pixel-farm/runtime-assets";
import {
  computePixelFarmDialogPlacement,
  type PixelFarmDialogPlacement,
} from "@/lib/pixel-farm/ui-dialog-layout";
import {
  paginatePixelFarmDialogText,
} from "@/lib/pixel-farm/ui-dialog-pagination";
import type { Memory } from "@/types/memory";

const DIALOG_TILE_SIZE = 16;
const DIALOG_WIDTH = 420;
const DIALOG_MIN_HEIGHT = 160;
const DIALOG_MAX_HEIGHT = 240;
const DIALOG_MARGIN_X = 12;
const DIALOG_MARGIN_TOP = 12;
const DIALOG_MARGIN_BOTTOM = 24;
const DIALOG_OFFSET_ABOVE_ANCHOR = 14;
const DIALOG_PADDING_X = 24;
const DIALOG_PADDING_TOP = 24;
const DIALOG_PADDING_BOTTOM = 24;
const DIALOG_TEXT_WIDTH = DIALOG_WIDTH - DIALOG_PADDING_X * 2;
const DIALOG_MAX_TEXT_LINES = 5;
const DIALOG_HEADER_HEIGHT = 18;
const DIALOG_LINE_HEIGHT = 18;
const TYPING_DELAY_MS = 14;

export interface PixelFarmDialogPayload {
  targetId: string;
  interactionNonce: number;
  tagLabel: string;
  memories: Memory[];
  memoryIndex: number;
  anchorWorldX: number;
  anchorWorldY: number;
  anchorScreenX: number;
  anchorScreenY: number;
}

interface PixelFarmDialogRuntimeState {
  payload: PixelFarmDialogPayload | null;
  pages: string[];
  pageIndex: number;
  characterIndex: number;
  typingTimer: Phaser.Time.TimerEvent | null;
  placement: PixelFarmDialogPlacement | null;
}

interface PixelFarmDialogSpriteSet {
  topLeft: Phaser.GameObjects.Image;
  top: Phaser.GameObjects.TileSprite;
  topRight: Phaser.GameObjects.Image;
  left: Phaser.GameObjects.TileSprite;
  center: Phaser.GameObjects.TileSprite;
  right: Phaser.GameObjects.TileSprite;
  bottomLeft: Phaser.GameObjects.Image;
  bottom: Phaser.GameObjects.TileSprite;
  bottomRight: Phaser.GameObjects.Image;
}

interface PixelFarmDialogKeyBinding {
  event: string;
  handler: () => void;
}

function ensureDialogTexture(scene: Phaser.Scene): void {
  const texture = scene.textures.get(PIXEL_FARM_DIALOG_TEXTURE_KEY);
  if (texture.has("dialog-center")) {
    return;
  }

  const addFrame = (name: string, x: number, y: number, width: number, height: number) => {
    texture.add(name, 0, x, y, width, height);
  };

  addFrame("dialog-top-left", 0, 0, DIALOG_TILE_SIZE, DIALOG_TILE_SIZE);
  addFrame(
    "dialog-top",
    DIALOG_TILE_SIZE,
    0,
    DIALOG_TILE_SIZE,
    DIALOG_TILE_SIZE,
  );
  addFrame(
    "dialog-top-right",
    DIALOG_TILE_SIZE * 2,
    0,
    DIALOG_TILE_SIZE,
    DIALOG_TILE_SIZE,
  );
  addFrame(
    "dialog-left",
    0,
    DIALOG_TILE_SIZE,
    DIALOG_TILE_SIZE,
    DIALOG_TILE_SIZE,
  );
  addFrame(
    "dialog-center",
    DIALOG_TILE_SIZE,
    DIALOG_TILE_SIZE,
    DIALOG_TILE_SIZE,
    DIALOG_TILE_SIZE,
  );
  addFrame(
    "dialog-right",
    DIALOG_TILE_SIZE * 2,
    DIALOG_TILE_SIZE,
    DIALOG_TILE_SIZE,
    DIALOG_TILE_SIZE,
  );
  addFrame(
    "dialog-bottom-left",
    0,
    DIALOG_TILE_SIZE * 2,
    DIALOG_TILE_SIZE,
    DIALOG_TILE_SIZE,
  );
  addFrame(
    "dialog-bottom",
    DIALOG_TILE_SIZE,
    DIALOG_TILE_SIZE * 2,
    DIALOG_TILE_SIZE,
    DIALOG_TILE_SIZE,
  );
  addFrame(
    "dialog-bottom-right",
    DIALOG_TILE_SIZE * 2,
    DIALOG_TILE_SIZE * 2,
    DIALOG_TILE_SIZE,
    DIALOG_TILE_SIZE,
  );
}

function createDialogImage(scene: Phaser.Scene, frame: string): Phaser.GameObjects.Image {
  return scene.add
    .image(0, 0, PIXEL_FARM_DIALOG_TEXTURE_KEY, frame)
    .setOrigin(0, 0)
    .setScrollFactor(0);
}

function createDialogTileSprite(
  scene: Phaser.Scene,
  frame: string,
): Phaser.GameObjects.TileSprite {
  return scene.add
    .tileSprite(0, 0, DIALOG_TILE_SIZE, DIALOG_TILE_SIZE, PIXEL_FARM_DIALOG_TEXTURE_KEY, frame)
    .setOrigin(0, 0)
    .setScrollFactor(0);
}

function createSpriteSet(scene: Phaser.Scene): PixelFarmDialogSpriteSet {
  return {
    topLeft: createDialogImage(scene, "dialog-top-left"),
    top: createDialogTileSprite(scene, "dialog-top"),
    topRight: createDialogImage(scene, "dialog-top-right"),
    left: createDialogTileSprite(scene, "dialog-right").setFlipX(true),
    center: createDialogTileSprite(scene, "dialog-center"),
    right: createDialogTileSprite(scene, "dialog-right"),
    bottomLeft: createDialogImage(scene, "dialog-bottom-left"),
    bottom: createDialogTileSprite(scene, "dialog-bottom"),
    bottomRight: createDialogImage(scene, "dialog-bottom-right"),
  };
}

function destroySprites(sprites: PixelFarmDialogSpriteSet | null): void {
  if (!sprites) {
    return;
  }

  for (const sprite of Object.values(sprites)) {
    sprite.destroy();
  }
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function hasMorePages(pageIndex: number, pages: readonly string[]): boolean {
  return pageIndex < pages.length - 1;
}

export class PixelFarmUIDialog {
  private readonly root: Phaser.GameObjects.Container;
  private readonly sprites: PixelFarmDialogSpriteSet;
  private readonly headerText: Phaser.GameObjects.Text;
  private readonly contentText: Phaser.GameObjects.Text;
  private readonly counterText: Phaser.GameObjects.Text;
  private readonly measureText: Phaser.GameObjects.Text;
  private readonly bodyHitArea: Phaser.GameObjects.Zone;
  private readonly leftButton: Phaser.GameObjects.Text;
  private readonly rightButton: Phaser.GameObjects.Text;
  private readonly keyBindings: PixelFarmDialogKeyBinding[] = [
    { event: "keydown-SPACE", handler: () => this.advancePrimary() },
    { event: "keydown-ENTER", handler: () => this.advancePrimary() },
    { event: "keydown-LEFT", handler: () => this.goPrevious() },
    { event: "keydown-RIGHT", handler: () => this.goNext() },
  ];
  private readonly state: PixelFarmDialogRuntimeState = {
    payload: null,
    pages: [],
    pageIndex: 0,
    characterIndex: 0,
    typingTimer: null,
    placement: null,
  };

  constructor(private readonly scene: Phaser.Scene) {
    ensureDialogTexture(scene);

    this.root = scene.add.container(0, 0).setVisible(false).setScrollFactor(0);
    this.sprites = createSpriteSet(scene);
    this.headerText = scene.add.text(0, 0, "", this.createHeaderStyle());
    this.contentText = scene.add.text(0, 0, "", this.createContentStyle());
    this.counterText = scene.add.text(0, 0, "", this.createCounterStyle());
    this.measureText = scene.add
      .text(-10_000, -10_000, "", this.createContentStyle())
      .setVisible(false)
      .setScrollFactor(0);
    this.bodyHitArea = scene.add.zone(0, 0, DIALOG_WIDTH, DIALOG_MIN_HEIGHT).setOrigin(0, 0);
    this.leftButton = scene.add.text(0, 0, "‹", this.createButtonStyle()).setInteractive({ useHandCursor: true });
    this.rightButton = scene.add.text(0, 0, "›", this.createButtonStyle()).setInteractive({ useHandCursor: true });

    this.bodyHitArea.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, DIALOG_WIDTH, DIALOG_MIN_HEIGHT),
      Phaser.Geom.Rectangle.Contains,
    );

    this.leftButton.on("pointerup", () => {
      this.goPreviousMemory();
    });
    this.rightButton.on("pointerup", () => {
      this.goNextMemory();
    });
    this.bodyHitArea.on("pointerup", () => {
      this.advancePrimary();
    });

    this.root.add([
      this.sprites.topLeft,
      this.sprites.top,
      this.sprites.topRight,
      this.sprites.left,
      this.sprites.center,
      this.sprites.right,
      this.sprites.bottomLeft,
      this.sprites.bottom,
      this.sprites.bottomRight,
      this.bodyHitArea,
      this.headerText,
      this.contentText,
      this.counterText,
      this.leftButton,
      this.rightButton,
    ]);

    this.root.setDepth(1000);
    this.layoutBody(DIALOG_WIDTH, DIALOG_MIN_HEIGHT);
    this.bindKeyboard();
  }

  destroy(): void {
    this.stopTyping();
    this.unbindKeyboard();
    destroySprites(this.sprites);
    this.headerText.destroy();
    this.contentText.destroy();
    this.counterText.destroy();
    this.measureText.destroy();
    this.bodyHitArea.destroy();
    this.leftButton.destroy();
    this.rightButton.destroy();
    this.root.destroy(true);
  }

  open(payload: PixelFarmDialogPayload): void {
    const currentMemory = payload.memories[payload.memoryIndex] ?? null;
    if (!currentMemory) {
      this.close();
      return;
    }

    const currentPayload = this.state.payload;
    const sameDialog =
      currentPayload?.targetId === payload.targetId &&
      currentPayload.interactionNonce === payload.interactionNonce;

    if (sameDialog) {
      const nextMemoryIndex = Math.max(
        0,
        Math.min(currentPayload.memoryIndex, payload.memories.length - 1),
      );
      const currentMemory = currentPayload.memories[currentPayload.memoryIndex] ?? null;
      const nextMemory = payload.memories[nextMemoryIndex] ?? null;
      this.state.payload = {
        ...payload,
        memoryIndex: nextMemoryIndex,
      };
      if (!nextMemory) {
        this.close();
        return;
      }

      if (currentMemory?.id !== nextMemory.id || currentMemory?.content !== nextMemory.content) {
        this.state.pages = this.buildPages(nextMemory.content);
        this.state.pageIndex = 0;
        this.state.characterIndex = 0;
        this.updateTextMeta();
        this.renderPage();
        this.startTyping();
      }

      this.state.placement = this.computePlacement(this.state.payload);
      this.applyPlacement();
      return;
    }

    this.state.payload = payload;
    this.state.pages = this.buildPages(currentMemory.content);
    this.state.pageIndex = 0;
    this.state.characterIndex = 0;
    this.state.placement = this.computePlacement(payload);
    this.updateTextMeta();
    this.renderPage();
    this.applyPlacement();
    this.root.setVisible(true);
    this.startTyping();
  }

  close(): void {
    this.stopTyping();
    this.state.payload = null;
    this.state.pages = [];
    this.state.pageIndex = 0;
    this.state.characterIndex = 0;
    this.state.placement = null;
    this.contentText.setText("");
    this.root.setVisible(false);
  }

  refreshAnchor(anchorScreenX: number, anchorScreenY: number): void {
    if (!this.state.payload) {
      return;
    }

    this.state.payload = {
      ...this.state.payload,
      anchorScreenX,
      anchorScreenY,
    };
    this.state.placement = this.computePlacement(this.state.payload);
    this.applyPlacement();
  }

  advancePrimary(): void {
    if (!this.state.payload) {
      return;
    }

    if (this.isTyping()) {
      this.finishTyping();
      return;
    }

    if (hasMorePages(this.state.pageIndex, this.state.pages)) {
      this.state.pageIndex += 1;
      this.renderPage();
      this.startTyping();
      return;
    }

    this.goNext();
  }

  goPrevious(): void {
    if (!this.state.payload) {
      return;
    }

    if (this.isTyping()) {
      this.finishTyping();
      return;
    }

    if (this.state.pageIndex > 0) {
      this.state.pageIndex -= 1;
      this.renderPage();
      this.startTyping();
      return;
    }

    if (this.state.payload.memoryIndex <= 0) {
      return;
    }

    this.setMemoryIndex(this.state.payload.memoryIndex - 1, "last");
  }

  goNext(): void {
    if (!this.state.payload) {
      return;
    }

    if (this.isTyping()) {
      this.finishTyping();
      return;
    }

    if (hasMorePages(this.state.pageIndex, this.state.pages)) {
      this.state.pageIndex += 1;
      this.renderPage();
      this.startTyping();
      return;
    }

    if (this.state.payload.memoryIndex >= this.state.payload.memories.length - 1) {
      return;
    }

    this.setMemoryIndex(this.state.payload.memoryIndex + 1, 0);
  }

  private goPreviousMemory(): void {
    if (!this.state.payload) {
      return;
    }

    if (this.isTyping()) {
      this.finishTyping();
      return;
    }

    if (this.state.payload.memoryIndex <= 0) {
      return;
    }

    this.setMemoryIndex(this.state.payload.memoryIndex - 1, 0);
  }

  private goNextMemory(): void {
    if (!this.state.payload) {
      return;
    }

    if (this.isTyping()) {
      this.finishTyping();
      return;
    }

    if (this.state.payload.memoryIndex >= this.state.payload.memories.length - 1) {
      return;
    }

    this.setMemoryIndex(this.state.payload.memoryIndex + 1, 0);
  }

  private setMemoryIndex(nextIndex: number, nextPageIndex: number | "last"): void {
    if (!this.state.payload) {
      return;
    }

    const clampedIndex = Math.max(0, Math.min(nextIndex, this.state.payload.memories.length - 1));
    const nextMemory = this.state.payload.memories[clampedIndex];
    if (!nextMemory) {
      return;
    }

    this.stopTyping();
    this.state.payload = {
      ...this.state.payload,
      memoryIndex: clampedIndex,
    };
    this.state.pages = this.buildPages(nextMemory.content);
    this.state.pageIndex = nextPageIndex === "last"
      ? Math.max(0, this.state.pages.length - 1)
      : Math.max(0, Math.min(nextPageIndex, this.state.pages.length - 1));
    this.state.characterIndex = 0;
    this.updateTextMeta();
    this.renderPage();
    this.state.placement = this.computePlacement(this.state.payload);
    this.applyPlacement();
    this.startTyping();
  }

  private buildPages(content: string): string[] {
    const pages = paginatePixelFarmDialogText(
      {
        text: normalizeText(content),
        maxLines: DIALOG_MAX_TEXT_LINES,
        measureLineCount: (value) => this.measureWrappedLineCount(value),
      },
    );

    return pages.length > 0 ? pages : [""];
  }

  private computePlacement(payload: PixelFarmDialogPayload): PixelFarmDialogPlacement {
    const viewportWidth = this.scene.scale.width;
    const viewportHeight = this.scene.scale.height;
    const dialogHeight = this.measureDialogHeight(this.state.pages[this.state.pageIndex] ?? "");

    return computePixelFarmDialogPlacement({
      viewportWidth,
      viewportHeight,
      anchorX: payload.anchorScreenX,
      anchorY: payload.anchorScreenY,
      dialogWidth: DIALOG_WIDTH,
      dialogHeight,
      marginX: DIALOG_MARGIN_X,
      marginTop: DIALOG_MARGIN_TOP,
      marginBottom: DIALOG_MARGIN_BOTTOM,
      offsetAboveAnchor: DIALOG_OFFSET_ABOVE_ANCHOR,
    });
  }

  private measureDialogHeight(pageText: string): number {
    const lineCount = this.measureWrappedLineCount(pageText);
    const contentHeight =
      DIALOG_PADDING_TOP +
      DIALOG_HEADER_HEIGHT +
      6 +
      lineCount * DIALOG_LINE_HEIGHT +
      DIALOG_PADDING_BOTTOM;
    return Math.max(DIALOG_MIN_HEIGHT, Math.min(DIALOG_MAX_HEIGHT, contentHeight));
  }

  private measureWrappedLineCount(text: string): number {
    if (!text) {
      return 1;
    }

    this.measureText.setWordWrapWidth(DIALOG_TEXT_WIDTH, true);
    this.measureText.setText(text);
    return Math.max(1, this.measureText.getWrappedText().length);
  }

  private layoutBody(width: number, height: number): void {
    const centerWidth = Math.max(0, width - DIALOG_TILE_SIZE * 2);
    const centerHeight = Math.max(0, height - DIALOG_TILE_SIZE * 2);

    this.sprites.topLeft.setPosition(0, 0);
    this.sprites.top.setPosition(DIALOG_TILE_SIZE, 0).setSize(centerWidth, DIALOG_TILE_SIZE);
    this.sprites.topRight.setPosition(width - DIALOG_TILE_SIZE, 0);

    this.sprites.left.setPosition(0, DIALOG_TILE_SIZE).setSize(DIALOG_TILE_SIZE, centerHeight);
    this.sprites.center.setPosition(DIALOG_TILE_SIZE, DIALOG_TILE_SIZE).setSize(centerWidth, centerHeight);
    this.sprites.right.setPosition(width - DIALOG_TILE_SIZE, DIALOG_TILE_SIZE).setSize(DIALOG_TILE_SIZE, centerHeight);

    this.sprites.bottomLeft.setPosition(0, height - DIALOG_TILE_SIZE);
    this.sprites.bottom.setPosition(DIALOG_TILE_SIZE, height - DIALOG_TILE_SIZE).setSize(centerWidth, DIALOG_TILE_SIZE);
    this.sprites.bottomRight.setPosition(width - DIALOG_TILE_SIZE, height - DIALOG_TILE_SIZE);

    this.bodyHitArea.setSize(width, height);
    this.bodyHitArea.setPosition(0, 0);
    const hitArea = this.bodyHitArea.input?.hitArea;
    if (hitArea instanceof Phaser.Geom.Rectangle) {
      hitArea.setTo(0, 0, width, height);
    }
  }

  private applyPlacement(): void {
    const placement = this.state.placement;
    if (!placement) {
      return;
    }

    const dialogHeight = this.measureDialogHeight(this.state.pages[this.state.pageIndex] ?? "");
    this.layoutBody(DIALOG_WIDTH, dialogHeight);
    this.root.setPosition(placement.x, placement.y);
    this.rightButton.setVisible(
      (this.state.payload?.memoryIndex ?? 0) < (this.state.payload?.memories.length ?? 0) - 1,
    );
    this.leftButton.setVisible(
      (this.state.payload?.memoryIndex ?? 0) > 0,
    );
    this.root.setVisible(true);
  }

  private renderPage(): void {
    const text = this.state.pages[this.state.pageIndex] ?? "";
    const currentMemory = this.state.payload?.memories[this.state.payload.memoryIndex] ?? null;
    const pageCounter = this.state.pages.length > 1
      ? ` • ${this.state.pageIndex + 1} / ${this.state.pages.length}`
      : "";
    const memoryCounter = this.state.payload
      ? `${this.state.payload.memoryIndex + 1} / ${this.state.payload.memories.length}`
      : "";

    this.headerText.setText(this.state.payload?.tagLabel ?? "");
    this.counterText.setText(currentMemory ? `${memoryCounter}${pageCounter}` : "");
    this.contentText.setText(text);
    this.contentText.setWordWrapWidth(DIALOG_TEXT_WIDTH);
    this.contentText.setPosition(DIALOG_PADDING_X, DIALOG_PADDING_TOP + DIALOG_HEADER_HEIGHT + 6);
    this.headerText.setPosition(DIALOG_PADDING_X, DIALOG_PADDING_TOP);
    this.counterText.setPosition(DIALOG_WIDTH - DIALOG_PADDING_X - this.counterText.width, DIALOG_PADDING_TOP);
    this.leftButton.setPosition(12, Math.max(12, this.measureDialogHeight(text) - 28));
    this.rightButton.setPosition(DIALOG_WIDTH - 24, Math.max(12, this.measureDialogHeight(text) - 28));
  }

  private updateTextMeta(): void {
    this.contentText.setStyle({
      fontFamily: "\"Ark Pixel Mono\", monospace",
      fontSize: "16px",
      color: "#6f563d",
      wordWrap: { width: DIALOG_TEXT_WIDTH },
      lineSpacing: 0,
    });
    this.measureText.setStyle({
      fontFamily: "\"Ark Pixel Mono\", monospace",
      fontSize: "16px",
      color: "#6f563d",
      wordWrap: { width: DIALOG_TEXT_WIDTH },
      lineSpacing: 0,
    });
    this.headerText.setStyle({
      fontFamily: "\"Ark Pixel Mono\", monospace",
      fontSize: "16px",
      color: "#8a6848",
    });
    this.counterText.setStyle({
      fontFamily: "\"Ark Pixel Mono\", monospace",
      fontSize: "16px",
      color: "#8a6848",
    });
  }

  private createHeaderStyle(): Phaser.Types.GameObjects.Text.TextStyle {
    return {
      fontFamily: "\"Ark Pixel Mono\", monospace",
      fontSize: "16px",
      color: "#8a6848",
    };
  }

  private createContentStyle(): Phaser.Types.GameObjects.Text.TextStyle {
    return {
      fontFamily: "\"Ark Pixel Mono\", monospace",
      fontSize: "16px",
      color: "#6f563d",
      wordWrap: { width: DIALOG_TEXT_WIDTH },
      lineSpacing: 0,
    };
  }

  private createCounterStyle(): Phaser.Types.GameObjects.Text.TextStyle {
    return {
      fontFamily: "\"Ark Pixel Mono\", monospace",
      fontSize: "16px",
      color: "#8a6848",
    };
  }

  private createButtonStyle(): Phaser.Types.GameObjects.Text.TextStyle {
    return {
      fontFamily: "\"Ark Pixel Mono\", monospace",
      fontSize: "16px",
      color: "#8a6848",
    };
  }

  private startTyping(): void {
    this.stopTyping();
    this.state.characterIndex = 0;
    this.contentText.setText("");

    if (!this.state.pages[this.state.pageIndex]) {
      return;
    }

    this.state.typingTimer = this.scene.time.addEvent({
      delay: TYPING_DELAY_MS,
      loop: true,
      callback: () => {
        const pageText = this.state.pages[this.state.pageIndex] ?? "";
        if (this.state.characterIndex >= pageText.length) {
          this.stopTyping();
          return;
        }

        this.state.characterIndex += 1;
        this.contentText.setText(pageText.slice(0, this.state.characterIndex));
      },
    });
  }

  private finishTyping(): void {
    this.stopTyping();
    this.contentText.setText(this.state.pages[this.state.pageIndex] ?? "");
  }

  private stopTyping(): void {
    this.state.typingTimer?.destroy();
    this.state.typingTimer = null;
  }

  private bindKeyboard(): void {
    const keyboard = this.scene.input.keyboard;
    if (!keyboard) {
      return;
    }

    for (const binding of this.keyBindings) {
      keyboard.on(binding.event, binding.handler);
    }
  }

  private unbindKeyboard(): void {
    const keyboard = this.scene.input.keyboard;
    if (!keyboard) {
      return;
    }

    for (const binding of this.keyBindings) {
      keyboard.off(binding.event, binding.handler);
    }
  }

  private isTyping(): boolean {
    const pageText = this.state.pages[this.state.pageIndex] ?? "";
    return this.state.characterIndex < pageText.length;
  }
}
