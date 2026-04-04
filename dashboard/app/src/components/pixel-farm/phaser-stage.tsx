import { useEffect, useRef, useState } from "react";
import type Phaser from "phaser";
import i18n from "@/i18n";
import {
  createPixelFarmGame,
  type PixelFarmDebugState,
  type PixelFarmInteractionDebugInfo,
  type PixelFarmPointerDebugInfo,
} from "@/lib/pixel-farm/create-game";
import { PixelFarmUIScene } from "@/lib/pixel-farm/ui-scene";
import {
  PIXEL_FARM_BUBBLE_APPEAR_SOUND_DURATION_MS,
  PIXEL_FARM_BUBBLE_APPEAR_SOUND_KEY,
} from "@/lib/pixel-farm/runtime-assets";
import {
  createPixelFarmOpenBubbleState,
  type PixelFarmOpenBubbleState,
} from "@/lib/pixel-farm/dialog-state";
import { shouldIgnoreRepeatedDialogInteraction } from "@/lib/pixel-farm/dialog-interaction";
import type { PixelFarmWorldState } from "@/lib/pixel-farm/data/types";
import { buildPixelFarmPlantDialogEntries } from "@/lib/pixel-farm/plant-dialog-content";
import {
  buildPixelFarmNpcDialogCatalog,
  pickNextPixelFarmNpcDialogEntry,
  type PixelFarmNpcDialogRotationState,
} from "@/lib/pixel-farm/npc-dialog-content";
import { getPixelFarmNpcDialogTitle } from "@/lib/pixel-farm/npc-tips";
import type { PixelFarmNpcDialogContentState } from "@/lib/pixel-farm/use-pixel-farm-npc-dialog-content";
import type { Memory } from "@/types/memory";

interface PhaserStageProps {
  debugActorState?: PixelFarmDebugState | null;
  memoryById?: Record<string, Memory>;
  musicEnabled?: boolean;
  npcDialogContent?: PixelFarmNpcDialogContentState | null;
  onInteractionDebugChange?: ((info: PixelFarmInteractionDebugInfo) => void) | null;
  onPointerDebugChange?: ((info: PixelFarmPointerDebugInfo) => void) | null;
  resolveInteractionMemories?: ((tagKey: string) => Promise<Memory[]>) | null;
  showInteractionDebug?: boolean;
  showSpatialDebug?: boolean;
  worldState?: PixelFarmWorldState | null;
}

function createFallbackNpcDialogContent(): PixelFarmNpcDialogContentState {
  return {
    catalog: buildPixelFarmNpcDialogCatalog({
      deepReport: null,
      lightSnapshot: null,
      t: (key, vars) => i18n.t(key, vars),
    }),
    deepReport: null,
    lightSnapshot: null,
  };
}

function playBubbleAppearSound(
  game: Phaser.Game | null,
  soundRef: { current: Phaser.Sound.BaseSound | null },
  stopTimerRef: { current: number | null },
): void {
  const scene = game?.scene.getScene("pixel-farm-sandbox") as Phaser.Scene | undefined;
  if (!scene?.cache.audio.exists(PIXEL_FARM_BUBBLE_APPEAR_SOUND_KEY)) {
    return;
  }

  const clearStopTimer = () => {
    if (stopTimerRef.current === null) {
      return;
    }

    window.clearTimeout(stopTimerRef.current);
    stopTimerRef.current = null;
  };

  if (!soundRef.current) {
    soundRef.current = scene.sound.add(PIXEL_FARM_BUBBLE_APPEAR_SOUND_KEY);
  }

  clearStopTimer();
  soundRef.current.stop();
  soundRef.current.play();
  stopTimerRef.current = window.setTimeout(() => {
    soundRef.current?.stop();
    stopTimerRef.current = null;
  }, PIXEL_FARM_BUBBLE_APPEAR_SOUND_DURATION_MS);
}

export function PhaserStage({
  debugActorState = null,
  memoryById = {},
  musicEnabled = true,
  npcDialogContent = null,
  onInteractionDebugChange = null,
  onPointerDebugChange = null,
  showInteractionDebug = false,
  showSpatialDebug = false,
  worldState = null,
}: PhaserStageProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const debugActorStateRef = useRef<PixelFarmDebugState | null>(debugActorState);
  const onPointerDebugChangeRef = useRef<((info: PixelFarmPointerDebugInfo) => void) | null>(
    onPointerDebugChange,
  );
  const onInteractionDebugChangeRef = useRef<
    ((info: PixelFarmInteractionDebugInfo) => void) | null
  >(onInteractionDebugChange);
  const showInteractionDebugRef = useRef(showInteractionDebug);
  const musicEnabledRef = useRef(musicEnabled);
  const showSpatialDebugRef = useRef(showSpatialDebug);
  const worldStateRef = useRef<PixelFarmWorldState | null>(worldState);
  const memoryByIdRef = useRef(memoryById);
  const npcDialogContentRef = useRef<PixelFarmNpcDialogContentState | null>(npcDialogContent);
  const openBubbleStateRef = useRef<PixelFarmOpenBubbleState | null>(null);
  const pausedAnimalInstanceIdRef = useRef<string | null>(null);
  const npcDialogRotationRef = useRef<PixelFarmNpcDialogRotationState | null>(null);
  const handledInteractionNonceRef = useRef(0);
  const bubbleAppearSoundRef = useRef<Phaser.Sound.BaseSound | null>(null);
  const bubbleAppearSoundStopTimerRef = useRef<number | null>(null);
  const [openBubbleState, setOpenBubbleState] = useState<PixelFarmOpenBubbleState | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    debugActorStateRef.current = debugActorState;
  }, [debugActorState]);

  useEffect(() => {
    onPointerDebugChangeRef.current = onPointerDebugChange;
  }, [onPointerDebugChange]);

  useEffect(() => {
    onInteractionDebugChangeRef.current = onInteractionDebugChange;
  }, [onInteractionDebugChange]);

  useEffect(() => {
    showInteractionDebugRef.current = showInteractionDebug;
  }, [showInteractionDebug]);

  useEffect(() => {
    musicEnabledRef.current = musicEnabled;
  }, [musicEnabled]);

  useEffect(() => {
    showSpatialDebugRef.current = showSpatialDebug;
  }, [showSpatialDebug]);

  useEffect(() => {
    worldStateRef.current = worldState;
  }, [worldState]);

  useEffect(() => {
    memoryByIdRef.current = memoryById;
  }, [memoryById]);

  useEffect(() => {
    npcDialogContentRef.current = npcDialogContent;
  }, [npcDialogContent]);

  useEffect(() => {
    openBubbleStateRef.current = openBubbleState;
  }, [openBubbleState]);

  useEffect(() => {
    pausedAnimalInstanceIdRef.current = openBubbleState?.animalInstanceId ?? null;
  }, [openBubbleState]);

  useEffect(() => {
    const uiScene = gameRef.current?.scene.getScene("pixel-farm-ui") as PixelFarmUIScene | undefined;
    if (!uiScene) {
      return;
    }

    if (!openBubbleState) {
      uiScene.closeDialog();
      return;
    }

    if (openBubbleState.entries.length === 0) {
      uiScene.closeDialog();
      return;
    }

    uiScene.openDialog({
      targetId: openBubbleState.targetId,
      bucketTotalMemoryCount: openBubbleState.bucketTotalMemoryCount,
      entries: openBubbleState.entries,
      interactionNonce: openBubbleState.interactionNonce,
      tagLabel: openBubbleState.tagLabel,
      memoryIndex: openBubbleState.memoryIndex % openBubbleState.entries.length,
      showCounter: openBubbleState.showCounter,
      startIndexInclusive: openBubbleState.startIndexInclusive,
      anchorWorldX: openBubbleState.screenX,
      anchorWorldY: openBubbleState.screenY,
      anchorScreenX: openBubbleState.screenX,
      anchorScreenY: openBubbleState.screenY,
    });
  }, [openBubbleState]);

  useEffect(() => {
    if (!hostRef.current || gameRef.current) {
      return undefined;
    }

    try {
      gameRef.current = createPixelFarmGame(hostRef.current, {
        getDebugActorState: () => debugActorStateRef.current,
        getMusicEnabled: () => musicEnabledRef.current,
        getPausedAnimalInstanceId: () => pausedAnimalInstanceIdRef.current,
        onInteractionDebugChange: (info) => {
          onInteractionDebugChangeRef.current?.(info);
          const target = info.target;
          const currentBubble = openBubbleStateRef.current;
          const uiScene = gameRef.current?.scene.getScene("pixel-farm-ui") as PixelFarmUIScene | undefined;

          if (!target) {
            setOpenBubbleState(null);
            return;
          }

          if (
            currentBubble &&
            currentBubble.targetId === target.id &&
            currentBubble.interactionNonce === info.interactionNonce
          ) {
            uiScene?.refreshDialogAnchor(target.screenX, target.screenY);
          }

          if (shouldIgnoreRepeatedDialogInteraction({
            currentBubble,
            interactionNonce: info.interactionNonce,
            targetKind: target.kind,
            targetId: target.id,
          })) {
            uiScene?.refreshDialogAnchor(target.screenX, target.screenY);
            handledInteractionNonceRef.current = info.interactionNonce;
            return;
          }

          if (
            info.interactionNonce === handledInteractionNonceRef.current ||
            info.interactionNonce < 1 ||
            !info.target ||
            info.lastInteractedTargetId !== info.target.id
          ) {
            return;
          }

          setOpenBubbleState((current) => {
            const entries =
              target.kind === "plant"
                ? buildPixelFarmPlantDialogEntries({
                    bucketTotalMemoryCount: target.bucketTotalMemoryCount ?? target.memoryIds.length,
                    memories: target.memoryIds
                      .map((memoryId) => memoryByIdRef.current[memoryId])
                      .filter((memory): memory is Memory => Boolean(memory)),
                    tagLabel: target.tagLabel,
                    t: (key, vars) => i18n.t(key, vars),
                  })
                : (() => {
                    const nextDialog = pickNextPixelFarmNpcDialogEntry({
                      catalog:
                        npcDialogContentRef.current?.catalog ?? createFallbackNpcDialogContent().catalog,
                      rotationState: npcDialogRotationRef.current,
                    });
                    npcDialogRotationRef.current = nextDialog.rotationState;
                    return [{ id: nextDialog.entry.id, kind: "npc" as const, content: nextDialog.entry.text }];
                  })();

            if (entries.length < 1) {
              return null;
            }

            const next = createPixelFarmOpenBubbleState(
              {
                interactionNonce: info.interactionNonce,
                target: {
                  animalInstanceId: target.animalInstanceId ?? null,
                  bucketTotalMemoryCount:
                    target.kind === "plant"
                      ? (target.bucketTotalMemoryCount ?? entries.length)
                      : 1,
                  id: target.id,
                  memoryIds: [...target.memoryIds],
                  screenX: target.screenX,
                  screenY: target.screenY,
                  showCounter: target.kind === "plant",
                  startIndexInclusive:
                    target.kind === "plant" ? (target.startIndexInclusive ?? 0) : 0,
                  tagLabel:
                    target.kind === "plant"
                      ? target.tagLabel
                      : getPixelFarmNpcDialogTitle(),
                },
              },
              entries,
              current,
            );
            if (
              next &&
              (!current ||
                current.targetId !== next.targetId ||
                current.interactionNonce !== next.interactionNonce)
            ) {
              playBubbleAppearSound(
                gameRef.current,
                bubbleAppearSoundRef,
                bubbleAppearSoundStopTimerRef,
              );
            }
            return next;
          });

          handledInteractionNonceRef.current = info.interactionNonce;
        },
        onPointerDebugChange: (info) => onPointerDebugChangeRef.current?.(info),
        getShowInteractionDebug: () => showInteractionDebugRef.current,
        getShowSpatialDebug: () => showSpatialDebugRef.current,
        getWorldState: () => worldStateRef.current,
      });
      setBootError(null);
    } catch (error) {
      setBootError(error instanceof Error ? error.message : String(error));
    }

    return () => {
      handledInteractionNonceRef.current = 0;
      openBubbleStateRef.current = null;
      pausedAnimalInstanceIdRef.current = null;
      if (bubbleAppearSoundStopTimerRef.current !== null) {
        window.clearTimeout(bubbleAppearSoundStopTimerRef.current);
        bubbleAppearSoundStopTimerRef.current = null;
      }
      bubbleAppearSoundRef.current?.destroy();
      bubbleAppearSoundRef.current = null;
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0d141b]">
      <div ref={hostRef} className="h-full w-full touch-none" />
      {bootError ? (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0d141b] px-6 text-center text-sm uppercase tracking-[0.2em] text-[#f6dca6]">
          {bootError}
        </div>
      ) : null}
    </div>
  );
}
