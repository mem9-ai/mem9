import type { Memory, MemoryType } from "@/types/memory";
import type { TimeRangePreset } from "@/types/time-range";

export function sortMemoriesByUpdatedAtDesc(memories: Memory[]): Memory[] {
  return [...memories].sort((left, right) =>
    right.updated_at.localeCompare(left.updated_at),
  );
}

export function memoryMatchesRange(
  memory: Memory,
  range: TimeRangePreset,
): boolean {
  if (range === "all") return true;

  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const cutoff = Date.now() - days * 86_400_000;
  return new Date(memory.updated_at).getTime() >= cutoff;
}

export function memoryMatchesQuery(memory: Memory, query?: string): boolean {
  if (!query) return true;
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  return (
    memory.content.toLowerCase().includes(normalized) ||
    memory.tags.some((tag) => tag.toLowerCase().includes(normalized))
  );
}

export function memoryMatchesType(
  memory: Memory,
  memoryType?: MemoryType,
): boolean {
  if (!memoryType) return true;
  return memory.memory_type === memoryType;
}

export function filterMemoriesForView(
  memories: Memory[],
  params: {
    q?: string;
    memoryType?: MemoryType;
    range?: TimeRangePreset;
  },
): Memory[] {
  return sortMemoriesByUpdatedAtDesc(
    memories.filter(
      (memory) =>
        memoryMatchesQuery(memory, params.q) &&
        memoryMatchesType(memory, params.memoryType) &&
        (!params.range || memoryMatchesRange(memory, params.range)),
    ),
  );
}
