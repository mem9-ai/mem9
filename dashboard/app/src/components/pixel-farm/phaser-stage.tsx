import { useEffect, useRef, useState } from "react";
import type Phaser from "phaser";
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
import type { PixelFarmWorldState } from "@/lib/pixel-farm/data/types";
import type { Memory } from "@/types/memory";

interface PhaserStageProps {
  debugActorState?: PixelFarmDebugState | null;
  memoryById?: Record<string, Memory>;
  musicEnabled?: boolean;
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

const PIXEL_FARM_EMPTY_MEMORY_MESSAGES = [
  "No memories have formed here.",
  "Nothing has taken shape here.",
  "This place holds no memory.",
  "No traces remain.",
  "This place is quiet.",
  "Nothing stirs here.",
  "No signs of life.",
  "It feels untouched.",
  "Nothing is here.",
  "There's nothing here yet.",
  "This place is empty.",
  "Nothing has appeared here yet.",
  "Nothing has settled here yet.",
  "No one has come by.",
  "This spot is still waiting.",
] as const;

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
      : Math.min(current.memoryIndex, memoryIds.length - 1),
    screenX: target.screenX,
    screenY: target.screenY,
    tagLabel: target.tagLabel,
  };
}

function createFallbackMemory(targetId: string, tagLabel: string): Memory {
  const now = new Date().toISOString();
  const content = PIXEL_FARM_EMPTY_MEMORY_MESSAGES[
    Math.floor(Math.random() * PIXEL_FARM_EMPTY_MEMORY_MESSAGES.length)
  ] ?? "This place is empty.";

  return {
    id: `pixel-farm-empty:${targetId}`,
    content,
    memory_type: "insight",
    source: "pixel-farm",
    tags: tagLabel ? [tagLabel] : [],
    metadata: {
      pixelFarmFallback: true,
      targetId,
    },
    agent_id: "pixel-farm",
    session_id: "pixel-farm",
    state: "active",
    version: 1,
    updated_by: "pixel-farm",
    created_at: now,
    updated_at: now,
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
  const openBubbleStateRef = useRef<PixelFarmOpenBubbleState | null>(null);
  const pausedAnimalInstanceIdRef = useRef<string | null>(null);
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
    openBubbleStateRef.current = openBubbleState;
  }, [openBubbleState]);

  const pausedAnimalInstanceId = openBubbleState?.animalInstanceId ?? null;

  useEffect(() => {
    pausedAnimalInstanceIdRef.current = pausedAnimalInstanceId;
  }, [pausedAnimalInstanceId]);

  useEffect(() => {
    const uiScene = gameRef.current?.scene.getScene("pixel-farm-ui") as PixelFarmUIScene | undefined;
    if (!uiScene) {
      return;
    }

    if (!openBubbleState) {
      uiScene.closeDialog();
      return;
    }

    const visibleMemories = openBubbleState.memories.length > 0
      ? openBubbleState.memories
      : resolveAvailableMemoryIds(openBubbleState.memoryIds, memoryById)
          .map((memoryId) => memoryById[memoryId]!)
          .filter(Boolean);

    if (visibleMemories.length === 0) {
      uiScene.closeDialog();
      return;
    }

    uiScene.openDialog({
      targetId: openBubbleState.targetId,
      interactionNonce: openBubbleState.interactionNonce,
      tagLabel: openBubbleState.tagLabel,
      memories: visibleMemories,
      memoryIndex: openBubbleState.memoryIndex % visibleMemories.length,
      anchorWorldX: openBubbleState.screenX,
      anchorWorldY: openBubbleState.screenY,
      anchorScreenX: openBubbleState.screenX,
      anchorScreenY: openBubbleState.screenY,
    });
  }, [memoryById, openBubbleState]);

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

          if (
            info.interactionNonce === handledInteractionNonceRef.current ||
            info.interactionNonce < 1 ||
            !info.target ||
            info.lastInteractedTargetId !== info.target.id
          ) {
            return;
          }

          const resolvedMemories = target.memoryIds
            .map((memoryId) => memoryByIdRef.current[memoryId])
            .filter((memory): memory is Memory => Boolean(memory));
          const dialogMemories = resolvedMemories.length > 0
            ? resolvedMemories
            : [createFallbackMemory(target.id, target.tagLabel)];

          setOpenBubbleState((current) => {
            const next = createOpenBubbleState(info, dialogMemories, current);
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
