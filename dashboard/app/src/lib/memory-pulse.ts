import type {
  AnalysisCategory,
  AnalysisCategoryCard,
  AnalysisFacetStat,
  AnalysisJobSnapshotResponse,
} from "@/types/analysis";
import type {
  Memory,
  MemoryFacet,
  MemoryStats,
  MemoryType,
} from "@/types/memory";
import type { TimeRangePreset } from "@/types/time-range";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const TREND_BUCKETS: Record<TimeRangePreset, number> = {
  "7d": 7,
  "30d": 10,
  "90d": 12,
  all: 12,
};
const RANGE_DAYS: Record<Exclude<TimeRangePreset, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};
const FACET_COLOR_TOKENS: Record<MemoryFacet, string> = {
  about_you: "--facet-about-you",
  preferences: "--facet-preferences",
  important_people: "--facet-people",
  experiences: "--facet-experiences",
  plans: "--facet-plans",
  routines: "--facet-routines",
  constraints: "--facet-constraints",
  other: "--facet-other",
};
const CATEGORY_COLOR_TOKENS: Record<AnalysisCategory, string> = {
  identity: "--facet-about-you",
  emotion: "--facet-people",
  preference: "--facet-preferences",
  experience: "--facet-experiences",
  activity: "--facet-routines",
};
const DEFAULT_CATEGORY_COLOR_TOKEN = "--facet-other";

export interface PulseTrendBucket {
  count: number;
  start: number;
  end: number;
}

export interface PulseCompositionSegment {
  key: string;
  labelKey: string;
  value: number;
  ratio: number;
  colorToken: string;
  memoryType?: MemoryType;
}

export interface PulseSignalItem {
  value: string;
  count: number;
  ratio: number;
}

export interface MemoryPulseData {
  trend: {
    buckets: PulseTrendBucket[];
    maxCount: number;
  };
  composition: {
    total: number;
    outer: PulseCompositionSegment[];
    inner: PulseCompositionSegment[];
    innerKind: "analysis" | "facet" | "none";
  };
  signals: {
    items: PulseSignalItem[];
    source: "analysis" | "memory" | "none";
  };
}

function parseTimestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getWindow(range: TimeRangePreset, memories: Memory[]): {
  start: number;
  end: number;
} | null {
  const timestamps = memories
    .map((memory) => parseTimestamp(memory.created_at))
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);

  if (timestamps.length === 0) {
    return null;
  }

  if (range === "all") {
    const start = timestamps[0] ?? Date.now();
    const last = timestamps[timestamps.length - 1] ?? start;
    const end = Math.max(last, start + DAY_IN_MS);
    return { start, end };
  }

  const end = Date.now();
  return {
    start: end - RANGE_DAYS[range] * DAY_IN_MS,
    end,
  };
}

export function buildPulseTrend(
  memories: Memory[],
  range: TimeRangePreset,
): MemoryPulseData["trend"] {
  const window = getWindow(range, memories);

  if (window === null) {
    return {
      buckets: [],
      maxCount: 0,
    };
  }

  const bucketCount = TREND_BUCKETS[range];
  const bucketSize = Math.max((window.end - window.start) / bucketCount, 1);
  const counts = Array.from({ length: bucketCount }, () => 0);

  for (const memory of memories) {
    const timestamp = parseTimestamp(memory.created_at);
    if (timestamp === null || timestamp < window.start || timestamp > window.end) {
      continue;
    }

    const offset = timestamp === window.end
      ? bucketCount - 1
      : Math.floor((timestamp - window.start) / bucketSize);
    const index = Math.max(0, Math.min(bucketCount - 1, offset));
    counts[index] = (counts[index] ?? 0) + 1;
  }

  return {
    buckets: counts.map((count, index) => ({
      count,
      start: window.start + index * bucketSize,
      end: window.start + (index + 1) * bucketSize,
    })),
    maxCount: Math.max(...counts, 0),
  };
}

function normalizeSegments<T extends { key: string; labelKey: string; value: number; colorToken: string; memoryType?: MemoryType }>(
  items: T[],
): PulseCompositionSegment[] {
  const total = items.reduce((sum, item) => sum + item.value, 0);

  return items.map((item) => ({
    ...item,
    ratio: total === 0 ? 0 : item.value / total,
  }));
}

function buildOuterSegments(stats: MemoryStats): PulseCompositionSegment[] {
  return normalizeSegments([
    {
      key: "pinned",
      labelKey: "space.stats.pinned",
      value: stats.pinned,
      colorToken: "--type-pinned",
      memoryType: "pinned",
    },
    {
      key: "insight",
      labelKey: "space.stats.insight",
      value: stats.insight,
      colorToken: "--type-insight",
      memoryType: "insight",
    },
  ]);
}

function isMemoryFacet(value: unknown): value is MemoryFacet {
  return typeof value === "string" && value in FACET_COLOR_TOKENS;
}

function buildFacetSegments(memories: Memory[]): PulseCompositionSegment[] {
  const counts = new Map<MemoryFacet, number>();

  for (const memory of memories) {
    const facet = memory.metadata?.facet;
    if (!isMemoryFacet(facet)) {
      continue;
    }
    counts.set(facet, (counts.get(facet) ?? 0) + 1);
  }

  return normalizeSegments(
    [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([facet, value]) => ({
        key: facet,
        labelKey: `facet.${facet}`,
        value,
        colorToken: FACET_COLOR_TOKENS[facet],
      })),
  );
}

function buildAnalysisSegments(
  cards: AnalysisCategoryCard[],
): PulseCompositionSegment[] {
  return normalizeSegments(
    cards
      .slice(0, 5)
      .map((card) => ({
        key: card.category,
        labelKey: `analysis.category.${card.category}`,
        value: card.count,
        colorToken:
          CATEGORY_COLOR_TOKENS[card.category] ?? DEFAULT_CATEGORY_COLOR_TOKEN,
      })),
  );
}

export function buildPulseComposition(
  stats: MemoryStats,
  memories: Memory[],
  cards: AnalysisCategoryCard[],
): MemoryPulseData["composition"] {
  const inner = buildAnalysisSegments(cards);

  return {
    total: stats.total,
    outer: buildOuterSegments(stats),
    inner: inner.length > 0 ? inner : buildFacetSegments(memories),
    innerKind: inner.length > 0 ? "analysis" : memories.length > 0 ? "facet" : "none",
  };
}

function buildSignalItemsFromStats(
  stats: AnalysisFacetStat[],
  limit: number,
): PulseSignalItem[] {
  const sorted = stats
    .filter((item) => item.count > 0)
    .sort(
      (left, right) =>
        right.count - left.count || left.value.localeCompare(right.value, "en"),
    )
    .slice(0, limit);
  const maxCount = sorted[0]?.count ?? 0;

  return sorted.map((item) => ({
    value: item.value,
    count: item.count,
    ratio: maxCount === 0 ? 0 : item.count / maxCount,
  }));
}

function buildSignalItemsFromMemories(
  memories: Memory[],
  limit: number,
): PulseSignalItem[] {
  const counts = new Map<string, number>();

  for (const memory of memories) {
    for (const tag of memory.tags) {
      const value = tag.trim();
      if (!value) {
        continue;
      }
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }

  const sorted = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "en"))
    .slice(0, limit);
  const maxCount = sorted[0]?.[1] ?? 0;

  return sorted.map(([value, count]) => ({
    value,
    count,
    ratio: maxCount === 0 ? 0 : count / maxCount,
  }));
}

function getSnapshotTagStats(
  snapshot: AnalysisJobSnapshotResponse | null,
): AnalysisFacetStat[] {
  if (snapshot?.topTagStats && snapshot.topTagStats.length > 0) {
    return snapshot.topTagStats;
  }

  if (snapshot?.topTags && snapshot.topTags.length > 0) {
    return snapshot.topTags.map((value) => ({
      value,
      count: snapshot.aggregate.tagCounts[value] ?? 0,
    }));
  }

  return [];
}

export function buildPulseSignals(
  snapshot: AnalysisJobSnapshotResponse | null,
  memories: Memory[],
  limit = 5,
): MemoryPulseData["signals"] {
  const fromMemories = buildSignalItemsFromMemories(memories, limit);
  if (fromMemories.length > 0) {
    return {
      items: fromMemories,
      source: "memory",
    };
  }

  const fromSnapshot = buildSignalItemsFromStats(getSnapshotTagStats(snapshot), limit);
  if (fromSnapshot.length > 0) {
    return {
      items: fromSnapshot,
      source: "analysis",
    };
  }

  return {
    items: [],
    source: "none",
  };
}

export function buildMemoryPulseData(input: {
  stats: MemoryStats;
  memories: Memory[];
  cards: AnalysisCategoryCard[];
  snapshot: AnalysisJobSnapshotResponse | null;
  range: TimeRangePreset;
}): MemoryPulseData {
  return {
    trend: buildPulseTrend(input.memories, input.range),
    composition: buildPulseComposition(input.stats, input.memories, input.cards),
    signals: buildPulseSignals(input.snapshot, input.memories),
  };
}
