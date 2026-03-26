import { useEffect, useRef, useState } from "react";
import type Phaser from "phaser";
import { PixelFarmInteractionBubble } from "@/components/pixel-farm/interaction-bubble";
import {
  createPixelFarmGame,
  type PixelFarmDebugState,
  type PixelFarmInteractionDebugInfo,
  type PixelFarmPointerDebugInfo,
} from "@/lib/pixel-farm/create-game";
import {
  PIXEL_FARM_BUBBLE_APPEAR_SOUND_DURATION_MS,
  PIXEL_FARM_BUBBLE_APPEAR_SOUND_KEY,
} from "@/lib/pixel-farm/runtime-assets";
import type { PixelFarmWorldState } from "@/lib/pixel-farm/data/types";
import type { Memory } from "@/types/memory";

interface PhaserStageProps {
  debugActorState?: PixelFarmDebugState | null;
  memoryById?: Record<string, Memory>;
  onInteractionDebugChange?: ((info: PixelFarmInteractionDebugInfo) => void) | null;
  onPointerDebugChange?: ((info: PixelFarmPointerDebugInfo) => void) | null;
  resolveInteractionMemories?: ((tagKey: string) => Promise<Memory[]>) | null;
  showInteractionDebug?: boolean;
  showSpatialDebug?: boolean;
  worldState?: PixelFarmWorldState | null;
}

interface PixelFarmOpenBubbleState {
  animalInstanceId: string | null;
  interactionNonce: number;
  memoryIds: string[];
  memories: Memory[];
  memoryIndex: number;
  screenX: number;
  screenY: number;
  tagLabel: string;
  targetId: string;
}

function resolveAvailableMemoryIds(
  memoryIds: readonly string[],
  memoryById: Record<string, Memory>,
): string[] {
  return memoryIds.filter((memoryId) => memoryById[memoryId]);
}

function createOpenBubbleState(
  info: PixelFarmInteractionDebugInfo,
  memories: readonly Memory[],
  current: PixelFarmOpenBubbleState | null,
): PixelFarmOpenBubbleState | null {
  const target = info.target;
  if (!target || memories.length < 1) {
    return null;
  }

  const memoryIds = memories.map((memory) => memory.id);
  if (current && current.targetId === target.id && info.interactionNonce === current.interactionNonce) {
    return {
      ...current,
      animalInstanceId: target.animalInstanceId ?? null,
      memories: [...memories],
      memoryIds,
      screenX: target.screenX,
      screenY: target.screenY,
      tagLabel: target.tagLabel,
    };
  }

  if (!current || current.targetId !== target.id) {
    return {
      animalInstanceId: target.animalInstanceId ?? null,
      interactionNonce: info.interactionNonce,
      memories: [...memories],
      memoryIds,
      memoryIndex: 0,
      screenX: target.screenX,
      screenY: target.screenY,
      tagLabel: target.tagLabel,
      targetId: target.id,
    };
  }

  return {
    ...current,
    animalInstanceId: target.animalInstanceId ?? null,
    interactionNonce: info.interactionNonce,
    memories: [...memories],
    memoryIds,
    memoryIndex: info.interactionNonce > current.interactionNonce
      ? (current.memoryIndex + 1) % memoryIds.length
      : current.memoryIndex,
    screenX: target.screenX,
    screenY: target.screenY,
    tagLabel: target.tagLabel,
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
  onInteractionDebugChange = null,
  onPointerDebugChange = null,
  resolveInteractionMemories = null,
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
  const showSpatialDebugRef = useRef(showSpatialDebug);
  const worldStateRef = useRef<PixelFarmWorldState | null>(worldState);
  const memoryByIdRef = useRef(memoryById);
  const resolveInteractionMemoriesRef = useRef<((tagKey: string) => Promise<Memory[]>) | null>(
    resolveInteractionMemories,
  );
  const pausedAnimalInstanceIdRef = useRef<string | null>(null);
  const handledInteractionNonceRef = useRef(0);
  const interactionRequestIdRef = useRef(0);
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
    showSpatialDebugRef.current = showSpatialDebug;
  }, [showSpatialDebug]);

  useEffect(() => {
    worldStateRef.current = worldState;
  }, [worldState]);

  useEffect(() => {
    memoryByIdRef.current = memoryById;
  }, [memoryById]);

  useEffect(() => {
    resolveInteractionMemoriesRef.current = resolveInteractionMemories;
  }, [resolveInteractionMemories]);

  const fallbackVisibleMemoryIds = openBubbleState
    ? resolveAvailableMemoryIds(openBubbleState.memoryIds, memoryById)
    : [];
  const visibleMemories = openBubbleState
    ? openBubbleState.memories.length > 0
      ? openBubbleState.memories
      : fallbackVisibleMemoryIds.map((memoryId) => memoryById[memoryId]!).filter(Boolean)
    : [];
  const currentIndex = openBubbleState && visibleMemories.length > 0
    ? openBubbleState.memoryIndex % visibleMemories.length
    : 0;
  const currentMemory = visibleMemories[currentIndex] ?? null;
  const pausedAnimalInstanceId =
    openBubbleState && currentMemory ? openBubbleState.animalInstanceId : null;

  useEffect(() => {
    pausedAnimalInstanceIdRef.current = pausedAnimalInstanceId;
  }, [pausedAnimalInstanceId]);

  useEffect(() => {
    if (!hostRef.current || gameRef.current) {
      return undefined;
    }

    try {
      gameRef.current = createPixelFarmGame(hostRef.current, {
        getDebugActorState: () => debugActorStateRef.current,
        getPausedAnimalInstanceId: () => pausedAnimalInstanceIdRef.current,
        onInteractionDebugChange: (info) => {
          onInteractionDebugChangeRef.current?.(info);

          const requestId = interactionRequestIdRef.current + 1;
          interactionRequestIdRef.current = requestId;
          const resolver = resolveInteractionMemoriesRef.current;
          const target = info.target;

          if (!target || !resolver) {
            setOpenBubbleState(null);
          } else {
            void resolver(target.tagKey).then((memories) => {
              if (interactionRequestIdRef.current !== requestId) {
                return;
              }

              setOpenBubbleState((current) => {
                const next = createOpenBubbleState(info, memories, current);
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
            });
          }

          if (
            info.interactionNonce === handledInteractionNonceRef.current ||
            info.interactionNonce < 1 ||
            !info.target ||
            info.lastInteractedTargetId !== info.target.id
          ) {
            return;
          }

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
      interactionRequestIdRef.current += 1;
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
      {openBubbleState && currentMemory ? (
        <PixelFarmInteractionBubble
          content={currentMemory.content}
          currentIndex={currentIndex}
          screenX={openBubbleState.screenX}
          screenY={openBubbleState.screenY}
          tagLabel={openBubbleState.tagLabel}
          totalCount={visibleMemories.length}
        />
      ) : null}
      {bootError ? (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0d141b] px-6 text-center text-sm uppercase tracking-[0.2em] text-[#f6dca6]">
          {bootError}
        </div>
      ) : null}
    </div>
  );
}
