import { startTransition, useEffect, useMemo, useState } from "react";
import {
  buildLocalDerivedSignalIndex,
  type LocalDerivedSignalIndex,
} from "@/lib/memory-derived-signals";
import {
  buildMemoryInsightGraph,
  DEFAULT_MEMORY_INSIGHT_GRAPH_BUDGET,
  type MemoryInsightGraph,
  type MemoryInsightGraphBudget,
} from "@/lib/memory-insight";
import {
  buildMemoryInsightRelationGraph,
  DEFAULT_MEMORY_INSIGHT_RELATION_GRAPH_BUDGET,
  type MemoryInsightRelationGraph,
  type MemoryInsightRelationGraphBudget,
  type MemoryInsightRelationType,
} from "@/lib/memory-insight-relations";
import type {
  AnalysisCategoryCard,
  MemoryAnalysisMatch,
} from "@/types/analysis";
import type { Memory } from "@/types/memory";

export interface InsightWorkerMemory {
  id: string;
  content: string;
  created_at: string;
  updated_at: string;
  tags: string[];
}

type WorkerRequest =
  | {
      id: number;
      type: "derived-signals";
      payload: {
        memories: InsightWorkerMemory[];
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

export const EMPTY_LOCAL_DERIVED_SIGNAL_INDEX: LocalDerivedSignalIndex = {
  derivedTagsByMemoryId: new Map(),
  combinedTagsByMemoryId: new Map(),
  tagStats: [],
  tagSourceByValue: new Map(),
};

export const EMPTY_MEMORY_INSIGHT_GRAPH: MemoryInsightGraph = {
  nodes: [],
  edges: [],
  cards: [],
  tags: [],
  entities: [],
  memories: [],
};

export const EMPTY_MEMORY_INSIGHT_RELATION_GRAPH: MemoryInsightRelationGraph = {
  totalMemories: 0,
  entities: [],
  edges: [],
  entitiesById: new Map(),
  edgesById: new Map(),
  topEntityIds: [],
  topEdgeIds: [],
  bridgeEntities: [],
  clusters: [],
  risingEntities: [],
};

const DEFAULT_BACKGROUND_WORKER_MINIMUM_MEMORY_COUNT = 80;
const EMPTY_WORKER_MEMORIES: InsightWorkerMemory[] = [];
const EMPTY_ANALYSIS_MATCHES: MemoryAnalysisMatch[] = [];
const EMPTY_MEMORY_GRAPH_INPUT = {
  memories: [] as Memory[],
  matches: EMPTY_ANALYSIS_MATCHES,
  matchMap: new Map<string, MemoryAnalysisMatch>(),
};

let nextRequestID = 1;

interface ActiveWorkerTask {
  cancel: (error?: Error) => void;
}

interface WorkerTaskHandle<T extends WorkerResult> extends ActiveWorkerTask {
  promise: Promise<T>;
}

const activeWorkerTasks = new Set<ActiveWorkerTask>();

function shouldUseBackgroundWorker(): boolean {
  return typeof window !== "undefined" &&
    typeof Worker !== "undefined";
}

export function projectInsightWorkerMemory(memory: Memory): InsightWorkerMemory {
  return {
    id: memory.id,
    content: memory.content,
    created_at: memory.created_at,
    updated_at: memory.updated_at,
    tags: memory.tags.slice(),
  };
}

export function buildBoundedMemoryInsightGraphInput({
  memories,
  matchMap,
  budget = DEFAULT_MEMORY_INSIGHT_GRAPH_BUDGET,
}: {
  memories: Memory[];
  matchMap: Map<string, MemoryAnalysisMatch>;
  budget?: MemoryInsightGraphBudget;
}): {
  memories: Memory[];
  matches: MemoryAnalysisMatch[];
  matchMap: Map<string, MemoryAnalysisMatch>;
} {
  const boundedMemories = memories.length > budget.maxSourceMemories
    ? memories.slice(0, budget.maxSourceMemories)
    : memories;
  const boundedMatches: MemoryAnalysisMatch[] = [];
  const boundedMatchMap = new Map<string, MemoryAnalysisMatch>();

  for (const memory of boundedMemories) {
    const match = matchMap.get(memory.id);
    if (match) {
      boundedMatches.push(match);
      boundedMatchMap.set(memory.id, match);
    }
  }

  return {
    memories: boundedMemories,
    matches: boundedMatches,
    matchMap: boundedMatchMap,
  };
}

export function buildBoundedMemoryInsightRelationGraphInput({
  memories,
  matchMap,
  budget = DEFAULT_MEMORY_INSIGHT_RELATION_GRAPH_BUDGET,
}: {
  memories: Memory[];
  matchMap: Map<string, MemoryAnalysisMatch>;
  budget?: MemoryInsightRelationGraphBudget;
}): {
  memories: Memory[];
  matches: MemoryAnalysisMatch[];
  matchMap: Map<string, MemoryAnalysisMatch>;
} {
  const boundedMemories =
    memories.length > budget.maxSourceMemories
      ? memories.slice(0, budget.maxSourceMemories)
      : memories;
  const boundedMatches: MemoryAnalysisMatch[] = [];
  const boundedMatchMap = new Map<string, MemoryAnalysisMatch>();

  for (const memory of boundedMemories) {
    const match = matchMap.get(memory.id);
    if (match) {
      boundedMatches.push(match);
      boundedMatchMap.set(memory.id, match);
    }
  }

  return {
    memories: boundedMemories,
    matches: boundedMatches,
    matchMap: boundedMatchMap,
  };
}

export function shouldUseDerivedSignalsWorker(input: {
  enabled?: boolean;
  memoryCount: number;
  minimumMemoryCount?: number;
  workerAvailable?: boolean;
}): boolean {
  const {
    enabled = true,
    memoryCount,
    minimumMemoryCount = DEFAULT_BACKGROUND_WORKER_MINIMUM_MEMORY_COUNT,
    workerAvailable = shouldUseBackgroundWorker(),
  } = input;

  return enabled && workerAvailable && memoryCount >= minimumMemoryCount;
}

export function disposeMemoryInsightBackgroundWorker(
  error = new Error("Background insight worker disposed"),
): void {
  for (const task of [...activeWorkerTasks]) {
    task.cancel(error);
  }
}

function runWorkerTask<T extends WorkerResult>(
  request: Omit<WorkerRequest, "id">,
): WorkerTaskHandle<T> {
  const id = nextRequestID;
  nextRequestID += 1;
  let worker: Worker | null = null;
  let handle: WorkerTaskHandle<T> | null = null;
  let rejectTask: ((error: Error) => void) | null = null;
  let settled = false;

  const terminateWorker = () => {
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      worker = null;
    }
    if (handle) {
      activeWorkerTasks.delete(handle);
    }
  };

  const promise = new Promise<T>((resolve, reject) => {
    rejectTask = reject;
    try {
      worker = new Worker(
        new URL("./memory-insight-background.worker.ts", import.meta.url),
        { type: "module" },
      );
    } catch (error) {
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      if (settled || response.id !== id) {
        return;
      }

      settled = true;
      terminateWorker();
      if (response.ok) {
        resolve(response.result as T);
        return;
      }

      reject(new Error(response.error));
    };
    worker.onerror = (event) => {
      if (settled) {
        return;
      }

      settled = true;
      terminateWorker();
      reject(new Error(event.message || "Background insight worker failed"));
    };

    try {
      worker.postMessage({ ...request, id });
    } catch (error) {
      settled = true;
      terminateWorker();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });

  handle = {
    promise,
    cancel: (
      error = new Error("Background insight worker task cancelled"),
    ) => {
      if (settled) {
        return;
      }

      settled = true;
      terminateWorker();
      rejectTask?.(error);
    },
  };
  if (!settled) {
    activeWorkerTasks.add(handle);
  }

  return handle;
}

function useBackgroundComputation<T extends WorkerResult>({
  enabled,
  workerEnabled,
  syncEnabled,
  request,
  computeSync,
  emptyValue,
  deps,
}: {
  enabled: boolean;
  workerEnabled: boolean;
  syncEnabled: boolean;
  request: Omit<WorkerRequest, "id">;
  computeSync: () => T;
  emptyValue: T;
  deps: readonly unknown[];
}): { data: T; isComputing: boolean } {
  const syncValue = useMemo(
    () => {
      if (!enabled || workerEnabled || !syncEnabled) {
        return emptyValue;
      }

      return computeSync();
    },
    [computeSync, emptyValue, enabled, syncEnabled, workerEnabled],
  );
  const [data, setData] = useState<T>(syncValue);
  const [isComputing, setIsComputing] = useState(enabled && workerEnabled);

  useEffect(() => {
    if (!enabled || !workerEnabled) {
      setData(emptyValue);
      setIsComputing(false);
      return;
    }

    if (
      request.type === "derived-signals" &&
      request.payload.memories.length === 0
    ) {
      setData(emptyValue);
      setIsComputing(false);
      return;
    }

    let cancelled = false;
    setData(emptyValue);
    setIsComputing(true);

    const workerTask = runWorkerTask<T>(request);
    workerTask.promise
      .then((result) => {
        if (cancelled) {
          return;
        }

        startTransition(() => {
          setData(result);
          setIsComputing(false);
        });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        startTransition(() => {
          setData(emptyValue);
          setIsComputing(false);
        });
      });

    return () => {
      cancelled = true;
      workerTask.cancel();
    };
  }, deps);

  if (!enabled || !workerEnabled) {
    return { data: syncValue, isComputing: false };
  }

  return { data, isComputing };
}

export function useBackgroundDerivedSignals({
  memories,
  matchMap,
  enabled = true,
  minimumMemoryCount = DEFAULT_BACKGROUND_WORKER_MINIMUM_MEMORY_COUNT,
}: {
  memories: Memory[];
  matchMap: Map<string, MemoryAnalysisMatch>;
  enabled?: boolean;
  minimumMemoryCount?: number;
}): { data: LocalDerivedSignalIndex; isComputing: boolean } {
  const workerEnabled = shouldUseDerivedSignalsWorker({
    enabled,
    memoryCount: memories.length,
    minimumMemoryCount,
  });
  const matches = useMemo(
    () => enabled ? [...matchMap.values()] : EMPTY_ANALYSIS_MATCHES,
    [enabled, matchMap],
  );
  const projectedMemories = useMemo(
    () => enabled
      ? memories.map(projectInsightWorkerMemory)
      : EMPTY_WORKER_MEMORIES,
    [enabled, memories],
  );

  return useBackgroundComputation({
    enabled,
    workerEnabled,
    syncEnabled: enabled && memories.length < minimumMemoryCount,
    request: {
      type: "derived-signals",
      payload: {
        memories: projectedMemories,
        matches,
      },
    },
    computeSync: () =>
      buildLocalDerivedSignalIndex({
        memories,
        matchMap,
      }),
    emptyValue: EMPTY_LOCAL_DERIVED_SIGNAL_INDEX,
    deps: [enabled, workerEnabled, projectedMemories, memories, matches, matchMap],
  });
}

export function useBackgroundMemoryInsightGraph({
  cards,
  memories,
  matchMap,
  enabled = true,
}: {
  cards: AnalysisCategoryCard[];
  memories: Memory[];
  matchMap: Map<string, MemoryAnalysisMatch>;
  enabled?: boolean;
}): { data: MemoryInsightGraph; isComputing: boolean } {
  const workerEnabled = enabled && shouldUseBackgroundWorker();
  const boundedInput = useMemo(
    () =>
      enabled
        ? buildBoundedMemoryInsightGraphInput({ memories, matchMap })
        : EMPTY_MEMORY_GRAPH_INPUT,
    [enabled, memories, matchMap],
  );

  return useBackgroundComputation({
    enabled,
    workerEnabled,
    syncEnabled: enabled &&
      memories.length < DEFAULT_BACKGROUND_WORKER_MINIMUM_MEMORY_COUNT,
    request: {
      type: "insight-graph",
      payload: {
        cards,
        memories: boundedInput.memories,
        matches: boundedInput.matches,
      },
    },
    computeSync: () =>
      buildMemoryInsightGraph({
        cards,
        memories: boundedInput.memories,
        matchMap: boundedInput.matchMap,
    }),
    emptyValue: EMPTY_MEMORY_INSIGHT_GRAPH,
    deps: [enabled, workerEnabled, cards, boundedInput],
  });
}

export function useBackgroundMemoryInsightRelationGraph({
  cards,
  memories,
  matchMap,
  activeCategory,
  activeTag,
  relationType,
  minimumCoOccurrence,
  enabled = true,
}: {
  cards: AnalysisCategoryCard[];
  memories: Memory[];
  matchMap: Map<string, MemoryAnalysisMatch>;
  activeCategory?: string;
  activeTag?: string;
  relationType?: MemoryInsightRelationType;
  minimumCoOccurrence?: number;
  enabled?: boolean;
}): { data: MemoryInsightRelationGraph; isComputing: boolean } {
  const workerEnabled = enabled && shouldUseBackgroundWorker();
  const boundedInput = useMemo(
    () =>
      enabled
        ? buildBoundedMemoryInsightRelationGraphInput({ memories, matchMap })
        : EMPTY_MEMORY_GRAPH_INPUT,
    [enabled, memories, matchMap],
  );

  return useBackgroundComputation({
    enabled,
    workerEnabled,
    syncEnabled: enabled &&
      memories.length < DEFAULT_BACKGROUND_WORKER_MINIMUM_MEMORY_COUNT,
    request: {
      type: "relation-graph",
      payload: {
        cards,
        memories: boundedInput.memories,
        matches: boundedInput.matches,
        activeCategory,
        activeTag,
        relationType,
        minimumCoOccurrence,
      },
    },
    computeSync: () =>
      buildMemoryInsightRelationGraph({
        cards,
        memories: boundedInput.memories,
        matchMap: boundedInput.matchMap,
        activeCategory,
        activeTag,
        relationType,
        minimumCoOccurrence,
      }),
    emptyValue: EMPTY_MEMORY_INSIGHT_RELATION_GRAPH,
    deps: [
      workerEnabled,
      enabled,
      cards,
      boundedInput,
      activeCategory,
      activeTag,
      relationType,
      minimumCoOccurrence,
    ],
  });
}
