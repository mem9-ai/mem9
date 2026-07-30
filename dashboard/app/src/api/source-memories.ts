import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import {
  clearCachedMemoriesForSpace,
  patchSyncState,
  readCachedMemories,
  readSyncState,
  upsertCachedMemories,
} from "./local-cache";
import { sortMemoriesByCreatedAtDesc } from "@/lib/memory-filters";
import type { Memory } from "@/types/memory";

export const SOURCE_MEMORY_SYNC_BUDGET = {
  pageSize: 200,
  maxPages: 5,
  maxRecords: 1_000,
} as const;
const activeSyncs = new Map<string, Promise<Memory[]>>();

export function getSourceMemoriesQueryKey(spaceId: string): string[] {
  return ["space", spaceId, "sourceMemories"];
}

export async function syncAllMemories(spaceId: string): Promise<Memory[]> {
  const existing = activeSyncs.get(spaceId);
  if (existing) {
    return existing;
  }

  const syncRun = (async () => {
    const all: Memory[] = [];
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;
    let pagesFetched = 0;

    while (
      offset < total &&
      pagesFetched < SOURCE_MEMORY_SYNC_BUDGET.maxPages &&
      all.length < SOURCE_MEMORY_SYNC_BUDGET.maxRecords
    ) {
      const limit = Math.min(
        SOURCE_MEMORY_SYNC_BUDGET.pageSize,
        SOURCE_MEMORY_SYNC_BUDGET.maxRecords - all.length,
      );
      const page = await api.listMemories(spaceId, {
        limit,
        offset,
      });
      all.push(
        ...page.memories.slice(
          0,
          SOURCE_MEMORY_SYNC_BUDGET.maxRecords - all.length,
        ),
      );
      total = page.total;
      pagesFetched += 1;
      offset += page.memories.length;

      if (page.memories.length === 0) {
        break;
      }
    }

    const hasFullCache = all.length >= total;
    await clearCachedMemoriesForSpace(spaceId);
    await upsertCachedMemories(spaceId, all);
    await patchSyncState(spaceId, {
      hasFullCache,
      lastSyncedAt: new Date().toISOString(),
      incrementalCursor: null,
    });

    return sortMemoriesByCreatedAtDesc(all);
  })();

  activeSyncs.set(spaceId, syncRun);

  try {
    return await syncRun;
  } finally {
    if (activeSyncs.get(spaceId) === syncRun) {
      activeSyncs.delete(spaceId);
    }
  }
}

export async function loadSourceMemories(spaceId: string): Promise<Memory[]> {
  const [cached, syncState] = await Promise.all([
    readCachedMemories(spaceId),
    readSyncState(spaceId),
  ]);

  if (syncState?.hasFullCache) {
    return sortMemoriesByCreatedAtDesc(cached);
  }

  return syncAllMemories(spaceId);
}

export function useSourceMemories(
  spaceId: string,
  {
    enabled = true,
    refreshToken = 0,
  }: {
    enabled?: boolean;
    refreshToken?: number;
  } = {},
) {
  return useQuery({
    queryKey: [...getSourceMemoriesQueryKey(spaceId), refreshToken],
    queryFn: () => loadSourceMemories(spaceId),
    enabled: enabled && !!spaceId,
    staleTime: 30_000,
    retry: 1,
  });
}
