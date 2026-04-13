import {
  readCachedAnalysisResult,
  readCachedMemories,
} from "@/api/local-cache";
import { filterLowSignalAggregationTags, normalizeTagSignal } from "@/lib/tag-signals";
import type { AnalysisFacetStat, AnalysisJobSnapshotResponse } from "@/types/analysis";
import type { Memory } from "@/types/memory";
import type {
  PixelFarmDeltaBatch,
  PixelFarmInitialSnapshot,
  PixelFarmSeedTag,
} from "@/lib/pixel-farm/data/types";

const ANALYSIS_RANGE = "all" as const;

function cloneMemory(memory: Memory): Memory {
  return {
    ...memory,
    metadata: memory.metadata ? { ...memory.metadata } : null,
    tags: [...memory.tags],
  };
}

function compareMemoryRecency(
  left: Pick<Memory, "created_at" | "id" | "updated_at">,
  right: Pick<Memory, "created_at" | "id" | "updated_at">,
): number {
  const leftTime = left.updated_at || left.created_at;
  const rightTime = right.updated_at || right.created_at;

  return rightTime.localeCompare(leftTime) || left.id.localeCompare(right.id);
}

function sortByRecencyDesc<T extends Pick<Memory, "created_at" | "id" | "updated_at">>(
  items: T[],
): T[] {
  return [...items].sort((left, right) =>
    compareMemoryRecency(left, right),
  );
}

function normalizeSeedTagLabel(label: string): { key: string; label: string } | null {
  const filtered = filterLowSignalAggregationTags([label]);
  const normalizedLabel = filtered[0];
  if (!normalizedLabel) {
    return null;
  }

  return {
    key: normalizeTagSignal(normalizedLabel),
    label: normalizedLabel,
  };
}

function sortSeedTags(seedTags: PixelFarmSeedTag[]): PixelFarmSeedTag[] {
  return [...seedTags].sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }

    return left.label.localeCompare(right.label);
  });
}

function buildSeedTagsFromFacetStats(
  stats: AnalysisFacetStat[],
): PixelFarmSeedTag[] {
  const seedTags = new Map<string, PixelFarmSeedTag>();

  for (const stat of stats) {
    const normalizedTag = normalizeSeedTagLabel(stat.value);
    if (!normalizedTag) {
      continue;
    }

    const existing = seedTags.get(normalizedTag.key);
    if (existing) {
      existing.count += stat.count;
      continue;
    }

    seedTags.set(normalizedTag.key, {
      key: normalizedTag.key,
      label: normalizedTag.label,
      count: stat.count,
    });
  }

  return sortSeedTags([...seedTags.values()]);
}

function buildSeedTagsFromTagCounts(
  tagCounts: Record<string, number>,
): PixelFarmSeedTag[] {
  const stats = Object.entries(tagCounts).map<AnalysisFacetStat>(([value, count]) => ({
    value,
    count,
  }));
  return buildSeedTagsFromFacetStats(stats);
}

function buildSeedTags(
  snapshot: AnalysisJobSnapshotResponse | null | undefined,
): PixelFarmSeedTag[] {
  if (!snapshot) {
    return [];
  }

  if (snapshot.topTagStats && snapshot.topTagStats.length > 0) {
    return buildSeedTagsFromFacetStats(snapshot.topTagStats);
  }

  return buildSeedTagsFromTagCounts(snapshot.aggregate.tagCounts);
}

async function loadCachedSeedMemories(spaceId: string): Promise<Memory[]> {
  const cachedMemories = await readCachedMemories(spaceId);

  return sortByRecencyDesc(cachedMemories)
    .filter((memory) => memory.state === "active")
    .map(cloneMemory);
}

export async function loadInitialSnapshot(
  spaceId: string,
): Promise<PixelFarmInitialSnapshot> {
  const [memories, cachedAnalysisResult] = await Promise.all([
    loadCachedSeedMemories(spaceId),
    readCachedAnalysisResult(spaceId, ANALYSIS_RANGE),
  ]);
  const snapshot = cachedAnalysisResult?.snapshot;

  return {
    fetchedAt: new Date().toISOString(),
    memories,
    seedTags: buildSeedTags(snapshot),
    totalMemories: snapshot?.expectedTotalMemories ?? memories.length,
  };
}

export async function pollDelta(
  _spaceId: string,
  _previousMemories: readonly Memory[],
  cursor: string | null,
): Promise<PixelFarmDeltaBatch> {
  return {
    cursor,
    polledAt: new Date().toISOString(),
    events: [],
  };
}
