import {
  buildLocalDerivedSignalIndex,
  getCombinedTagsForMemory,
} from "@/lib/memory-derived-signals";
import {
  PIXEL_FARM_CROP_BUCKET_PALETTES,
  PIXEL_FARM_MAIN_FIELD_COUNT,
  PIXEL_FARM_TOP_CROP_TAG_COUNT,
  type PixelFarmCropStage,
} from "@/lib/pixel-farm/palette";
import { filterLowSignalAggregationTags, normalizeTagSignal } from "@/lib/tag-signals";
import type { Memory } from "@/types/memory";
import type {
  PixelFarmAnimalBucketState,
  PixelFarmCropBucketState,
  PixelFarmCategoryState,
  PixelFarmWorldState,
  PixelFarmDeltaEvent,
  PixelFarmRoleState,
  PixelFarmSeedTag,
} from "@/lib/pixel-farm/data/types";

const CATEGORY_OTHER_KEY = "other";
const BUCKET_CAPACITY = 4;
const MAX_BUCKET_COUNT = 6;
const MAX_CROP_INSTANCE_COUNT = 6;
const CROP_BUCKETS_PER_PLOT = [1, 1, 1, 1, 1] as const;
const MAX_ANIMAL_BUCKET_COUNT = 3;
const CROP_TAG_LIMIT = 13;
const MIN_ANIMAL_INSTANCE_COUNT = 4;
const MAX_ANIMAL_INSTANCE_COUNT = 8;

interface BuildPixelFarmWorldStateInput {
  fetchedAt: string;
  memories: Memory[];
  recentEvents: PixelFarmDeltaEvent[];
  spaceId: string;
  seedTags?: PixelFarmSeedTag[];
  totalMemories?: number;
}

interface CategoryAccumulator {
  key: string;
  kind: "main" | "other";
  label: string;
  memories: Memory[];
  plotIndex: number;
  seedCount: number | null;
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

function pickPrimaryCategoryKey(
  tags: readonly string[],
  topCategoryKeys: Set<string>,
): string {
  for (const tag of filterLowSignalAggregationTags([...tags])) {
    const normalized = normalizeTagSignal(tag);
    if (topCategoryKeys.has(normalized)) {
      return normalized;
    }
  }

  return CATEGORY_OTHER_KEY;
}

function buildBuckets(totalCount: number, fixedBucketCount?: number) {
  if (totalCount <= 0) {
    return [];
  }

  const cappedCount = Math.min(
    totalCount,
    BUCKET_CAPACITY * (fixedBucketCount ?? MAX_BUCKET_COUNT),
  );
  const bucketCount =
    fixedBucketCount !== undefined
      ? Math.max(1, fixedBucketCount)
      : Math.min(
          MAX_BUCKET_COUNT,
          Math.max(1, Math.ceil(cappedCount / BUCKET_CAPACITY)),
        );
  const baseCount = Math.floor(cappedCount / bucketCount);
  const remainder = cappedCount % bucketCount;

  return Array.from({ length: bucketCount }, (_, index) => {
    const count = baseCount + (index < remainder ? 1 : 0);
    const fillRatio = Math.min(1, count / BUCKET_CAPACITY);

    return {
      id: `bucket-${index}`,
      active: count > 0,
      count,
      fillRatio,
      stage: stageForFillRatio(fillRatio),
    };
  });
}

function resolveOtherCategoryCount(
  sampleCount: number,
  totalMemories: number | undefined,
  mainCategorySeedTotal: number,
  hasSeedTags: boolean,
): number {
  if (!hasSeedTags || totalMemories === undefined) {
    return sampleCount;
  }

  if (mainCategorySeedTotal > totalMemories) {
    return sampleCount;
  }

  return Math.max(sampleCount, totalMemories - mainCategorySeedTotal);
}

function dominantAgentId(memories: Memory[]): string | null {
  const counts = new Map<string, number>();

  for (const memory of memories) {
    const agentId = memory.agent_id.trim();
    if (!agentId) {
      continue;
    }

    counts.set(agentId, (counts.get(agentId) ?? 0) + 1);
  }

  const ranked = [...counts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }

    return left[0].localeCompare(right[0]);
  });

  return ranked[0]?.[0] ?? null;
}

function resolveCropInstanceCount(totalCount: number, maxTagCount: number): number {
  if (totalCount <= 0) {
    return 0;
  }

  if (maxTagCount <= 0) {
    return 1;
  }

  return Math.max(
    1,
    Math.min(MAX_CROP_INSTANCE_COUNT, Math.ceil((totalCount / maxTagCount) * MAX_CROP_INSTANCE_COUNT)),
  );
}

function plotIndexForCropRank(rank: number): number {
  let remaining = rank;

  for (const [plotIndex, capacity] of CROP_BUCKETS_PER_PLOT.entries()) {
    if (remaining < capacity) {
      return plotIndex;
    }

    remaining -= capacity;
  }

  return CROP_BUCKETS_PER_PLOT.length - 1;
}

function buildCropBuckets(
  cropTags: TagStat[],
  memoriesByTag: Map<string, Memory[]>,
): PixelFarmCropBucketState[] {
  const maxTagCount = cropTags[0]?.count ?? 0;

  return cropTags.map((tag, index) => {
    const tagMemories = memoriesByTag.get(tag.normalized) ?? [];
    const totalCount = tag.count;
    const cropFamily =
      PIXEL_FARM_CROP_BUCKET_PALETTES[index]?.family ??
      PIXEL_FARM_CROP_BUCKET_PALETTES[PIXEL_FARM_CROP_BUCKET_PALETTES.length - 1]!.family;

    return {
      id: `crop-bucket-${tag.normalized}`,
      cropFamily,
      instances: buildBuckets(
        totalCount,
        resolveCropInstanceCount(totalCount, maxTagCount),
      ).map((instance, instanceIndex) => ({
        ...instance,
        id: `crop-bucket-${tag.normalized}-instance-${instanceIndex}`,
      })),
      memoryIds: tagMemories.map((memory) => memory.id),
      plotIndex: plotIndexForCropRank(index),
      rank: index + 1,
      tagKey: tag.normalized,
      tagLabel: tag.label,
      totalCount,
    };
  });
}

function buildAnimalBuckets(
  animalTags: TagStat[],
  memoriesByTag: Map<string, Memory[]>,
): PixelFarmAnimalBucketState[] {
  const cowTags = animalTags.slice(0, 2);
  const cowZoneCount = resolveAnimalInstanceCount(
    cowTags.reduce((sum, tag) => sum + tag.count, 0),
  );
  const cowInstanceCounts =
    cowTags.length === 2
      ? splitCowZoneInstanceCount(cowTags[0]!.count, cowTags[1]!.count, cowZoneCount)
      : cowTags.length === 1
        ? [cowZoneCount]
        : [];

  return animalTags.slice(0, MAX_ANIMAL_BUCKET_COUNT).map((tag, index) => {
    const tagMemories = memoriesByTag.get(tag.normalized) ?? [];
    const rank = CROP_TAG_LIMIT + index + 1;
    const tier = index === 0 ? "cow" : index === 1 ? "baby-cow" : "chicken";
    const instanceCount =
      tier === "chicken"
        ? resolveAnimalInstanceCount(tag.count)
        : cowInstanceCounts[index] ?? 0;

    return {
      id: `animal-bucket-${tag.normalized}`,
      instanceCount,
      memoryIds: tagMemories.map((memory) => memory.id),
      rank,
      tagKey: tag.normalized,
      tagLabel: tag.label,
      tier,
      totalCount: tag.count,
      zone: tier === "chicken" ? "chicken-pen" : "cow-pen",
    };
  });
}

function resolveAnimalInstanceCount(totalCount: number): number {
  if (totalCount <= 0) {
    return 0;
  }

  return Math.max(
    MIN_ANIMAL_INSTANCE_COUNT,
    Math.min(MAX_ANIMAL_INSTANCE_COUNT, totalCount),
  );
}

function splitCowZoneInstanceCount(
  cowCount: number,
  babyCowCount: number,
  totalInstances: number,
): [number, number] {
  if (totalInstances <= 1) {
    return [totalInstances, 0];
  }

  const totalCount = cowCount + babyCowCount;
  if (totalCount <= 0) {
    const cowInstances = Math.ceil(totalInstances * 0.5);
    return [cowInstances, totalInstances - cowInstances];
  }

  const weightedCowInstances = Math.round((cowCount / totalCount) * totalInstances);
  const cowInstances = Math.max(
    1,
    Math.min(totalInstances - 1, weightedCowInstances),
  );

  return [cowInstances, totalInstances - cowInstances];
}

function buildRoles(
  categories: PixelFarmCategoryState[],
  fetchedAt: string,
): PixelFarmRoleState[] {
  return categories
    .filter((category) => category.dominantAgentId)
    .map((category) => ({
      id: `role-${category.key}`,
      action: "idle",
      agentId: category.dominantAgentId ?? "farmer",
      categoryKey: category.key,
      updatedAt: fetchedAt,
    }));
}

export function buildPixelFarmWorldState({
  fetchedAt,
  memories,
  recentEvents,
  spaceId,
  seedTags = [],
  totalMemories,
}: BuildPixelFarmWorldStateInput): PixelFarmWorldState {
  const signalIndex = buildLocalDerivedSignalIndex({ memories });
  const rankedTags = selectTopRankedTags(
    memories,
    seedTags,
    PIXEL_FARM_TOP_CROP_TAG_COUNT + MAX_ANIMAL_BUCKET_COUNT,
  );
  const cropTags = rankedTags.slice(0, CROP_TAG_LIMIT);
  const animalTags = rankedTags.slice(CROP_TAG_LIMIT, CROP_TAG_LIMIT + MAX_ANIMAL_BUCKET_COUNT);
  const cropTagKeys = new Set(cropTags.map((tag) => tag.normalized));
  const assignedTagKeys = new Set(rankedTags.map((tag) => tag.normalized));
  const accumulators = new Map<string, CategoryAccumulator>();
  const memoriesByTag = new Map<string, Memory[]>();
  const hasSeedTags = seedTags.length > 0;

  for (const tag of rankedTags) {
    memoriesByTag.set(tag.normalized, []);
  }

  for (const [index, tag] of cropTags.entries()) {
    accumulators.set(tag.normalized, {
      key: tag.normalized,
      kind: "main",
      label: tag.label,
      memories: [],
      plotIndex: index,
      seedCount: tag.count,
    });
  }

  accumulators.set(CATEGORY_OTHER_KEY, {
    key: CATEGORY_OTHER_KEY,
    kind: "other",
    label: "Other",
    memories: [],
    plotIndex: PIXEL_FARM_MAIN_FIELD_COUNT,
    seedCount: null,
  });

  for (const memory of memories) {
    const combinedTags = getCombinedTagsForMemory(memory, signalIndex);
    const normalizedCombinedTags = new Set(
      combinedTags.map((tag) => normalizeTagSignal(tag)).filter(Boolean),
    );
    const tagKey = pickPrimaryCategoryKey(combinedTags, assignedTagKeys);

    for (const normalizedTag of normalizedCombinedTags) {
      memoriesByTag.get(normalizedTag)?.push(memory);
    }

    if (cropTagKeys.has(tagKey)) {
      accumulators.get(tagKey)?.memories.push(memory);
      continue;
    }

    if (tagKey === CATEGORY_OTHER_KEY) {
      accumulators.get(CATEGORY_OTHER_KEY)?.memories.push(memory);
    }
  }

  const assignedTagSeedTotal = rankedTags.reduce((sum, tag) => sum + tag.count, 0);
  const resolvedTotalMemories = totalMemories ?? memories.length;
  const cropBuckets = buildCropBuckets(cropTags, memoriesByTag);
  const animalBuckets = buildAnimalBuckets(animalTags, memoriesByTag);
  const categories = [...accumulators.values()]
    .map<PixelFarmCategoryState>((category) => {
      const resolvedCategoryCount =
        category.kind === "other"
          ? resolveOtherCategoryCount(
              category.memories.length,
              totalMemories,
              assignedTagSeedTotal,
              hasSeedTags,
            )
          : category.seedCount ?? category.memories.length;
      const cropFamily =
        category.kind === "main"
          ? PIXEL_FARM_CROP_BUCKET_PALETTES[category.plotIndex]?.family ?? null
          : null;
      const decorationFamilies: string[] = [];

      return {
        key: category.key,
        label: category.label,
        kind: category.kind,
        plotIndex: category.plotIndex,
        totalCount: resolvedCategoryCount,
        memoryIds: category.memories.map((memory) => memory.id),
        cropFamily,
        decorationFamilies,
        dominantAgentId: dominantAgentId(category.memories),
        buckets: buildBuckets(resolvedCategoryCount),
        animals: [],
      };
    })
    .sort((left, right) => left.plotIndex - right.plotIndex);

  return {
    fetchedAt,
    activeSpaceId: spaceId,
    animalBuckets,
    totalMemories: resolvedTotalMemories,
    cropBuckets,
    categories,
    roles: buildRoles(categories, fetchedAt),
    recentEvents: [...recentEvents],
  };
}
