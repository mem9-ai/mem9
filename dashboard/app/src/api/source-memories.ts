import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import {
  patchSyncState,
  readCachedMemories,
  readSyncState,
  upsertCachedMemories,
} from "./local-cache";
import { sortMemoriesByCreatedAtDesc } from "@/lib/memory-filters";
import type { Memory } from "@/types/memory";

const PAGE_SIZE = 200;

export function getSourceMemoriesQueryKey(spaceId: string): string[] {
  return ["space", spaceId, "sourceMemories"];
}

export async function syncAllMemories(spaceId: string): Promise<Memory[]> {
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

  await upsertCachedMemories(spaceId, all);
  await patchSyncState(spaceId, {
    hasFullCache: true,
    lastSyncedAt: new Date().toISOString(),
  });

  return sortMemoriesByCreatedAtDesc(all);
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
