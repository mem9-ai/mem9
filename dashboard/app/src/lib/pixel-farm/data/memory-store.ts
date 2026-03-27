import type { Memory } from "@/types/memory";
import type {
  PixelFarmDeltaBatch,
  PixelFarmDeltaEvent,
} from "@/lib/pixel-farm/data/types";

export interface PixelFarmMemoryStoreSnapshot {
  cursor: string | null;
  memories: Memory[];
  recentEvents: PixelFarmDeltaEvent[];
}

export interface PixelFarmMemoryStore {
  applyDelta: (batch: PixelFarmDeltaBatch) => void;
  readSnapshot: () => PixelFarmMemoryStoreSnapshot;
  replaceAll: (memories: Memory[]) => void;
}

function compareByUpdatedAtDesc(left: Memory, right: Memory): number {
  return right.updated_at.localeCompare(left.updated_at);
}

export function createPixelFarmMemoryStore(): PixelFarmMemoryStore {
  let cursor: string | null = null;
  let recentEvents: PixelFarmDeltaEvent[] = [];
  const memoryById = new Map<string, Memory>();

  function upsertMemory(memory: Memory): void {
    if (memory.state !== "active") {
      memoryById.delete(memory.id);
      return;
    }

    memoryById.set(memory.id, {
      ...memory,
      metadata: memory.metadata ? { ...memory.metadata } : null,
      tags: [...memory.tags],
    });
  }

  return {
    applyDelta(batch: PixelFarmDeltaBatch): void {
      cursor = batch.cursor;
      recentEvents = [...batch.events];

      for (const event of batch.events) {
        if (event.type === "upsert" && event.memory) {
          upsertMemory(event.memory);
          continue;
        }

        memoryById.delete(event.memoryId);
      }
    },

    readSnapshot(): PixelFarmMemoryStoreSnapshot {
      return {
        cursor,
        memories: [...memoryById.values()].sort(compareByUpdatedAtDesc),
        recentEvents: [...recentEvents],
      };
    },

    replaceAll(memories: Memory[]): void {
      cursor = null;
      recentEvents = [];
      memoryById.clear();

      for (const memory of memories) {
        upsertMemory(memory);
      }
    },
  };
}

