import { mockMemories } from "@/api/mock-data";
import type { Memory } from "@/types/memory";
import type {
  PixelFarmDeltaBatch,
  PixelFarmInitialSnapshot,
} from "@/lib/pixel-farm/data/types";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function cloneMemory(memory: Memory): Memory {
  return {
    ...memory,
    metadata: memory.metadata ? { ...memory.metadata } : null,
    tags: [...memory.tags],
  };
}

export async function loadInitialSnapshot(
  _spaceId: string,
): Promise<PixelFarmInitialSnapshot> {
  await delay(180);

  return {
    fetchedAt: new Date().toISOString(),
    memories: mockMemories
      .filter((memory) => memory.state === "active")
      .map(cloneMemory),
  };
}

export async function pollDelta(
  _spaceId: string,
  cursor: string | null,
): Promise<PixelFarmDeltaBatch> {
  await delay(120);

  return {
    cursor,
    polledAt: new Date().toISOString(),
    events: [],
  };
}

