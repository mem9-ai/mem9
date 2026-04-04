export interface PixelFarmDialogEntry {
  id: string;
  content: string;
}

export interface PixelFarmDialogTargetSnapshot {
  animalInstanceId?: string | null;
  bucketTotalMemoryCount: number;
  id: string;
  memoryIds: string[];
  screenX: number;
  screenY: number;
  showCounter: boolean;
  startIndexInclusive: number;
  tagLabel: string;
}

export interface PixelFarmDialogInteractionInput {
  interactionNonce: number;
  target: PixelFarmDialogTargetSnapshot | null;
}

export interface PixelFarmOpenBubbleState {
  animalInstanceId: string | null;
  bucketTotalMemoryCount: number;
  entries: PixelFarmDialogEntry[];
  interactionNonce: number;
  memoryIndex: number;
  screenX: number;
  screenY: number;
  showCounter: boolean;
  startIndexInclusive: number;
  tagLabel: string;
  targetId: string;
}

export function createPixelFarmOpenBubbleState(
  info: PixelFarmDialogInteractionInput,
  entries: readonly PixelFarmDialogEntry[],
  current: PixelFarmOpenBubbleState | null,
): PixelFarmOpenBubbleState | null {
  const target = info.target;
  if (!target || entries.length < 1) {
    return null;
  }

  if (current && current.targetId === target.id && info.interactionNonce === current.interactionNonce) {
    return {
      ...current,
      animalInstanceId: target.animalInstanceId ?? null,
      bucketTotalMemoryCount: target.bucketTotalMemoryCount,
      entries: [...entries],
      memoryIndex: Math.min(current.memoryIndex, entries.length - 1),
      screenX: target.screenX,
      screenY: target.screenY,
      showCounter: target.showCounter,
      startIndexInclusive: target.startIndexInclusive,
      tagLabel: target.tagLabel,
    };
  }

  if (!current || current.targetId !== target.id) {
    return {
      animalInstanceId: target.animalInstanceId ?? null,
      bucketTotalMemoryCount: target.bucketTotalMemoryCount,
      entries: [...entries],
      interactionNonce: info.interactionNonce,
      memoryIndex: 0,
      screenX: target.screenX,
      screenY: target.screenY,
      showCounter: target.showCounter,
      startIndexInclusive: target.startIndexInclusive,
      tagLabel: target.tagLabel,
      targetId: target.id,
    };
  }

  return {
    ...current,
    animalInstanceId: target.animalInstanceId ?? null,
    bucketTotalMemoryCount: target.bucketTotalMemoryCount,
    entries: [...entries],
    interactionNonce: info.interactionNonce,
    memoryIndex:
      info.interactionNonce > current.interactionNonce
        ? (current.memoryIndex + 1) % entries.length
        : Math.min(current.memoryIndex, entries.length - 1),
    screenX: target.screenX,
    screenY: target.screenY,
    showCounter: target.showCounter,
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
