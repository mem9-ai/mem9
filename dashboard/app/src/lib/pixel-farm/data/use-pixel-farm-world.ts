import { useEffect, useRef, useState } from "react";
import { createPixelFarmMemoryStore } from "@/lib/pixel-farm/data/memory-store";
import { buildPixelFarmWorldState } from "@/lib/pixel-farm/data/memory-to-world";
import { loadInitialSnapshot } from "@/lib/pixel-farm/data/source";
import type { PixelFarmWorldQueryState } from "@/lib/pixel-farm/data/types";
import type { Memory } from "@/types/memory";

function indexMemoriesById(memories: readonly Memory[]): Record<string, Memory> {
  return Object.fromEntries(memories.map((memory) => [memory.id, memory]));
}

export function usePixelFarmWorld(spaceId: string): PixelFarmWorldQueryState {
  const storeRef = useRef(createPixelFarmMemoryStore());
  const [state, setState] = useState<PixelFarmWorldQueryState>({
    error: null,
    memoryById: {},
    status: "idle",
    worldState: null,
  });

  useEffect(() => {
    let cancelled = false;

    setState({
      error: null,
      memoryById: {},
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
          status: "error",
          worldState: null,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  return state;
}
