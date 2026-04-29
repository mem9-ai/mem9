import {
  buildLocalDerivedSignalIndex,
  getCombinedTagsForMemory,
} from "@/lib/memory-derived-signals";
import {
  PIXEL_FARM_CROP_BUCKET_PALETTES,
  PIXEL_FARM_TOP_CROP_TAG_COUNT,
  type PixelFarmCropStage,
} from "@/lib/pixel-farm/palette";
import {
  collectPixelFarmTilledCells,
  derivePixelFarmFieldLayouts,
} from "@/lib/pixel-farm/field-layout";
import { filterLowSignalAggregationTags, normalizeTagSignal } from "@/lib/tag-signals";
import type { Memory } from "@/types/memory";
import type {
  PixelFarmDeltaEvent,
  PixelFarmMemoryBucketState,
  PixelFarmNpcState,
  PixelFarmPlantState,
  PixelFarmSeedTag,
  PixelFarmWorldState,
} from "@/lib/pixel-farm/data/types";

const MAX_BUCKET_PLANT_COUNT = 6;
const MAX_BUCKET_PLANT_GROUP_SIZE = 10;

interface BuildPixelFarmWorldStateInput {
  fetchedAt: string;
  memories: Memory[];
  recentEvents: PixelFarmDeltaEvent[];
  spaceId: string;
  seedTags?: PixelFarmSeedTag[];
  totalMemories?: number;
}

interface TagStat {
  count: number;
  label: string;
  normalized: string;
}

function stageForFillRatio(fillRatio: number): PixelFarmCropStage {
  if (fillRatio >= 1) {
    return "mature";
  }
  if (fillRatio >= 0.75) {
    return "growing";
  }
  if (fillRatio >= 0.5) {
    return "sprout";
  }
  return "seed";
}

function collectCandidateTags(memories: Memory[]): TagStat[] {
  const tagStats = new Map<string, { count: number; label: string }>();

  for (const memory of memories) {
    const uniqueTags = new Set<string>();

    for (const tag of filterLowSignalAggregationTags(memory.tags)) {
      const normalized = normalizeTagSignal(tag);
      if (!normalized || uniqueTags.has(normalized)) {
        continue;
      }

      uniqueTags.add(normalized);

      const existing = tagStats.get(normalized);
      if (existing) {
        existing.count += 1;
        continue;
      }

      tagStats.set(normalized, {
        count: 1,
        label: tag.trim(),
      });
    }
  }

  return [...tagStats.entries()]
    .map(([normalized, stat]) => ({
      normalized,
      label: stat.label,
      count: stat.count,
    }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }

      return left.label.localeCompare(right.label);
    });
}

function createTagStatFromSeedTag(seedTag: PixelFarmSeedTag): TagStat | null {
  const normalized = normalizeTagSignal(seedTag.key);
  const label = seedTag.label.trim();
  if (!normalized || !label) {
    return null;
  }

  return {
    normalized,
    label,
    count: seedTag.count,
  };
}

function selectTopRankedTags(
  memories: Memory[],
  seedTags: PixelFarmSeedTag[] = [],
  limit = PIXEL_FARM_TOP_CROP_TAG_COUNT,
): TagStat[] {
  const selected = new Map<string, TagStat>();

  for (const seedTag of seedTags) {
    const tag = createTagStatFromSeedTag(seedTag);
    if (!tag || selected.has(tag.normalized)) {
      continue;
    }

    selected.set(tag.normalized, tag);
    if (selected.size >= limit) {
      return [...selected.values()];
    }
  }

  for (const tag of collectCandidateTags(memories)) {
    if (selected.has(tag.normalized)) {
      continue;
    }

    selected.set(tag.normalized, tag);
    if (selected.size >= limit) {
      break;
    }
  }

  return [...selected.values()];
}

function compareMemoryRecency(left: Memory, right: Memory): number {
  const leftTime = left.updated_at || left.created_at;
  const rightTime = right.updated_at || right.created_at;

  return rightTime.localeCompare(leftTime) || left.id.localeCompare(right.id);
}

function roundPlantCapacity(value: number): number {
  return Math.max(1, Math.ceil(value / MAX_BUCKET_PLANT_GROUP_SIZE) * MAX_BUCKET_PLANT_GROUP_SIZE);
}

function sliceBucketIntoPlants(
  bucketId: string,
  sortedMemoryIds: readonly string[],
  plantCapacity: number,
): PixelFarmPlantState[] {
  const plants: PixelFarmPlantState[] = [];

  for (
    let startIndex = 0;
    startIndex < sortedMemoryIds.length && plants.length < MAX_BUCKET_PLANT_COUNT;
    startIndex += plantCapacity
  ) {
    const memoryIds = sortedMemoryIds.slice(startIndex, startIndex + plantCapacity);
    const fillRatio = memoryIds.length / plantCapacity;

    plants.push({
      id: `${bucketId}-plant-${plants.length}`,
      cropStage: stageForFillRatio(fillRatio),
      endIndexExclusive: startIndex + memoryIds.length,
      fillRatio,
      memoryCount: memoryIds.length,
      memoryIds: [...memoryIds],
      startIndexInclusive: startIndex,
    });
  }

  return plants;
}

function buildMemoryBuckets(
  rankedTags: readonly TagStat[],
  memoriesByTag: ReadonlyMap<string, Memory[]>,
): PixelFarmMemoryBucketState[] {
  const maxBucketMemoryCount = rankedTags.reduce((max, tag) => {
    const tagMemoryCount = memoriesByTag.get(tag.normalized)?.length ?? 0;

    return Math.max(max, tagMemoryCount);
  }, 0);

  if (maxBucketMemoryCount <= 0) {
    return [];
  }

  const plantCapacity = roundPlantCapacity(
    Math.ceil(maxBucketMemoryCount / MAX_BUCKET_PLANT_COUNT),
  );

  return rankedTags
    .map<PixelFarmMemoryBucketState | null>((tag, index) => {
      const tagMemories = [...(memoriesByTag.get(tag.normalized) ?? [])].sort(compareMemoryRecency);
      if (tagMemories.length < 1) {
        return null;
      }

      const sortedMemoryIds = tagMemories.map((memory) => memory.id);
      const bucketId = `memory-bucket-${tag.normalized}`;
      const plants = sliceBucketIntoPlants(bucketId, sortedMemoryIds, plantCapacity);
      const cropFamily =
        PIXEL_FARM_CROP_BUCKET_PALETTES[index]?.family ??
        PIXEL_FARM_CROP_BUCKET_PALETTES[PIXEL_FARM_CROP_BUCKET_PALETTES.length - 1]!.family;

      return {
        id: bucketId,
        cropFamily,
        plantCapacity,
        plantCount: plants.length,
        plants,
        rank: index + 1,
        sortedMemoryIds,
        tagKey: tag.normalized,
        tagLabel: tag.label,
        totalMemoryCount: sortedMemoryIds.length,
      };
    })
    .filter((bucket): bucket is PixelFarmMemoryBucketState => bucket !== null);
}

function buildDefaultNpcs(): PixelFarmNpcState[] {
  return [
    {
      id: "npc-cow-1",
      kind: "cow",
      position: null,
    },
    {
      id: "npc-cow-2",
      kind: "cow",
      position: null,
    },
    {
      id: "npc-baby-cow-1",
      kind: "baby-cow",
      position: null,
    },
    {
      id: "npc-baby-cow-2",
      kind: "baby-cow",
      position: null,
    },
    {
      id: "npc-chicken-1",
      kind: "chicken",
      position: null,
    },
    {
      id: "npc-chicken-2",
      kind: "chicken",
      position: null,
    },
    {
      id: "npc-chicken-3",
      kind: "chicken",
      position: null,
    },
    {
      id: "npc-chicken-4",
      kind: "chicken",
      position: null,
    },
  ];
}

export function buildPixelFarmWorldState({
  fetchedAt,
  memories,
  recentEvents,
  spaceId,
  seedTags = [],
  totalMemories,
}: BuildPixelFarmWorldStateInput): PixelFarmWorldState {
  const fields = derivePixelFarmFieldLayouts(collectPixelFarmTilledCells());
  const maxBucketCount = Math.min(
    PIXEL_FARM_CROP_BUCKET_PALETTES.length,
    Math.floor(fields.mainField.cells.length / MAX_BUCKET_PLANT_COUNT),
  );
  const signalIndex = buildLocalDerivedSignalIndex({ memories });
  const rankedTags =
    maxBucketCount > 0
      ? selectTopRankedTags(
          memories,
          seedTags,
          Math.min(maxBucketCount, PIXEL_FARM_TOP_CROP_TAG_COUNT),
        )
      : [];
  const memoriesByTag = new Map<string, Memory[]>();

  for (const tag of rankedTags) {
    memoriesByTag.set(tag.normalized, []);
  }

  for (const memory of memories) {
    const normalizedTags = new Set(
      getCombinedTagsForMemory(memory, signalIndex)
        .map((tag) => normalizeTagSignal(tag))
        .filter(Boolean),
    );

    for (const normalizedTag of normalizedTags) {
      memoriesByTag.get(normalizedTag)?.push(memory);
    }
  }

  const memoryBuckets = buildMemoryBuckets(rankedTags, memoriesByTag);

  return {
    activeSpaceId: spaceId,
    fetchedAt,
    fields,
    memoryBuckets,
    npcs: buildDefaultNpcs(),
    recentEvents: [...recentEvents],
    totalMemories: totalMemories ?? memories.length,
  };
}
