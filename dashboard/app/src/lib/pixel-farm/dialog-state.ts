import type { Memory } from "@/types/memory";

export interface PixelFarmDialogTargetSnapshot {
  bucketTotalMemoryCount: number;
  id: string;
  memoryIds: string[];
  screenX: number;
  screenY: number;
  startIndexInclusive: number;
  tagLabel: string;
}

export interface PixelFarmDialogInteractionInput {
  interactionNonce: number;
  target: PixelFarmDialogTargetSnapshot | null;
}

export interface PixelFarmOpenBubbleState {
  bucketTotalMemoryCount: number;
  interactionNonce: number;
  memories: Memory[];
  memoryIds: string[];
  memoryIndex: number;
  screenX: number;
  screenY: number;
  startIndexInclusive: number;
  tagLabel: string;
  targetId: string;
}

export function createPixelFarmOpenBubbleState(
  info: PixelFarmDialogInteractionInput,
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
      bucketTotalMemoryCount: target.bucketTotalMemoryCount,
      memories: [...memories],
      memoryIds,
      memoryIndex: Math.min(current.memoryIndex, memoryIds.length - 1),
      screenX: target.screenX,
      screenY: target.screenY,
      startIndexInclusive: target.startIndexInclusive,
      tagLabel: target.tagLabel,
    };
  }

  if (!current || current.targetId !== target.id) {
    return {
      bucketTotalMemoryCount: target.bucketTotalMemoryCount,
      interactionNonce: info.interactionNonce,
      memories: [...memories],
      memoryIds,
      memoryIndex: 0,
      screenX: target.screenX,
      screenY: target.screenY,
      startIndexInclusive: target.startIndexInclusive,
      tagLabel: target.tagLabel,
      targetId: target.id,
    };
  }

  return {
    ...current,
    bucketTotalMemoryCount: target.bucketTotalMemoryCount,
    interactionNonce: info.interactionNonce,
    memories: [...memories],
    memoryIds,
    memoryIndex:
      info.interactionNonce > current.interactionNonce
        ? (current.memoryIndex + 1) % memoryIds.length
        : Math.min(current.memoryIndex, memoryIds.length - 1),
    screenX: target.screenX,
    screenY: target.screenY,
    startIndexInclusive: target.startIndexInclusive,
    tagLabel: target.tagLabel,
  };
}

export function formatPixelFarmDialogCounter(input: {
  bucketTotalMemoryCount: number;
  memoryIndex: number;
  pageCount: number;
  pageIndex: number;
  startIndexInclusive: number;
}): string {
  const memoryCounter = `${input.startIndexInclusive + input.memoryIndex + 1} / ${input.bucketTotalMemoryCount}`;
  if (input.pageCount <= 1) {
    return memoryCounter;
  }

  return `${memoryCounter} • ${input.pageIndex + 1} / ${input.pageCount}`;
}
