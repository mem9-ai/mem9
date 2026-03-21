import {
  buildLocalDerivedSignalIndex,
  getCombinedTagsForMemory,
  type LocalDerivedSignalIndex,
} from "@/lib/memory-derived-signals";
import {
  extractMemoryInsightEntities,
  type MemoryInsightEntityKind,
} from "@/lib/memory-insight-entities";
import type { AnalysisCategoryCard, MemoryAnalysisMatch } from "@/types/analysis";
import type { Memory } from "@/types/memory";

export type MemoryInsightRelationType =
  | "co_occurrence"
  | "depends_on"
  | "used_with"
  | "deployed_to"
  | "scheduled_with"
  | "points_to";

export interface MemoryInsightRelationEntity {
  id: string;
  label: string;
  normalizedLabel: string;
  kind: MemoryInsightEntityKind;
  count: number;
  dominantCategory: string | null;
  categories: string[];
  tags: string[];
  memoryIds: string[];
  distinctCategories: number;
  distinctTags: number;
  degree: number;
  growth: number;
  recentCount: number;
  previousCount: number;
}

export interface MemoryInsightRelationEdge {
  id: string;
  sourceId: string;
  sourceLabel: string;
  targetId: string;
  targetLabel: string;
  relationType: MemoryInsightRelationType;
  entityCount: number;
  coOccurrenceCount: number;
  conditionalStrength: number;
  lift: number;
  recencyBoost: number;
  sharedTags: string[];
  sharedCategories: string[];
  evidenceMemoryIds: string[];
  score: number;
}

export interface MemoryInsightRelationCluster {
  id: string;
  entityIds: string[];
  edgeIds: string[];
  labels: string[];
}

export interface MemoryInsightRelationGraph {
  totalMemories: number;
  entities: MemoryInsightRelationEntity[];
  edges: MemoryInsightRelationEdge[];
  entitiesById: Map<string, MemoryInsightRelationEntity>;
  edgesById: Map<string, MemoryInsightRelationEdge>;
  topEntityIds: string[];
  topEdgeIds: string[];
  bridgeEntities: MemoryInsightRelationEntity[];
  clusters: MemoryInsightRelationCluster[];
  risingEntities: MemoryInsightRelationEntity[];
}

interface BuildInput {
  cards: AnalysisCategoryCard[];
  memories: Memory[];
  matchMap: Map<string, MemoryAnalysisMatch>;
  signalIndex?: LocalDerivedSignalIndex | null;
  activeCategory?: string;
  activeTag?: string;
  relationType?: MemoryInsightRelationType;
  minimumCoOccurrence?: number;
}

interface EntityAggregate {
  id: string;
  label: string;
  normalizedLabel: string;
  kind: MemoryInsightEntityKind;
  count: number;
  categoryCounts: Map<string, number>;
  tagCounts: Map<string, number>;
  memoryIds: Set<string>;
  recentCount: number;
  previousCount: number;
}

interface EdgeAggregate {
  id: string;
  sourceId: string;
  targetId: string;
  evidenceMemoryIds: Set<string>;
  sharedTags: Map<string, number>;
  sharedCategories: Map<string, number>;
  coOccurrenceCount: number;
  recencyTotal: number;
  relationTypeCounts: Map<MemoryInsightRelationType, number>;
}

const SIGNIFICANT_ENTITY_MIN_COUNT = 2;
const TOP_ENTITY_LIMIT = 30;
const TOP_EDGE_LIMIT = 80;
const RELATION_PRIORITY: MemoryInsightRelationType[] = [
  "depends_on",
  "deployed_to",
  "scheduled_with",
  "points_to",
  "used_with",
  "co_occurrence",
] as const;
const DEPENDS_ON_PATTERN = /\bdepends on\b|\brely on\b|依赖/iu;
const USED_WITH_PATTERN = /\bwith\b|\busing\b|\bvia\b|配合|结合/iu;
const DEPLOYED_TO_PATTERN = /\bdeploy(?:ed)? to\b|部署到|发布到/iu;
const SCHEDULED_WITH_PATTERN = /\bevery\b|\bdaily\b|\bweekly\b|\bcron\b|\b10-minute\b|\b7-day\b|每/iu;
const POINTS_TO_PATTERN = /\bto\b|\bat\b|\bpath\b|\bconfig\b|指向/iu;

function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function isEligibleEntity(label: string, kind: MemoryInsightEntityKind): boolean {
  const normalized = normalizeLabel(label);
  if (!normalized || kind === "fallback") {
    return false;
  }

  if (/^[\d\s./:-]+$/.test(normalized)) {
    return false;
  }

  if (kind === "metric" && !/[a-z%]/i.test(normalized)) {
    return false;
  }

  return normalized.length >= 2;
}

function getEntityID(kind: MemoryInsightEntityKind, normalizedLabel: string): string {
  return `${kind}:${normalizedLabel}`;
}

function incrementCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sortedKeysByCount(map: Map<string, number>): string[] {
  return [...map.entries()]
    .sort(
      (left, right) =>
        right[1] - left[1] || left[0].localeCompare(right[0], "en"),
    )
    .map(([key]) => key);
}

function pickDominantCategory(categoryCounts: Map<string, number>): string | null {
  const [entry] = [...categoryCounts.entries()].sort(
    (left, right) =>
      right[1] - left[1] || left[0].localeCompare(right[0], "en"),
  );
  return entry?.[0] ?? null;
}

function computeRangeBounds(memories: Memory[]): { min: number; midpoint: number; span: number } {
  const timestamps = memories
    .map((memory) => Date.parse(memory.updated_at))
    .filter((value) => Number.isFinite(value));
  const min = Math.min(...timestamps);
  const max = Math.max(...timestamps);
  const span = Math.max(max - min, 1);

  return {
    min,
    midpoint: min + span / 2,
    span,
  };
}

function computeRecencyScore(timestamp: number, bounds: { min: number; span: number }): number {
  return Number.isFinite(timestamp)
    ? (timestamp - bounds.min) / bounds.span
    : 0;
}

function looksLikePathOrLocation(value: string): boolean {
  return /https?:\/\//i.test(value) ||
    value.includes("/") ||
    value.includes(".") ||
    value.includes("config");
}

function chooseRelationType(
  memory: Memory,
  left: { label: string; kind: MemoryInsightEntityKind },
  right: { label: string; kind: MemoryInsightEntityKind },
): MemoryInsightRelationType {
  const content = memory.content;

  if (DEPENDS_ON_PATTERN.test(content)) {
    return "depends_on";
  }

  if (
    DEPLOYED_TO_PATTERN.test(content) &&
    (looksLikePathOrLocation(left.label) || looksLikePathOrLocation(right.label))
  ) {
    return "deployed_to";
  }

  if (
    SCHEDULED_WITH_PATTERN.test(content) &&
    (left.kind === "metric" || right.kind === "metric")
  ) {
    return "scheduled_with";
  }

  if (
    POINTS_TO_PATTERN.test(content) &&
    (looksLikePathOrLocation(left.label) || looksLikePathOrLocation(right.label))
  ) {
    return "points_to";
  }

  if (USED_WITH_PATTERN.test(content)) {
    return "used_with";
  }

  return "co_occurrence";
}

function pickRelationType(counts: Map<MemoryInsightRelationType, number>): MemoryInsightRelationType {
  const sorted = RELATION_PRIORITY.slice().sort((left, right) => {
    const leftCount = counts.get(left) ?? 0;
    const rightCount = counts.get(right) ?? 0;
    return rightCount - leftCount || RELATION_PRIORITY.indexOf(left) - RELATION_PRIORITY.indexOf(right);
  });
  return sorted.find((type) => (counts.get(type) ?? 0) > 0) ?? "co_occurrence";
}

function sortMemoryIDs(memoryIDs: Iterable<string>, memoriesById: Map<string, Memory>): string[] {
  return [...memoryIDs].sort((left, right) => {
    const leftMemory = memoriesById.get(left);
    const rightMemory = memoriesById.get(right);
    if (!leftMemory || !rightMemory) {
      return left.localeCompare(right, "en");
    }

    return (
      rightMemory.updated_at.localeCompare(leftMemory.updated_at) ||
      rightMemory.created_at.localeCompare(leftMemory.created_at) ||
      left.localeCompare(right, "en")
    );
  });
}

function collectCluster(
  startId: string,
  adjacency: Map<string, Set<string>>,
  edgeLookup: Map<string, string>,
  labelsById: Map<string, string>,
  visited: Set<string>,
): MemoryInsightRelationCluster {
  const queue = [startId];
  const entityIds: string[] = [];
  const edgeIds = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }

    visited.add(current);
    entityIds.push(current);

    const neighbors = adjacency.get(current) ?? new Set<string>();
    for (const neighbor of neighbors) {
      const edgeId = edgeLookup.get([current, neighbor].sort().join("::"));
      if (edgeId) {
        edgeIds.add(edgeId);
      }
      if (!visited.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }

  const labels = entityIds
    .map((entityId) => labelsById.get(entityId) ?? entityId)
    .sort((left, right) => left.localeCompare(right, "en"));

  return {
    id: `cluster:${labels.join("|")}`,
    entityIds: entityIds.sort((left, right) => left.localeCompare(right, "en")),
    edgeIds: [...edgeIds].sort((left, right) => left.localeCompare(right, "en")),
    labels,
  };
}

export function buildMemoryInsightRelationGraph(input: BuildInput): MemoryInsightRelationGraph {
  const signalIndex = input.signalIndex ?? buildLocalDerivedSignalIndex({
    memories: input.memories,
    matchMap: input.matchMap,
  });
  const filteredMemories = input.memories.filter((memory) => {
    if (
      input.activeTag &&
      !getCombinedTagsForMemory(memory, signalIndex).some(
        (tag) => tag.trim().toLowerCase() === input.activeTag?.trim().toLowerCase(),
      )
    ) {
      return false;
    }

    if (input.activeCategory) {
      const categories = input.matchMap.get(memory.id)?.categories ?? [];
      if (!categories.includes(input.activeCategory)) {
        return false;
      }
    }

    return true;
  });
  const memoriesById = new Map(filteredMemories.map((memory) => [memory.id, memory]));
  const bounds = computeRangeBounds(filteredMemories);
  const entityAggregates = new Map<string, EntityAggregate>();
  const edgeAggregates = new Map<string, EdgeAggregate>();

  filteredMemories.forEach((memory) => {
    const timestamp = Date.parse(memory.updated_at);
    const recency = computeRecencyScore(timestamp, bounds);
    const isRecentHalf = timestamp >= bounds.midpoint;
    const categories = input.matchMap.get(memory.id)?.categories ?? [];
    const tags = getCombinedTagsForMemory(memory, signalIndex);
    const entities = extractMemoryInsightEntities(memory)
      .filter((entity) => isEligibleEntity(entity.label, entity.kind))
      .map((entity) => ({
        id: getEntityID(entity.kind, entity.normalizedLabel),
        label: entity.label,
        normalizedLabel: entity.normalizedLabel,
        kind: entity.kind,
      }));
    const uniqueEntities = Array.from(
      new Map(entities.map((entity) => [entity.id, entity])).values(),
    );

    uniqueEntities.forEach((entity) => {
      const aggregate = entityAggregates.get(entity.id) ?? {
        id: entity.id,
        label: entity.label,
        normalizedLabel: entity.normalizedLabel,
        kind: entity.kind,
        count: 0,
        categoryCounts: new Map<string, number>(),
        tagCounts: new Map<string, number>(),
        memoryIds: new Set<string>(),
        recentCount: 0,
        previousCount: 0,
      };

      if (!aggregate.memoryIds.has(memory.id)) {
        aggregate.count += 1;
        aggregate.memoryIds.add(memory.id);
        if (isRecentHalf) {
          aggregate.recentCount += 1;
        } else {
          aggregate.previousCount += 1;
        }
      }

      categories.forEach((category) => incrementCount(aggregate.categoryCounts, category));
      tags.forEach((tag) => incrementCount(aggregate.tagCounts, tag));
      entityAggregates.set(entity.id, aggregate);
    });

    for (let leftIndex = 0; leftIndex < uniqueEntities.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < uniqueEntities.length; rightIndex += 1) {
        const left = uniqueEntities[leftIndex]!;
        const right = uniqueEntities[rightIndex]!;
        const sortedIDs = [left.id, right.id].sort((a, b) => a.localeCompare(b, "en"));
        const sourceId = sortedIDs[0]!;
        const targetId = sortedIDs[1]!;
        const edgeId = `${sourceId}=>${targetId}`;
        const relationType = chooseRelationType(memory, left, right);
        const aggregate = edgeAggregates.get(edgeId) ?? {
          id: edgeId,
          sourceId,
          targetId,
          evidenceMemoryIds: new Set<string>(),
          sharedTags: new Map<string, number>(),
          sharedCategories: new Map<string, number>(),
          coOccurrenceCount: 0,
          recencyTotal: 0,
          relationTypeCounts: new Map<MemoryInsightRelationType, number>(),
        };

        if (!aggregate.evidenceMemoryIds.has(memory.id)) {
          aggregate.evidenceMemoryIds.add(memory.id);
          aggregate.coOccurrenceCount += 1;
          aggregate.recencyTotal += recency;
        }
        tags.forEach((tag) => incrementCount(aggregate.sharedTags, tag));
        categories.forEach((category) => incrementCount(aggregate.sharedCategories, category));
        aggregate.relationTypeCounts.set(
          relationType,
          (aggregate.relationTypeCounts.get(relationType) ?? 0) + 1,
        );
        edgeAggregates.set(edgeId, aggregate);
      }
    }
  });

  const entitiesById = new Map<string, MemoryInsightRelationEntity>();
  entityAggregates.forEach((aggregate) => {
    const growth = aggregate.recentCount / Math.max(aggregate.previousCount, 1);
    const entity: MemoryInsightRelationEntity = {
      id: aggregate.id,
      label: aggregate.label,
      normalizedLabel: aggregate.normalizedLabel,
      kind: aggregate.kind,
      count: aggregate.count,
      dominantCategory: pickDominantCategory(aggregate.categoryCounts),
      categories: sortedKeysByCount(aggregate.categoryCounts),
      tags: sortedKeysByCount(aggregate.tagCounts),
      memoryIds: sortMemoryIDs(aggregate.memoryIds, memoriesById),
      distinctCategories: aggregate.categoryCounts.size,
      distinctTags: aggregate.tagCounts.size,
      degree: 0,
      growth,
      recentCount: aggregate.recentCount,
      previousCount: aggregate.previousCount,
    };

    entitiesById.set(entity.id, entity);
  });

  const edgesById = new Map<string, MemoryInsightRelationEdge>();
  edgeAggregates.forEach((aggregate) => {
    const source = entitiesById.get(aggregate.sourceId);
    const target = entitiesById.get(aggregate.targetId);
    if (!source || !target) {
      return;
    }

    const relationType = pickRelationType(aggregate.relationTypeCounts);
    const conditionalStrength =
      aggregate.coOccurrenceCount / Math.max(Math.min(source.count, target.count), 1);
    const lift =
      (aggregate.coOccurrenceCount * Math.max(filteredMemories.length, 1)) /
      Math.max(source.count * target.count, 1);
    const recencyBoost = aggregate.recencyTotal / Math.max(aggregate.coOccurrenceCount, 1);

    const edge: MemoryInsightRelationEdge = {
      id: aggregate.id,
      sourceId: aggregate.sourceId,
      sourceLabel: source.label,
      targetId: aggregate.targetId,
      targetLabel: target.label,
      relationType,
      entityCount: source.count + target.count,
      coOccurrenceCount: aggregate.coOccurrenceCount,
      conditionalStrength,
      lift,
      recencyBoost,
      sharedTags: sortedKeysByCount(aggregate.sharedTags),
      sharedCategories: sortedKeysByCount(aggregate.sharedCategories),
      evidenceMemoryIds: sortMemoryIDs(aggregate.evidenceMemoryIds, memoriesById),
      score: aggregate.coOccurrenceCount * 100 + lift * 10 + recencyBoost,
    };

    edgesById.set(edge.id, edge);
  });

  let edges = [...edgesById.values()];
  if (input.relationType) {
    edges = edges.filter((edge) => edge.relationType === input.relationType);
  }

  const minimumCoOccurrence = input.minimumCoOccurrence ?? 1;
  edges = edges
    .filter((edge) => edge.coOccurrenceCount >= minimumCoOccurrence)
    .sort(
      (left, right) =>
        right.coOccurrenceCount - left.coOccurrenceCount ||
        right.lift - left.lift ||
        right.recencyBoost - left.recencyBoost ||
        left.id.localeCompare(right.id, "en"),
    );

  const visibleEntityIds = new Set(edges.flatMap((edge) => [edge.sourceId, edge.targetId]));
  const entities = [...entitiesById.values()]
    .filter((entity) => visibleEntityIds.has(entity.id))
    .map((entity) => ({
      ...entity,
      degree: edges.filter(
        (edge) => edge.sourceId === entity.id || edge.targetId === entity.id,
      ).length,
    }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        right.degree - left.degree ||
        right.distinctCategories - left.distinctCategories ||
        left.label.localeCompare(right.label, "en"),
    );
  entities.forEach((entity) => entitiesById.set(entity.id, entity));

  const significantEntityIds = new Set(
    entities
      .filter((entity) => entity.count >= SIGNIFICANT_ENTITY_MIN_COUNT)
      .map((entity) => entity.id),
  );
  const topEntityIds = entities
    .filter((entity) => significantEntityIds.has(entity.id))
    .slice(0, TOP_ENTITY_LIMIT)
    .map((entity) => entity.id);
  const topEntityIdSet = new Set(topEntityIds);
  const topEdgeIds = edges
    .filter((edge) => topEntityIdSet.has(edge.sourceId) && topEntityIdSet.has(edge.targetId))
    .slice(0, TOP_EDGE_LIMIT)
    .map((edge) => edge.id);

  const bridgeEntities = entities
    .filter((entity) => topEntityIdSet.has(entity.id))
    .slice()
    .sort(
      (left, right) =>
        right.distinctCategories - left.distinctCategories ||
        right.distinctTags - left.distinctTags ||
        right.degree - left.degree ||
        right.count - left.count ||
        left.label.localeCompare(right.label, "en"),
    );

  const risingEntities = entities
    .filter((entity) => topEntityIdSet.has(entity.id))
    .slice()
    .sort(
      (left, right) =>
        right.growth - left.growth ||
        right.recentCount - left.recentCount ||
        right.count - left.count ||
        left.label.localeCompare(right.label, "en"),
    );

  const adjacency = new Map<string, Set<string>>();
  const edgeLookup = new Map<string, string>();
  edges.forEach((edge) => {
    if (!topEntityIdSet.has(edge.sourceId) || !topEntityIdSet.has(edge.targetId)) {
      return;
    }

    const sourceNeighbors = adjacency.get(edge.sourceId) ?? new Set<string>();
    sourceNeighbors.add(edge.targetId);
    adjacency.set(edge.sourceId, sourceNeighbors);

    const targetNeighbors = adjacency.get(edge.targetId) ?? new Set<string>();
    targetNeighbors.add(edge.sourceId);
    adjacency.set(edge.targetId, targetNeighbors);

    edgeLookup.set([edge.sourceId, edge.targetId].sort().join("::"), edge.id);
  });

  const labelsById = new Map(entities.map((entity) => [entity.id, entity.label]));
  const visited = new Set<string>();
  const clusters = topEntityIds
    .filter((entityId) => adjacency.has(entityId))
    .map((entityId) =>
      visited.has(entityId)
        ? null
        : collectCluster(entityId, adjacency, edgeLookup, labelsById, visited),
    )
    .filter((cluster): cluster is MemoryInsightRelationCluster => cluster !== null)
    .sort(
      (left, right) =>
        right.entityIds.length - left.entityIds.length ||
        right.edgeIds.length - left.edgeIds.length ||
        left.id.localeCompare(right.id, "en"),
    );

  return {
    totalMemories: filteredMemories.length,
    entities,
    edges,
    entitiesById,
    edgesById: new Map(edges.map((edge) => [edge.id, edge])),
    topEntityIds,
    topEdgeIds,
    bridgeEntities,
    clusters,
    risingEntities,
  };
}
