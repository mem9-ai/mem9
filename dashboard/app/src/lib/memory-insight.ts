import type { AnalysisCategoryCard, MemoryAnalysisMatch } from "@/types/analysis";
import type { Memory } from "@/types/memory";
import {
  buildLocalDerivedSignalIndex,
  getCombinedTagsForMemory,
  type LocalDerivedSignalIndex,
  type DerivedTagOrigin,
} from "@/lib/memory-derived-signals";
import {
  extractMemoryInsightEntities,
  type MemoryInsightEntityKind,
} from "@/lib/memory-insight-entities";

export type MemoryInsightTab = "pulse" | "insight";
export type MemoryInsightViewMode = "browse" | "relations";
export type MemoryInsightNodeKind = "card" | "tag" | "entity" | "memory";
export type { MemoryInsightEntityKind } from "@/lib/memory-insight-entities";
export { extractMemoryInsightEntities } from "@/lib/memory-insight-entities";

export const MEMORY_INSIGHT_UNTAGGED_TAG = "__untagged__";

export type MemoryInsightSelection =
  | {
      kind: "card";
      cardCategory: string;
    }
  | {
      kind: "tag";
      cardCategory: string;
      tagValue: string;
    }
  | {
      kind: "entity";
      cardCategory: string;
      tagValue: string;
      entityKind: MemoryInsightEntityKind;
      entityValue: string;
    }
  | {
      kind: "memory";
      memoryId: string;
    };

export interface MemoryInsightEntityFilter {
  id: string;
  label: string;
  normalizedLabel: string;
  kind: MemoryInsightEntityKind;
}

export interface MemoryInsightCardNode {
  id: string;
  kind: "card";
  category: string;
  label: string;
  count: number;
  confidence: number;
  size: number;
  branchKey: string;
  parentId: null;
  depth: 0;
}

export interface MemoryInsightTagNode {
  id: string;
  kind: "tag";
  category: string;
  tagValue: string;
  label: string;
  count: number;
  size: number;
  branchKey: string;
  parentId: string;
  depth: 1;
  synthetic: boolean;
  origin: DerivedTagOrigin;
}

export interface MemoryInsightEntityNode {
  id: string;
  kind: "entity";
  category: string;
  tagValue: string;
  entityKind: MemoryInsightEntityKind;
  entityValue: string;
  label: string;
  count: number;
  size: number;
  branchKey: string;
  parentId: string;
  depth: 2;
}

export interface MemoryInsightMemoryNode {
  id: string;
  kind: "memory";
  category: string;
  tagValue: string;
  entityKind: MemoryInsightEntityKind;
  entityValue: string;
  memoryId: string;
  label: string;
  preview: string;
  count: 1;
  size: number;
  branchKey: string;
  parentId: string;
  depth: 3;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

export type MemoryInsightNode =
  | MemoryInsightCardNode
  | MemoryInsightTagNode
  | MemoryInsightEntityNode
  | MemoryInsightMemoryNode;

export interface MemoryInsightEdge {
  id: string;
  kind: "contains";
  source: string;
  target: string;
  branchKey: string;
}

export interface MemoryInsightGraph {
  nodes: MemoryInsightNode[];
  edges: MemoryInsightEdge[];
  cards: MemoryInsightCardNode[];
  tags: MemoryInsightTagNode[];
  entities: MemoryInsightEntityNode[];
  memories: MemoryInsightMemoryNode[];
}

export interface BuildMemoryInsightGraphInput {
  cards: AnalysisCategoryCard[];
  memories: Memory[];
  matches?: MemoryAnalysisMatch[] | null;
  matchMap?: Map<string, MemoryAnalysisMatch> | null;
  signalIndex?: LocalDerivedSignalIndex | null;
}

interface TagBucket {
  tagValue: string;
  synthetic: boolean;
  origin: DerivedTagOrigin;
  memories: Memory[];
}

interface EntityBucket {
  entityKind: MemoryInsightEntityKind;
  entityValue: string;
  normalizedLabel: string;
  memories: Memory[];
}

const ENTITY_KIND_ORDER: Record<MemoryInsightEntityKind, number> = {
  named_term: 0,
  metric: 1,
  person_like: 2,
  fallback: 3,
};

const CATEGORY_PREFIXES = [
  "analysis.category.",
  "analysis.categroy.",
  "analysis.category:",
] as const;

const CATEGORY_PREFIX_PATTERN = /^analysis\.category\./i;

function createMatchLookup(
  matches?: MemoryAnalysisMatch[] | null,
  matchMap?: Map<string, MemoryAnalysisMatch> | null,
): Map<string, MemoryAnalysisMatch> {
  if (matchMap) {
    return matchMap;
  }

  return new Map((matches ?? []).map((match) => [match.memoryId, match]));
}

function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized : "item";
}

function capitalizeToken(value: string): string {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export function stripInsightCategoryPrefix(value: string): string {
  const trimmed = value.trim();

  for (const prefix of CATEGORY_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length);
    }
  }

  return trimmed;
}

export function humanizeInsightCategoryLabel(value: string): string {
  const stripped = stripInsightCategoryPrefix(value);
  const parts = stripped
    .split(/[._-]+/g)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return value.trim();
  }

  return parts.map(capitalizeToken).join(" ");
}

function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function stableInsightIdSuffix(value: string): string {
  const normalized = normalizeLabel(value);
  let hash = 0;

  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash << 5) - hash + normalized.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash).toString(36).slice(0, 6);
}

function buildStableInsightSegment(value: string): string {
  const normalized = normalizeLabel(value);
  return `${slugify(normalized)}-${stableInsightIdSuffix(normalized)}`;
}

function buildInsightTagSegment(tagValue: string): string {
  return tagValue === MEMORY_INSIGHT_UNTAGGED_TAG
    ? MEMORY_INSIGHT_UNTAGGED_TAG
    : buildStableInsightSegment(tagValue);
}

export function normalizeInsightCategoryKey(value: string): string {
  return stripInsightCategoryPrefix(value);
}

export function humanizeInsightLabel(value: string): string {
  return humanizeInsightCategoryLabel(value);
}

export function formatInsightCategoryLabel(
  value: string,
  translate: (key: string) => string,
): string {
  const categoryKey = normalizeInsightCategoryKey(value);
  const translationKey = `analysis.category.${categoryKey}`;
  const translated = translate(translationKey);

  if (
    translated &&
    translated !== translationKey &&
    translated !== value &&
    !CATEGORY_PREFIX_PATTERN.test(translated)
  ) {
    return translated;
  }

  return humanizeInsightLabel(categoryKey);
}

function truncatePreview(value: string, limit: number): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length <= limit) {
    return trimmed;
  }

  return `${trimmed.slice(0, limit - 1)}…`;
}

function buildSize(base: number, count: number, scale: number): number {
  return Math.round(base + Math.sqrt(Math.max(count, 1)) * scale);
}

export function memoryMatchesInsightEntity(
  memory: Memory,
  entity?: MemoryInsightEntityFilter,
): boolean {
  if (!entity) {
    return true;
  }

  if (entity.kind === "fallback") {
    return extractMemoryInsightEntities(memory).length === 0;
  }

  return extractMemoryInsightEntities(memory).some(
    (candidate) =>
      candidate.kind === entity.kind &&
      candidate.normalizedLabel === entity.normalizedLabel,
  );
}

function buildTagBuckets(
  memories: Memory[],
  matchLookup: Map<string, MemoryAnalysisMatch>,
  providedSignalIndex?: LocalDerivedSignalIndex | null,
): TagBucket[] {
  const signalIndex = providedSignalIndex ?? buildLocalDerivedSignalIndex({
    memories,
    matchMap: matchLookup,
  });
  const buckets = new Map<string, TagBucket>();

  for (const memory of memories) {
    const tags = getCombinedTagsForMemory(memory, signalIndex);
    const values = tags.length > 0 ? tags : [MEMORY_INSIGHT_UNTAGGED_TAG];

    for (const value of values) {
      const key =
        value === MEMORY_INSIGHT_UNTAGGED_TAG
          ? MEMORY_INSIGHT_UNTAGGED_TAG
          : normalizeLabel(value);
      const origin = value === MEMORY_INSIGHT_UNTAGGED_TAG
        ? "raw"
        : (signalIndex.tagSourceByValue.get(key) ?? "raw");
      const bucket = buckets.get(key) ?? {
        tagValue: value,
        synthetic: value === MEMORY_INSIGHT_UNTAGGED_TAG,
        origin,
        memories: [],
      };

      bucket.memories.push(memory);
      buckets.set(key, bucket);
    }
  }

  return [...buckets.values()].sort(
    (left, right) =>
      right.memories.length - left.memories.length ||
      left.tagValue.localeCompare(right.tagValue, "en"),
  );
}

function buildEntityBuckets(memories: Memory[]): EntityBucket[] {
  const buckets = new Map<string, EntityBucket>();

  for (const memory of memories) {
    const hits = extractMemoryInsightEntities(memory);
    const uniqueHits = hits.length > 0 ? hits : [
      {
        kind: "fallback" as const,
        label: "Other",
        normalizedLabel: "other",
        index: 0,
      },
    ];

    for (const hit of uniqueHits) {
      const key = `${hit.kind}:${hit.normalizedLabel}`;
      const bucket = buckets.get(key) ?? {
        entityKind: hit.kind,
        entityValue: hit.label,
        normalizedLabel: hit.normalizedLabel,
        memories: [],
      };

      bucket.memories.push(memory);
      buckets.set(key, bucket);
    }
  }

  return [...buckets.values()].sort(
    (left, right) =>
      right.memories.length - left.memories.length ||
      ENTITY_KIND_ORDER[left.entityKind] - ENTITY_KIND_ORDER[right.entityKind] ||
      left.entityValue.localeCompare(right.entityValue, "en"),
  );
}

function getCardMemories(
  category: string,
  memories: Memory[],
  matchLookup: Map<string, MemoryAnalysisMatch>,
): Memory[] {
  return memories.filter((memory) =>
    matchLookup.get(memory.id)?.categories.includes(category),
  );
}

function createCardNode(
  category: string,
  count: number,
  confidence: number,
): MemoryInsightCardNode {
  const id = `card:${slugify(category)}`;

  return {
    id,
    kind: "card",
    category,
    label: category,
    count,
    confidence,
    size: buildSize(88, count, 12),
    branchKey: category,
    parentId: null,
    depth: 0,
  };
}

function createTagNode(
  category: string,
  tagValue: string,
  count: number,
  synthetic: boolean,
  origin: DerivedTagOrigin,
): MemoryInsightTagNode {
  const id = buildInsightTagNodeId(category, tagValue);

  return {
    id,
    kind: "tag",
    category,
    tagValue,
    label: synthetic ? "#untagged" : `#${tagValue}`,
    count,
    size: buildSize(64, count, 10),
    branchKey: `${category}>${tagValue}`,
    parentId: `card:${slugify(category)}`,
    depth: 1,
    synthetic,
    origin,
  };
}

export function buildInsightTagNodeId(category: string, tagValue: string): string {
  return `tag:${slugify(category)}:${buildInsightTagSegment(tagValue)}`;
}

export function buildInsightEntityNodeId(
  category: string,
  tagValue: string,
  entityKind: MemoryInsightEntityKind,
  entityValue: string,
): string {
  const entitySegment = buildStableInsightSegment(entityValue);
  return `entity:${slugify(category)}:${buildInsightTagSegment(tagValue)}:${entityKind}:${entitySegment}`;
}

function createEntityNode(
  category: string,
  tagValue: string,
  entityKind: MemoryInsightEntityKind,
  entityValue: string,
  count: number,
): MemoryInsightEntityNode {
  const id = buildInsightEntityNodeId(category, tagValue, entityKind, entityValue);

  return {
    id,
    kind: "entity",
    category,
    tagValue,
    entityKind,
    entityValue,
    label: entityValue,
    count,
    size: buildSize(52, count, 8),
    branchKey: `${category}>${tagValue}>${entityKind}:${entityValue}`,
    parentId: buildInsightTagNodeId(category, tagValue),
    depth: 2,
  };
}

export function buildInsightMemoryNodeId(
  category: string,
  tagValue: string,
  entityKind: MemoryInsightEntityKind,
  entityValue: string,
  memoryId: string,
): string {
  const entitySegment = buildStableInsightSegment(entityValue);
  return `memory:${slugify(category)}:${buildInsightTagSegment(tagValue)}:${entityKind}:${entitySegment}:${memoryId}`;
}

function createMemoryNode(
  category: string,
  tagValue: string,
  entityKind: MemoryInsightEntityKind,
  entityValue: string,
  memory: Memory,
): MemoryInsightMemoryNode {
  const id = buildInsightMemoryNodeId(
    category,
    tagValue,
    entityKind,
    entityValue,
    memory.id,
  );

  return {
    id,
    kind: "memory",
    category,
    tagValue,
    entityKind,
    entityValue,
    memoryId: memory.id,
    label: truncatePreview(memory.content, 48),
    preview: truncatePreview(memory.content, 120),
    count: 1,
    size: 40,
    branchKey: `${category}>${tagValue}>${entityKind}:${entityValue}>${memory.id}`,
    parentId: buildInsightEntityNodeId(
      category,
      tagValue,
      entityKind,
      entityValue,
    ),
    depth: 3,
    createdAt: memory.created_at,
    updatedAt: memory.updated_at,
    tags: memory.tags.slice(),
  };
}

export function buildMemoryInsightGraph(
  input: BuildMemoryInsightGraphInput,
): MemoryInsightGraph {
  const matchLookup = createMatchLookup(input.matches, input.matchMap);
  const cards = input.cards
    .filter((card) => card.count > 0)
    .slice()
    .sort(
      (left, right) =>
        right.count - left.count || left.category.localeCompare(right.category, "en"),
    );

  const cardNodes: MemoryInsightCardNode[] = [];
  const tagNodes: MemoryInsightTagNode[] = [];
  const entityNodes: MemoryInsightEntityNode[] = [];
  const memoryNodes: MemoryInsightMemoryNode[] = [];
  const nodes: MemoryInsightNode[] = [];
  const edges: MemoryInsightEdge[] = [];

  for (const card of cards) {
    const cardMemories = getCardMemories(card.category, input.memories, matchLookup);
    const cardNode = createCardNode(
      card.category,
      Math.max(card.count, cardMemories.length),
      card.confidence,
    );
    cardNodes.push(cardNode);
    nodes.push(cardNode);

    const tagBuckets = buildTagBuckets(cardMemories, matchLookup, input.signalIndex);
    for (const tagBucket of tagBuckets) {
      const tagNode = createTagNode(
        card.category,
        tagBucket.tagValue,
        tagBucket.memories.length,
        tagBucket.synthetic,
        tagBucket.origin,
      );
      tagNodes.push(tagNode);
      nodes.push(tagNode);
      edges.push({
        id: `${cardNode.id}=>${tagNode.id}`,
        kind: "contains",
        source: cardNode.id,
        target: tagNode.id,
        branchKey: tagNode.branchKey,
      });

      const entityBuckets = buildEntityBuckets(tagBucket.memories);
      for (const entityBucket of entityBuckets) {
        const entityNode = createEntityNode(
          card.category,
          tagBucket.tagValue,
          entityBucket.entityKind,
          entityBucket.entityValue,
          entityBucket.memories.length,
        );
        entityNodes.push(entityNode);
        nodes.push(entityNode);
        edges.push({
          id: `${tagNode.id}=>${entityNode.id}`,
          kind: "contains",
          source: tagNode.id,
          target: entityNode.id,
          branchKey: entityNode.branchKey,
        });

        const seenMemoryIds = new Set<string>();
        for (const memory of entityBucket.memories) {
          if (seenMemoryIds.has(memory.id)) {
            continue;
          }

          seenMemoryIds.add(memory.id);
          const memoryNode = createMemoryNode(
            card.category,
            tagBucket.tagValue,
            entityBucket.entityKind,
            entityBucket.entityValue,
            memory,
          );
          memoryNodes.push(memoryNode);
          nodes.push(memoryNode);
          edges.push({
            id: `${entityNode.id}=>${memoryNode.id}`,
            kind: "contains",
            source: entityNode.id,
            target: memoryNode.id,
            branchKey: memoryNode.branchKey,
          });
        }
      }
    }
  }

  return {
    nodes,
    edges,
    cards: cardNodes,
    tags: tagNodes,
    entities: entityNodes,
    memories: memoryNodes,
  };
}
