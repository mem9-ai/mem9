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

const PAGE_SIZE = 200;
const activeSyncs = new Map<string, Promise<Memory[]>>();
/**
 * Tracks which spaces have been synced from the API in the current page session.
 * On page refresh the module reloads and this set is empty, forcing a fresh
 * API sync instead of serving potentially stale IndexedDB data.
 */
const sessionSyncedSpaces = new Set<string>();

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

    while (offset < total) {
      const page = await api.listMemories(spaceId, {
        limit: PAGE_SIZE,
        offset,
      });
      all.push(...page.memories);
      total = page.total;
      offset += page.limit;
    }

    await clearCachedMemoriesForSpace(spaceId);
    await upsertCachedMemories(spaceId, all);
    await patchSyncState(spaceId, {
      hasFullCache: true,
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

  if (syncState?.hasFullCache && sessionSyncedSpaces.has(spaceId)) {
    return sortMemoriesByCreatedAtDesc(cached);
  }

  const memories = await syncAllMemories(spaceId);
  sessionSyncedSpaces.add(spaceId);
  return memories;
}

export function useSourceMemories(
  spaceId: string,
  refreshToken = 0,
) {
  return useQuery({
    queryKey: [...getSourceMemoriesQueryKey(spaceId), refreshToken],
    queryFn: () => loadSourceMemories(spaceId),
    enabled: !!spaceId,
    staleTime: 30_000,
    retry: 1,
  });
}
