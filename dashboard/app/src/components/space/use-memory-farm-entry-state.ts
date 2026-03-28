import { useQuery } from "@tanstack/react-query";
import { readSyncState, readCachedAnalysisResult } from "@/api/local-cache";
import type { SpaceAnalysisState } from "@/types/analysis";
import { shouldStopPollingSnapshot } from "@/api/analysis-queries";

export type MemoryFarmEntryStatus = "ready" | "preparing" | "unavailable";

export async function resolveMemoryFarmEntryStatus(input: {
  spaceId: string;
  isSourceMemoriesLoading: boolean;
  currentAnalysisState: SpaceAnalysisState;
  currentRange: string;
}): Promise<MemoryFarmEntryStatus> {
  if (!input.spaceId) {
    return "preparing";
  }

  if (input.isSourceMemoriesLoading) {
    return "preparing";
  }

  const syncState = await readSyncState(input.spaceId);
  if (!syncState?.hasFullCache) {
    return "preparing";
  }

  let allSnapshot = null;
  let allPhase = null;

  if (input.currentRange === "all") {
    allSnapshot = input.currentAnalysisState.snapshot;
    allPhase = input.currentAnalysisState.phase;
  } else {
    try {
      const cachedAnalysis = await readCachedAnalysisResult(input.spaceId, "all");
      allSnapshot = cachedAnalysis?.snapshot;
    } catch {
      allSnapshot = null;
    }
  }

  if (allSnapshot && shouldStopPollingSnapshot(allSnapshot)) {
    return "ready";
  }

  if (input.currentRange === "all" && (allPhase === "failed" || allPhase === "degraded")) {
    return "unavailable";
  }

  return "preparing";
}

export function useMemoryFarmEntryState(
  spaceId: string,
  isSourceMemoriesLoading: boolean,
  currentAnalysisState: SpaceAnalysisState,
  currentRange: string,
): MemoryFarmEntryStatus {
  const query = useQuery({
    queryKey: [
      "space",
      spaceId,
      "memory-farm-entry-state",
      currentRange,
      isSourceMemoriesLoading,
      currentAnalysisState.phase,
      currentAnalysisState.snapshot?.status ?? "none",
      currentAnalysisState.snapshot?.jobId ?? "none",
    ],
    queryFn: () =>
      resolveMemoryFarmEntryStatus({
        spaceId,
        isSourceMemoriesLoading,
        currentAnalysisState,
        currentRange,
      }),
    enabled: !!spaceId,
    initialData: "preparing" as MemoryFarmEntryStatus,
    refetchInterval: (currentQuery) =>
      currentQuery.state.data === "preparing" ? 2000 : false,
  });

  return query.data;
}
