import {
  PIXEL_FARM_BUCKET_ANIMAL_PALETTES,
  PIXEL_FARM_MAIN_FIELD_COUNT,
  PIXEL_FARM_MAIN_FIELD_CROP_PALETTES,
  PIXEL_FARM_OTHER_ZONE_DECORATIONS,
  type PixelFarmBucketAnimalTier,
  type PixelFarmCropStage,
} from "@/lib/pixel-farm/palette";
import { filterLowSignalAggregationTags, normalizeTagSignal } from "@/lib/tag-signals";
import type { Memory } from "@/types/memory";
import type {
  PixelFarmCategoryState,
  PixelFarmRoleState,
  PixelFarmWorldState,
  PixelFarmDeltaEvent,
} from "@/lib/pixel-farm/data/types";

const CATEGORY_OTHER_KEY = "other";
const BUCKET_CAPACITY = 4;
const MAX_BUCKET_COUNT = 6;
const ANIMAL_THRESHOLDS: Array<{
  minimumCount: number;
  tier: PixelFarmBucketAnimalTier;
}> = [
  { minimumCount: 5, tier: "chicken" },
  { minimumCount: 9, tier: "baby-cow" },
  { minimumCount: 13, tier: "cow" },
];

interface BuildPixelFarmWorldStateInput {
  fetchedAt: string;
  memories: Memory[];
  recentEvents: PixelFarmDeltaEvent[];
  spaceId: string;
}

interface CategoryAccumulator {
  key: string;
  kind: "main" | "other";
  label: string;
  memories: Memory[];
  plotIndex: number;
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

function selectTopCategoryTags(memories: Memory[]): TagStat[] {
  return collectCandidateTags(memories).slice(0, PIXEL_FARM_MAIN_FIELD_COUNT);
}

function pickPrimaryCategoryKey(
  memory: Memory,
  topCategoryKeys: Set<string>,
): string {
  for (const tag of filterLowSignalAggregationTags(memory.tags)) {
    const normalized = normalizeTagSignal(tag);
    if (topCategoryKeys.has(normalized)) {
      return normalized;
    }
  }

  return CATEGORY_OTHER_KEY;
}

function buildBuckets(totalCount: number) {
  if (totalCount <= 0) {
    return [];
  }

  const cappedCount = Math.min(totalCount, BUCKET_CAPACITY * MAX_BUCKET_COUNT);
  const bucketCount = Math.min(
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

function buildAnimals(categoryKey: string, totalCount: number) {
  return ANIMAL_THRESHOLDS.filter((threshold) => totalCount >= threshold.minimumCount)
    .map((threshold) => {
      const palette = PIXEL_FARM_BUCKET_ANIMAL_PALETTES.find(
        (candidate) => candidate.tier === threshold.tier,
      );

      return {
        id: `${categoryKey}-${threshold.tier}`,
        active: true,
        tier: threshold.tier,
        color: palette?.color ?? "brown",
        type: palette?.type ?? threshold.tier,
      };
    });
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
}: BuildPixelFarmWorldStateInput): PixelFarmWorldState {
  const topTags = selectTopCategoryTags(memories);
  const topTagKeys = new Set(topTags.map((tag) => tag.normalized));
  const accumulators = new Map<string, CategoryAccumulator>();

  for (const [index, tag] of topTags.entries()) {
    accumulators.set(tag.normalized, {
      key: tag.normalized,
      kind: "main",
      label: tag.label,
      memories: [],
      plotIndex: index,
    });
  }

  accumulators.set(CATEGORY_OTHER_KEY, {
    key: CATEGORY_OTHER_KEY,
    kind: "other",
    label: "Other",
    memories: [],
    plotIndex: PIXEL_FARM_MAIN_FIELD_COUNT,
  });

  for (const memory of memories) {
    const categoryKey = pickPrimaryCategoryKey(memory, topTagKeys);
    const category = accumulators.get(categoryKey) ?? accumulators.get(CATEGORY_OTHER_KEY);
    category?.memories.push(memory);
  }

  const categories = [...accumulators.values()]
    .map<PixelFarmCategoryState>((category) => {
      const cropFamily =
        category.kind === "main"
          ? PIXEL_FARM_MAIN_FIELD_CROP_PALETTES[category.plotIndex]?.family ?? null
          : null;
      const decorationFamilies =
        category.kind === "other"
          ? [
              PIXEL_FARM_OTHER_ZONE_DECORATIONS.grass.family,
              PIXEL_FARM_OTHER_ZONE_DECORATIONS.redMushroom.family,
              PIXEL_FARM_OTHER_ZONE_DECORATIONS.stone.family,
            ]
          : [];

      return {
        key: category.key,
        label: category.label,
        kind: category.kind,
        plotIndex: category.plotIndex,
        totalCount: category.memories.length,
        memoryIds: category.memories.map((memory) => memory.id),
        cropFamily,
        decorationFamilies,
        dominantAgentId: dominantAgentId(category.memories),
        buckets: buildBuckets(category.memories.length),
        animals: buildAnimals(category.key, category.memories.length),
      };
    })
    .sort((left, right) => left.plotIndex - right.plotIndex);

  return {
    fetchedAt,
    activeSpaceId: spaceId,
    totalMemories: memories.length,
    categories,
    roles: buildRoles(categories, fetchedAt),
    recentEvents: [...recentEvents],
  };
}
