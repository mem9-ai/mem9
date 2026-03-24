import { useEffect, useRef, useState } from "react";
import { createPixelFarmMemoryStore } from "@/lib/pixel-farm/data/memory-store";
import { buildPixelFarmWorldState } from "@/lib/pixel-farm/data/memory-to-world";
import { loadInitialSnapshot } from "@/lib/pixel-farm/data/source-mock";
import type { PixelFarmWorldQueryState } from "@/lib/pixel-farm/data/types";

export function usePixelFarmWorld(spaceId: string): PixelFarmWorldQueryState {
  const storeRef = useRef(createPixelFarmMemoryStore());
  const [state, setState] = useState<PixelFarmWorldQueryState>({
    error: null,
    status: "idle",
    worldState: null,
  });

  useEffect(() => {
    let cancelled = false;

    setState({
      error: null,
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
        });

        setState({
          error: null,
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
