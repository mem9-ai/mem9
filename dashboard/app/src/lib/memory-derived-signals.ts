import { extractMemoryInsightEntities } from "@/lib/memory-insight-entities";
import {
  filterLowSignalAggregationTags,
  isLowSignalAggregationTag,
  normalizeTagSignal,
} from "@/lib/tag-signals";
import type { MemoryAnalysisMatch } from "@/types/analysis";
import type { Memory } from "@/types/memory";

export type DerivedTagOrigin = "raw" | "derived" | "mixed";
export type DerivedTagSource = "structured" | "named_term" | "segmented";

export interface MemoryDerivedTagCandidate {
  source: DerivedTagSource;
  normalizedValue: string;
  displayValue: string;
}

export interface MemoryDerivedAnalysis {
  memoryId: string;
  rawTags: string[];
  candidates: MemoryDerivedTagCandidate[];
}

export interface LocalDerivedTagStat {
  value: string;
  normalizedValue: string;
  count: number;
  origin: DerivedTagOrigin;
}

export interface LocalDerivedSignalIndex {
  derivedTagsByMemoryId: Map<string, string[]>;
  combinedTagsByMemoryId: Map<string, string[]>;
  tagStats: LocalDerivedTagStat[];
  tagSourceByValue: Map<string, DerivedTagOrigin>;
}

interface BuildLocalDerivedSignalIndexInput {
  memories: Memory[];
  matchMap?: Map<string, MemoryAnalysisMatch> | null;
  memoryAnalyses?: MemoryDerivedAnalysis[] | Map<string, MemoryDerivedAnalysis> | null;
}

interface CandidateAggregate {
  normalizedValue: string;
  memoryIds: Set<string>;
  categoryCounts: Map<string, number>;
  displayCounts: Map<string, number>;
}

interface TagAggregate {
  normalizedValue: string;
  count: number;
  rawCount: number;
  derivedCount: number;
  displayCounts: Map<string, number>;
}

const MAX_DERIVED_TAGS_PER_MEMORY = 2;
const SOURCE_PRIORITY: Record<DerivedTagSource, number> = {
  structured: 0,
  named_term: 1,
  segmented: 2,
};
const FILE_EXTENSION_TOKENS = new Set([
  "md",
  "json",
  "yaml",
  "yml",
  "txt",
  "csv",
  "ts",
  "tsx",
  "js",
  "jsx",
  "go",
  "py",
  "sql",
  "html",
  "css",
  "xml",
  "toml",
  "ini",
  "log",
]);
const DERIVED_TAG_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "been",
  "being",
  "by",
  "can",
  "could",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "here",
  "him",
  "his",
  "i",
  "if",
  "into",
  "is",
  "it",
  "its",
  "just",
  "may",
  "might",
  "more",
  "most",
  "must",
  "my",
  "no",
  "not",
  "of",
  "one",
  "only",
  "on",
  "or",
  "our",
  "ours",
  "out",
  "over",
  "same",
  "she",
  "should",
  "some",
  "such",
  "the",
  "their",
  "theirs",
  "them",
  "then",
  "there",
  "this",
  "that",
  "to",
  "too",
  "up",
  "via",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "would",
  "with",
  "you",
  "your",
  "about",
  "after",
  "before",
  "channel",
  "channels",
  "daily",
  "weekly",
  "cron",
  "discussion",
  "discussions",
  "group",
  "groups",
  "update",
  "updates",
  "message",
  "messages",
  "memory",
  "memories",
  "note",
  "notes",
  "people",
  "person",
  "priority",
  "role",
  "roles",
  "server",
  "servers",
  "skill",
  "skills",
  "team",
  "teams",
  "system",
  "config",
  "task",
  "tasks",
  "project",
  "projects",
  "issue",
  "issues",
  "local",
  "import",
  "json",
  "md",
  "path",
  "file",
  "files",
  "user",
  "users",
  "today",
  "tomorrow",
  "yesterday",
  "进行",
  "相关",
  "需要",
  "通过",
  "系统",
  "配置",
  "消息",
  "更新",
  "任务",
  "项目",
  "文件",
  "本地",
  "导入",
  "今天",
  "明天",
  "昨天",
]);

function normalizeDerivedTagValue(value: string): string {
  return normalizeTagSignal(
    value
      .trim()
      .replace(/^[`"'#]+|[`"']+$/g, "")
      .replace(/\s+/g, " "),
  );
}

function cleanDisplayValue(value: string): string {
  return value
    .trim()
    .replace(/^[`"']+|[`"']+$/g, "")
    .replace(/\s+/g, " ");
}

function normalizeCategories(
  matchMap: Map<string, MemoryAnalysisMatch> | null | undefined,
  memoryId: string,
): string[] {
  return matchMap?.get(memoryId)?.categories ?? [];
}

function containsCJK(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value);
}

function isNumericLike(value: string): boolean {
  return /^[\d\s./:%+-]+$/.test(value) ||
    /^\d+(?:\.\d+)?(?:%|ms|s|m|h|d|w|mo|y|kb|mb|gb|tb|x)$/i.test(value);
}

function isDateOrTimeLike(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/i.test(value) ||
    /^\d{1,2}:\d{2}(?::\d{2})?$/i.test(value);
}

function looksLikeFileExtension(value: string): boolean {
  return FILE_EXTENSION_TOKENS.has(normalizeDerivedTagValue(value));
}

function isPersonLikeValue(value: string, personLikeLabels: Set<string>): boolean {
  const normalized = normalizeDerivedTagValue(value);

  return personLikeLabels.has(normalized) ||
    /^@[a-z0-9._-]{2,}$/i.test(value) ||
    /^[A-Z][a-z]+$/.test(value) ||
    /^[A-Z][a-z]+ [A-Z][a-z]+(?: [A-Z][a-z]+)?$/.test(value);
}

function isMeaningfulSegment(value: string): boolean {
  const normalized = normalizeDerivedTagValue(value);
  if (!normalized) {
    return false;
  }

  if (DERIVED_TAG_STOPWORDS.has(normalized) || isLowSignalAggregationTag(normalized)) {
    return false;
  }

  if (looksLikeFileExtension(normalized) || isNumericLike(normalized) || isDateOrTimeLike(normalized)) {
    return false;
  }

  if (containsCJK(normalized)) {
    return normalized.length >= 2;
  }

  return normalized.length >= 3;
}

type SegmenterLike = {
  segment: (content: string) => Iterable<{
    segment: string;
    isWordLike?: boolean;
  }>;
};

function getSegmenter(): SegmenterLike | null {
  const maybeIntl = Intl as typeof Intl & {
    Segmenter?: new (
      locales?: string | string[],
      options?: { granularity: "grapheme" | "word" | "sentence" },
    ) => SegmenterLike;
  };

  if (typeof Intl === "undefined" || typeof maybeIntl.Segmenter === "undefined") {
    return null;
  }

  return new maybeIntl.Segmenter("zh-CN", { granularity: "word" });
}

function extractSegmentCandidates(content: string): string[] {
  const segmenter = getSegmenter();

  if (segmenter) {
    const segments: string[] = [];
    for (const segment of segmenter.segment(content)) {
      if (!segment.isWordLike) {
        continue;
      }

      segments.push(segment.segment);
    }
    return segments;
  }

  return content.match(/[\p{Letter}\p{Number}][\p{Letter}\p{Number}._/-]{1,}/gu) ?? [];
}

function extractStructuredCandidates(content: string): string[] {
  const candidates: string[] = [];

  for (const match of content.matchAll(/`([^`]{2,120})`/g)) {
    if (match[1]) {
      candidates.push(match[1]);
    }
  }

  for (const match of content.matchAll(
    /\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s`"'<>]*)?/gi,
  )) {
    if (match[0]) {
      candidates.push(match[0]);
    }
  }

  for (const match of content.matchAll(/\b(?:\/[\w.-]+)+(?:\/[\w.-]+)*\b/g)) {
    if (match[0]) {
      candidates.push(match[0]);
    }
  }

  for (const match of content.matchAll(
    /\b(?:@[a-z0-9-]+\/)?[a-z0-9]+(?:[-_/][a-z0-9]+)+\b/gi,
  )) {
    if (match[0]) {
      candidates.push(match[0]);
    }
  }

  for (const match of content.matchAll(/\b[a-z]+(?:[A-Z][a-z0-9]+)+\b/g)) {
    if (match[0]) {
      candidates.push(match[0]);
    }
  }

  for (const match of content.matchAll(/\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+\b/g)) {
    if (match[0]) {
      candidates.push(match[0]);
    }
  }

  return candidates;
}

function addCandidate(
  target: Map<string, MemoryDerivedTagCandidate>,
  rawValue: string,
  source: DerivedTagSource,
  personLikeLabels: Set<string>,
): void {
  const displayValue = cleanDisplayValue(rawValue);
  const normalizedValue = normalizeDerivedTagValue(displayValue);
  if (!displayValue || !normalizedValue || !isMeaningfulSegment(displayValue)) {
    return;
  }

  if (isPersonLikeValue(displayValue, personLikeLabels)) {
    return;
  }

  const existing = target.get(normalizedValue);
  if (!existing || SOURCE_PRIORITY[source] < SOURCE_PRIORITY[existing.source]) {
    target.set(normalizedValue, {
      source,
      normalizedValue,
      displayValue,
    });
  }
}

function collectMemoryCandidates(memory: Memory): MemoryDerivedTagCandidate[] {
  const candidates = new Map<string, MemoryDerivedTagCandidate>();
  const entities = extractMemoryInsightEntities(memory);
  const personLikeLabels = new Set(
    entities
      .filter((entity) => entity.kind === "person_like")
      .map((entity) => entity.normalizedLabel),
  );

  extractStructuredCandidates(memory.content).forEach((value) => {
    addCandidate(candidates, value, "structured", personLikeLabels);
  });

  entities
    .filter((entity) => entity.kind === "named_term")
    .forEach((entity) => {
      addCandidate(candidates, entity.label, "named_term", personLikeLabels);
    });

  extractSegmentCandidates(memory.content).forEach((value) => {
    addCandidate(candidates, value, "segmented", personLikeLabels);
  });

  return [...candidates.values()];
}

export function createMemoryDerivedAnalysis(memory: Memory): MemoryDerivedAnalysis {
  return {
    memoryId: memory.id,
    rawTags: filterLowSignalAggregationTags(memory.tags),
    candidates: collectMemoryCandidates(memory),
  };
}

function incrementCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function getTopDisplayLabel(displayCounts: Map<string, number>, fallback: string): string {
  const [entry] = [...displayCounts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "en"),
  );

  return entry?.[0] ?? fallback;
}

function getMaxCategoryCount(categoryCounts: Map<string, number>): number {
  return Math.max(...categoryCounts.values(), 0);
}

function buildTagStats(
  memories: Memory[],
  rawTagsByMemoryId: Map<string, string[]>,
  derivedTagsByMemoryId: Map<string, string[]>,
): {
  tagStats: LocalDerivedTagStat[];
  tagSourceByValue: Map<string, DerivedTagOrigin>;
} {
  const aggregates = new Map<string, TagAggregate>();

  for (const memory of memories) {
    const rawTags = rawTagsByMemoryId.get(memory.id) ?? [];
    const derivedTags = derivedTagsByMemoryId.get(memory.id) ?? [];
    const combined = [...new Set([...rawTags, ...derivedTags].map(normalizeDerivedTagValue))];

    combined.forEach((normalizedValue) => {
      const aggregate = aggregates.get(normalizedValue) ?? {
        normalizedValue,
        count: 0,
        rawCount: 0,
        derivedCount: 0,
        displayCounts: new Map<string, number>(),
      };

      aggregate.count += 1;

      rawTags
        .filter((tag) => normalizeDerivedTagValue(tag) === normalizedValue)
        .forEach((tag) => {
          aggregate.rawCount += 1;
          incrementCount(aggregate.displayCounts, tag);
        });
      derivedTags
        .filter((tag) => normalizeDerivedTagValue(tag) === normalizedValue)
        .forEach((tag) => {
          aggregate.derivedCount += 1;
          incrementCount(aggregate.displayCounts, tag);
        });

      aggregates.set(normalizedValue, aggregate);
    });
  }

  const tagSourceByValue = new Map<string, DerivedTagOrigin>();
  const tagStats = [...aggregates.values()]
    .map((aggregate) => {
      const origin: DerivedTagOrigin = aggregate.rawCount > 0 && aggregate.derivedCount > 0
        ? "mixed"
        : aggregate.rawCount > 0
          ? "raw"
          : "derived";
      const value = getTopDisplayLabel(aggregate.displayCounts, aggregate.normalizedValue);
      tagSourceByValue.set(aggregate.normalizedValue, origin);

      return {
        value,
        normalizedValue: aggregate.normalizedValue,
        count: aggregate.count,
        origin,
      };
    })
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.value.localeCompare(right.value, "en"),
    );

  return {
    tagStats,
    tagSourceByValue,
  };
}

export function buildLocalDerivedSignalIndex(
  input: BuildLocalDerivedSignalIndexInput,
): LocalDerivedSignalIndex {
  const matchMap = input.matchMap ?? null;
  const memoryAnalysisLookup = input.memoryAnalyses instanceof Map
    ? input.memoryAnalyses
    : new Map((input.memoryAnalyses ?? []).map((analysis) => [analysis.memoryId, analysis]));
  const rawTagsByMemoryId = new Map<string, string[]>();
  const memoryCandidates = new Map<string, MemoryDerivedTagCandidate[]>();
  const candidateAggregates = new Map<string, CandidateAggregate>();

  for (const memory of input.memories) {
    const derivedAnalysis = memoryAnalysisLookup.get(memory.id) ?? createMemoryDerivedAnalysis(memory);
    const rawTags = derivedAnalysis.rawTags;
    rawTagsByMemoryId.set(memory.id, rawTags);

    const candidates = derivedAnalysis.candidates;
    memoryCandidates.set(memory.id, candidates);

    const categories = normalizeCategories(matchMap, memory.id);
    candidates.forEach((candidate) => {
      const aggregate = candidateAggregates.get(candidate.normalizedValue) ?? {
        normalizedValue: candidate.normalizedValue,
        memoryIds: new Set<string>(),
        categoryCounts: new Map<string, number>(),
        displayCounts: new Map<string, number>(),
      };

      aggregate.memoryIds.add(memory.id);
      categories.forEach((category) => incrementCount(aggregate.categoryCounts, category));
      incrementCount(aggregate.displayCounts, candidate.displayValue);
      candidateAggregates.set(candidate.normalizedValue, aggregate);
    });
  }

  const derivedTagsByMemoryId = new Map<string, string[]>();
  const combinedTagsByMemoryId = new Map<string, string[]>();

  for (const memory of input.memories) {
    const rawTags = rawTagsByMemoryId.get(memory.id) ?? [];

    if (rawTags.length > 0) {
      derivedTagsByMemoryId.set(memory.id, []);
      combinedTagsByMemoryId.set(memory.id, rawTags);
      continue;
    }

    const candidates = memoryCandidates.get(memory.id) ?? [];
    const selectedDerivedTags = candidates
      .filter((candidate) => {
        const aggregate = candidateAggregates.get(candidate.normalizedValue);
        if (!aggregate) {
          return false;
        }

        return aggregate.memoryIds.size >= 2 || getMaxCategoryCount(aggregate.categoryCounts) >= 2;
      })
      .sort((left, right) => {
        const leftAggregate = candidateAggregates.get(left.normalizedValue)!;
        const rightAggregate = candidateAggregates.get(right.normalizedValue)!;
        const leftCategoryCount = getMaxCategoryCount(leftAggregate.categoryCounts);
        const rightCategoryCount = getMaxCategoryCount(rightAggregate.categoryCounts);
        const leftConcentration = leftAggregate.memoryIds.size > 0
          ? leftCategoryCount / leftAggregate.memoryIds.size
          : 0;
        const rightConcentration = rightAggregate.memoryIds.size > 0
          ? rightCategoryCount / rightAggregate.memoryIds.size
          : 0;

        return SOURCE_PRIORITY[left.source] - SOURCE_PRIORITY[right.source] ||
          rightAggregate.memoryIds.size - leftAggregate.memoryIds.size ||
          rightCategoryCount - leftCategoryCount ||
          rightConcentration - leftConcentration ||
          left.displayValue.localeCompare(right.displayValue, "en");
      })
      .slice(0, MAX_DERIVED_TAGS_PER_MEMORY)
      .map((candidate) => {
        const aggregate = candidateAggregates.get(candidate.normalizedValue);
        return getTopDisplayLabel(
          aggregate?.displayCounts ?? new Map<string, number>(),
          candidate.displayValue,
        );
      });

    derivedTagsByMemoryId.set(memory.id, selectedDerivedTags);
    combinedTagsByMemoryId.set(memory.id, selectedDerivedTags);
  }

  const { tagStats, tagSourceByValue } = buildTagStats(
    input.memories,
    rawTagsByMemoryId,
    derivedTagsByMemoryId,
  );

  return {
    derivedTagsByMemoryId,
    combinedTagsByMemoryId,
    tagStats,
    tagSourceByValue,
  };
}

export function getCombinedTagsForMemory(
  memory: Memory,
  signalIndex: LocalDerivedSignalIndex,
): string[] {
  return signalIndex.combinedTagsByMemoryId.get(memory.id) ??
    filterLowSignalAggregationTags(memory.tags);
}

export function getDerivedTagsForMemory(
  memory: Memory,
  signalIndex: LocalDerivedSignalIndex,
): string[] {
  return signalIndex.derivedTagsByMemoryId.get(memory.id) ?? [];
}

export function getDerivedTagOrigin(
  tag: string,
  signalIndex: LocalDerivedSignalIndex,
): DerivedTagOrigin | null {
  return signalIndex.tagSourceByValue.get(normalizeDerivedTagValue(tag)) ?? null;
}
