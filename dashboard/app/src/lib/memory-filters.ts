import type {
  Memory,
  MemoryFacet,
  MemoryTypeFilter,
} from "@/types/memory";
import type {
  TimeRangePreset,
  TimelineSelection,
} from "@/types/time-range";

export type MemoryTagResolver = (memory: Memory) => string[];

function parseTimestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function sortMemoriesByCreatedAtDesc(memories: Memory[]): Memory[] {
  return [...memories].sort((left, right) => {
    const leftTime = parseTimestamp(left.created_at) ?? Number.NEGATIVE_INFINITY;
    const rightTime = parseTimestamp(right.created_at) ?? Number.NEGATIVE_INFINITY;
    return rightTime - leftTime || right.id.localeCompare(left.id, "en");
  });
}

export function memoryMatchesRange(
  memory: Memory,
  range: TimeRangePreset,
): boolean {
  if (range === "all") return true;

  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const cutoff = Date.now() - days * 86_400_000;
  const createdAt = parseTimestamp(memory.created_at);
  return createdAt !== null && createdAt >= cutoff;
}

export function memoryMatchesTimeline(
  memory: Memory,
  selection?: TimelineSelection,
): boolean {
  if (!selection) return true;

  const createdAt = parseTimestamp(memory.created_at);
  const from = parseTimestamp(selection.from);
  const to = parseTimestamp(selection.to);

  if (createdAt === null || from === null || to === null) return false;
  // Keep timeline filtering aligned with pulse bucket construction:
  // buckets are treated as [start, end), except for the chart's final visual edge.
  return createdAt >= from && createdAt < to;
}

function resolveMemoryTags(
  memory: Memory,
  tagResolver?: MemoryTagResolver,
): string[] {
  return tagResolver?.(memory) ?? memory.tags;
}

export function memoryMatchesQuery(
  memory: Memory,
  query?: string,
  tagResolver?: MemoryTagResolver,
): boolean {
  if (!query) return true;
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  return (
    memory.content.toLowerCase().includes(normalized) ||
    resolveMemoryTags(memory, tagResolver).some((tag) =>
      tag.toLowerCase().includes(normalized)
    )
  );
}

export function memoryMatchesTag(
  memory: Memory,
  tag?: string,
  tagResolver?: MemoryTagResolver,
): boolean {
  if (!tag) return true;
  const normalized = tag.trim().toLowerCase();
  if (!normalized) return true;

  return resolveMemoryTags(memory, tagResolver).some(
    (memoryTag) => memoryTag.toLowerCase() === normalized,
  );
}

export function memoryMatchesType(
  memory: Memory,
  memoryType?: MemoryTypeFilter,
): boolean {
  if (!memoryType || memoryType === "pinned,insight") return true;
  return memory.memory_type === memoryType;
}

export function memoryMatchesFacet(
  memory: Memory,
  facet?: MemoryFacet,
): boolean {
  if (!facet) return true;
  return memory.metadata?.facet === facet;
}

export function filterMemoriesForView(
  memories: Memory[],
  params: {
    q?: string;
    tag?: string;
    memoryType?: MemoryTypeFilter;
    facet?: MemoryFacet;
    range?: TimeRangePreset;
    timeline?: TimelineSelection;
    tagResolver?: MemoryTagResolver;
  },
): Memory[] {
  return sortMemoriesByCreatedAtDesc(
    memories.filter(
      (memory) =>
        memoryMatchesQuery(memory, params.q, params.tagResolver) &&
        memoryMatchesTag(memory, params.tag, params.tagResolver) &&
        memoryMatchesType(memory, params.memoryType) &&
        memoryMatchesFacet(memory, params.facet) &&
        memoryMatchesTimeline(memory, params.timeline) &&
        (!params.range || memoryMatchesRange(memory, params.range)),
    ),
  );
}
