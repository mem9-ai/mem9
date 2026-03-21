/// <reference lib="webworker" />

import {
  buildLocalDerivedSignalIndex,
  createMemoryDerivedAnalysis,
  type LocalDerivedSignalIndex,
  type MemoryDerivedAnalysis,
} from "@/lib/memory-derived-signals";
import {
  buildMemoryInsightGraph,
  type MemoryInsightGraph,
} from "@/lib/memory-insight";
import {
  buildMemoryInsightRelationGraph,
  type MemoryInsightRelationGraph,
  type MemoryInsightRelationType,
} from "@/lib/memory-insight-relations";
import type {
  AnalysisCategoryCard,
  MemoryAnalysisMatch,
} from "@/types/analysis";
import type { Memory } from "@/types/memory";

type WorkerRequest =
  | {
      id: number;
      type: "derived-signals";
      payload: {
        memories: Memory[];
        matches: MemoryAnalysisMatch[];
      };
    }
  | {
      id: number;
      type: "insight-graph";
      payload: {
        cards: AnalysisCategoryCard[];
        memories: Memory[];
        matches: MemoryAnalysisMatch[];
      };
    }
  | {
      id: number;
      type: "relation-graph";
      payload: {
        cards: AnalysisCategoryCard[];
        memories: Memory[];
        matches: MemoryAnalysisMatch[];
        activeCategory?: string;
        activeTag?: string;
        relationType?: MemoryInsightRelationType;
        minimumCoOccurrence?: number;
      };
    };

type WorkerResult =
  | LocalDerivedSignalIndex
  | MemoryInsightGraph
  | MemoryInsightRelationGraph;

type WorkerResponse =
  | {
      id: number;
      ok: true;
      result: WorkerResult;
    }
  | {
      id: number;
      ok: false;
      error: string;
    };

const MAX_MEMORY_ANALYSIS_CACHE = 2048;
const MAX_RESULT_CACHE = 128;

const memoryAnalysisCache = new Map<string, MemoryDerivedAnalysis>();
const derivedSignalCache = new Map<string, LocalDerivedSignalIndex>();
const insightGraphCache = new Map<string, MemoryInsightGraph>();
const relationGraphCache = new Map<string, MemoryInsightRelationGraph>();

function stableHash(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function setBoundedCache<T>(cache: Map<string, T>, key: string, value: T, maxSize: number): T {
  if (cache.has(key)) {
    cache.delete(key);
  }

  cache.set(key, value);
  if (cache.size > maxSize) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) {
      cache.delete(oldestKey);
    }
  }

  return value;
}

function createMemoryAnalysisKey(memory: Memory): string {
  return stableHash([
    memory.id,
    String(memory.version),
    memory.created_at,
    memory.updated_at,
    memory.memory_type,
    memory.source,
    memory.content,
    memory.tags.join("\u0001"),
  ].join("\u241f"));
}

function createMatchesKey(matches: MemoryAnalysisMatch[]): string {
  return stableHash(
    matches
      .map((match) =>
        `${match.memoryId}:${match.categories.slice().sort((left, right) => left.localeCompare(right, "en")).join(",")}`,
      )
      .sort((left, right) => left.localeCompare(right, "en"))
      .join("\u241e"),
  );
}

function createCardsKey(cards: AnalysisCategoryCard[]): string {
  return stableHash(
    cards
      .map((card) => `${card.category}:${card.count}:${card.confidence}`)
      .sort((left, right) => left.localeCompare(right, "en"))
      .join("\u241e"),
  );
}

function createMemorySetKey(memories: Memory[]): string {
  return stableHash(
    memories
      .map((memory) => createMemoryAnalysisKey(memory))
      .sort((left, right) => left.localeCompare(right, "en"))
      .join("\u241e"),
  );
}

function buildSignalKey(memories: Memory[], matches: MemoryAnalysisMatch[]): string {
  return stableHash(`signals|${createMemorySetKey(memories)}|${createMatchesKey(matches)}`);
}

function buildInsightKey(
  cards: AnalysisCategoryCard[],
  memories: Memory[],
  matches: MemoryAnalysisMatch[],
): string {
  return stableHash(`insight|${createCardsKey(cards)}|${buildSignalKey(memories, matches)}`);
}

function buildRelationKey(
  cards: AnalysisCategoryCard[],
  memories: Memory[],
  matches: MemoryAnalysisMatch[],
  options: {
    activeCategory?: string;
    activeTag?: string;
    relationType?: MemoryInsightRelationType;
    minimumCoOccurrence?: number;
  },
): string {
  return stableHash([
    "relations",
    createCardsKey(cards),
    buildSignalKey(memories, matches),
    options.activeCategory ?? "",
    options.activeTag ?? "",
    options.relationType ?? "",
    String(options.minimumCoOccurrence ?? 1),
  ].join("\u241f"));
}

function getMemoryAnalyses(memories: Memory[]): MemoryDerivedAnalysis[] {
  return memories.map((memory) => {
    const key = createMemoryAnalysisKey(memory);
    const cached = memoryAnalysisCache.get(key);
    if (cached) {
      return cached;
    }

    return setBoundedCache(
      memoryAnalysisCache,
      key,
      createMemoryDerivedAnalysis(memory),
      MAX_MEMORY_ANALYSIS_CACHE,
    );
  });
}

function getOrBuildDerivedSignals(
  memories: Memory[],
  matches: MemoryAnalysisMatch[],
): LocalDerivedSignalIndex {
  const cacheKey = buildSignalKey(memories, matches);
  const cached = derivedSignalCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const result = buildLocalDerivedSignalIndex({
    memories,
    matchMap: new Map(matches.map((match) => [match.memoryId, match])),
    memoryAnalyses: getMemoryAnalyses(memories),
  });

  return setBoundedCache(derivedSignalCache, cacheKey, result, MAX_RESULT_CACHE);
}

function getOrBuildInsightGraph(
  cards: AnalysisCategoryCard[],
  memories: Memory[],
  matches: MemoryAnalysisMatch[],
): MemoryInsightGraph {
  const cacheKey = buildInsightKey(cards, memories, matches);
  const cached = insightGraphCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const signalIndex = getOrBuildDerivedSignals(memories, matches);
  const result = buildMemoryInsightGraph({
    cards,
    memories,
    matchMap: new Map(matches.map((match) => [match.memoryId, match])),
    signalIndex,
  });

  return setBoundedCache(insightGraphCache, cacheKey, result, MAX_RESULT_CACHE);
}

function getOrBuildRelationGraph(
  cards: AnalysisCategoryCard[],
  memories: Memory[],
  matches: MemoryAnalysisMatch[],
  options: {
    activeCategory?: string;
    activeTag?: string;
    relationType?: MemoryInsightRelationType;
    minimumCoOccurrence?: number;
  },
): MemoryInsightRelationGraph {
  const cacheKey = buildRelationKey(cards, memories, matches, options);
  const cached = relationGraphCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const signalIndex = getOrBuildDerivedSignals(memories, matches);
  const result = buildMemoryInsightRelationGraph({
    cards,
    memories,
    matchMap: new Map(matches.map((match) => [match.memoryId, match])),
    signalIndex,
    activeCategory: options.activeCategory,
    activeTag: options.activeTag,
    relationType: options.relationType,
    minimumCoOccurrence: options.minimumCoOccurrence,
  });

  return setBoundedCache(relationGraphCache, cacheKey, result, MAX_RESULT_CACHE);
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  try {
    let result: WorkerResult;

    switch (request.type) {
      case "derived-signals":
        result = getOrBuildDerivedSignals(request.payload.memories, request.payload.matches);
        break;
      case "insight-graph":
        result = getOrBuildInsightGraph(
          request.payload.cards,
          request.payload.memories,
          request.payload.matches,
        );
        break;
      case "relation-graph":
        result = getOrBuildRelationGraph(
          request.payload.cards,
          request.payload.memories,
          request.payload.matches,
          {
            activeCategory: request.payload.activeCategory,
            activeTag: request.payload.activeTag,
            relationType: request.payload.relationType,
            minimumCoOccurrence: request.payload.minimumCoOccurrence,
          },
        );
        break;
      default:
        throw new Error("Unsupported worker task");
    }

    const response: WorkerResponse = {
      id: request.id,
      ok: true,
      result,
    };
    self.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
