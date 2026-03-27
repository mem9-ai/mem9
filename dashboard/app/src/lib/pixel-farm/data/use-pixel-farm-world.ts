import { useEffect, useMemo, useRef, useState } from "react";
import { readCachedMemories } from "@/api/local-cache";
import {
  buildLocalDerivedSignalIndex,
  getCombinedTagsForMemory,
} from "@/lib/memory-derived-signals";
import { createPixelFarmMemoryStore } from "@/lib/pixel-farm/data/memory-store";
import { buildPixelFarmWorldState } from "@/lib/pixel-farm/data/memory-to-world";
import { loadInitialSnapshot } from "@/lib/pixel-farm/data/source";
import { normalizeTagSignal } from "@/lib/tag-signals";
import type { PixelFarmWorldQueryState } from "@/lib/pixel-farm/data/types";
import type { Memory } from "@/types/memory";

function indexMemoriesById(memories: readonly Memory[]): Record<string, Memory> {
  return Object.fromEntries(memories.map((memory) => [memory.id, memory]));
}

function cloneMemory(memory: Memory): Memory {
  return {
    ...memory,
    metadata: memory.metadata ? { ...memory.metadata } : null,
    tags: [...memory.tags],
  };
}

function sortMemoriesByUpdatedAtDesc(memories: readonly Memory[]): Memory[] {
  return [...memories].sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

function filterInteractionMemoriesByTag(
  memories: readonly Memory[],
  tagKey: string,
): Memory[] {
  if (!tagKey) {
    return [];
  }

  const signalIndex = buildLocalDerivedSignalIndex({ memories: [...memories] });

  return sortMemoriesByUpdatedAtDesc(
    memories.filter((memory) =>
      getCombinedTagsForMemory(memory, signalIndex).some(
        (tag) => normalizeTagSignal(tag) === tagKey,
      )),
  ).map(cloneMemory);
}

export function usePixelFarmWorld(spaceId: string): PixelFarmWorldQueryState {
  const storeRef = useRef(createPixelFarmMemoryStore());
  const interactionMemoryCacheRef = useRef(new Map<string, Memory[]>());
  const [state, setState] = useState<PixelFarmWorldQueryState>({
    error: null,
    memoryById: {},
    resolveInteractionMemories: async () => [],
    status: "idle",
    worldState: null,
  });

  const resolveInteractionMemories = useMemo(
    () => async (tagKey: string): Promise<Memory[]> => {
      const normalizedTagKey = normalizeTagSignal(tagKey);
      if (!normalizedTagKey) {
        return [];
      }

      const cached = interactionMemoryCacheRef.current.get(normalizedTagKey);
      if (cached) {
        return cached.map(cloneMemory);
      }

      const cachedMemories = await readCachedMemories(spaceId);
      const activeMemories = cachedMemories.filter((memory) => memory.state === "active");
      const matchedMemories = filterInteractionMemoriesByTag(activeMemories, normalizedTagKey);
      interactionMemoryCacheRef.current.set(normalizedTagKey, matchedMemories);
      return matchedMemories.map(cloneMemory);
    },
    [spaceId],
  );

  useEffect(() => {
    let cancelled = false;
    interactionMemoryCacheRef.current.clear();

    setState({
      error: null,
      memoryById: {},
      resolveInteractionMemories,
      status: "loading",
      worldState: null,
    });

    void loadInitialSnapshot(spaceId)
      .then((snapshot) => {
        if (cancelled) {
          return;
        }

        storeRef.current.replaceAll(snapshot.memories);
        const storeSnapshot = storeRef.current.readSnapshot();
        const worldState = buildPixelFarmWorldState({
          fetchedAt: snapshot.fetchedAt,
          memories: storeSnapshot.memories,
          recentEvents: storeSnapshot.recentEvents,
          spaceId,
          seedTags: snapshot.seedTags,
          totalMemories: snapshot.totalMemories,
        });

        setState({
          error: null,
          memoryById: indexMemoriesById(storeSnapshot.memories),
          resolveInteractionMemories,
          status: "ready",
          worldState,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setState({
          error: error instanceof Error ? error.message : String(error),
          memoryById: {},
          resolveInteractionMemories,
          status: "error",
          worldState: null,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [resolveInteractionMemories, spaceId]);

  return state;
}
