import { useState, useEffect } from "react";
import { readSyncState, readCachedAnalysisResult } from "@/api/local-cache";
import type { SpaceAnalysisState } from "@/types/analysis";
import { shouldStopPollingSnapshot } from "@/api/analysis-queries";

export type MemoryFarmEntryStatus = "ready" | "preparing" | "unavailable";

export function useMemoryFarmEntryState(
  spaceId: string,
  isSourceMemoriesLoading: boolean,
  currentAnalysisState: SpaceAnalysisState,
  currentRange: string
) {
  const [status, setStatus] = useState<MemoryFarmEntryStatus>("preparing");

  useEffect(() => {
    let mounted = true;

    async function checkState() {
      if (!spaceId) return;

      if (isSourceMemoriesLoading) {
        if (mounted) setStatus("preparing");
        return;
      }

      const syncState = await readSyncState(spaceId);
      if (!syncState?.hasFullCache) {
        if (mounted) setStatus("preparing");
        return;
      }

      let allSnapshot = null;
      let allPhase = null;

      if (currentRange === "all") {
        allSnapshot = currentAnalysisState.snapshot;
        allPhase = currentAnalysisState.phase;
      } else {
        try {
          const cachedAnalysis = await readCachedAnalysisResult(spaceId, "all");
          allSnapshot = cachedAnalysis?.snapshot;
        } catch {
          // ignore cache read errors
        }
      }

      if (allSnapshot && shouldStopPollingSnapshot(allSnapshot)) {
        if (mounted) setStatus("ready");
      } else {
        if (currentRange === "all" && (allPhase === "failed" || allPhase === "degraded")) {
          if (mounted) setStatus("unavailable");
        } else {
          if (mounted) setStatus("preparing");
        }
      }
    }

    checkState();

    const interval = window.setInterval(checkState, 2000);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [spaceId, isSourceMemoriesLoading, currentAnalysisState, currentRange]);

  return status;
}
