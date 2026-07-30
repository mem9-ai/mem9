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

const DEFAULT_DERIVED_SIGNALS_MINIMUM_MEMORY_COUNT = 80;

let backgroundWorker: Worker | null = null;
let nextRequestID = 1;
const pendingRequests = new Map<
  number,
  {
    resolve: (value: WorkerResult) => void;
    reject: (error: Error) => void;
  }
>();

function shouldUseBackgroundWorker(): boolean {
  return typeof window !== "undefined" &&
    typeof Worker !== "undefined" &&
    import.meta.env.MODE !== "test";
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
    minimumMemoryCount = DEFAULT_DERIVED_SIGNALS_MINIMUM_MEMORY_COUNT,
    workerAvailable = shouldUseBackgroundWorker(),
  } = input;

  return enabled && workerAvailable && memoryCount >= minimumMemoryCount;
}

function getWorker(): Worker {
  if (backgroundWorker) {
    return backgroundWorker;
  }

  backgroundWorker = new Worker(
    new URL("./memory-insight-background.worker.ts", import.meta.url),
    { type: "module" },
  );
  backgroundWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    const pending = pendingRequests.get(response.id);
    if (!pending) {
      return;
    }

    pendingRequests.delete(response.id);
    if (response.ok) {
      pending.resolve(response.result);
      return;
    }

    pending.reject(new Error(response.error));
  };

  backgroundWorker.onerror = (event) => {
    const error = new Error(event.message || "Background insight worker failed");
    for (const [id, pending] of pendingRequests.entries()) {
      pending.reject(error);
      pendingRequests.delete(id);
    }
  };

  return backgroundWorker;
}

function runWorkerTask<T extends WorkerResult>(
  request: Omit<WorkerRequest, "id">,
): Promise<T> {
  const worker = getWorker();
  const id = nextRequestID;
  nextRequestID += 1;

  return new Promise<T>((resolve, reject) => {
    pendingRequests.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
    });
    worker.postMessage({ ...request, id });
  });
}

function useBackgroundComputation<T extends WorkerResult>({
  workerEnabled,
  request,
  computeSync,
  emptyValue,
  deps,
}: {
  workerEnabled: boolean;
  request: Omit<WorkerRequest, "id">;
  computeSync: () => T;
  emptyValue: T;
  deps: readonly unknown[];
}): { data: T; isComputing: boolean } {
  const syncValue = useMemo(
    () => (workerEnabled ? emptyValue : computeSync()),
    [computeSync, emptyValue, workerEnabled],
  );
  const [data, setData] = useState<T>(syncValue);
  const [isComputing, setIsComputing] = useState(workerEnabled);

  useEffect(() => {
    if (!workerEnabled) {
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
    setIsComputing(true);

    runWorkerTask<T>(request)
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
          setData(computeSync());
          setIsComputing(false);
        });
      });

    return () => {
      cancelled = true;
    };
  }, deps);

  if (!workerEnabled) {
    return { data: syncValue, isComputing: false };
  }

  return { data, isComputing };
}

export function useBackgroundDerivedSignals({
  memories,
  matchMap,
  enabled = true,
  minimumMemoryCount = DEFAULT_DERIVED_SIGNALS_MINIMUM_MEMORY_COUNT,
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
  const matches = useMemo(() => [...matchMap.values()], [matchMap]);
  const projectedMemories = useMemo(
    () => memories.map(projectInsightWorkerMemory),
    [memories],
  );

  return useBackgroundComputation({
    workerEnabled,
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
    deps: [workerEnabled, projectedMemories, memories, matches, matchMap],
  });
}

export function useBackgroundMemoryInsightGraph({
  cards,
  memories,
  matchMap,
}: {
  cards: AnalysisCategoryCard[];
  memories: Memory[];
  matchMap: Map<string, MemoryAnalysisMatch>;
}): { data: MemoryInsightGraph; isComputing: boolean } {
  const workerEnabled = shouldUseBackgroundWorker();
  const boundedInput = useMemo(
    () => buildBoundedMemoryInsightGraphInput({ memories, matchMap }),
    [memories, matchMap],
  );

  return useBackgroundComputation({
    workerEnabled,
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
    deps: [workerEnabled, cards, boundedInput],
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
}: {
  cards: AnalysisCategoryCard[];
  memories: Memory[];
  matchMap: Map<string, MemoryAnalysisMatch>;
  activeCategory?: string;
  activeTag?: string;
  relationType?: MemoryInsightRelationType;
  minimumCoOccurrence?: number;
}): { data: MemoryInsightRelationGraph; isComputing: boolean } {
  const workerEnabled = shouldUseBackgroundWorker();
  const boundedInput = useMemo(
    () => buildBoundedMemoryInsightRelationGraphInput({ memories, matchMap }),
    [memories, matchMap],
  );

  return useBackgroundComputation({
    workerEnabled,
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
      cards,
      boundedInput,
      activeCategory,
      activeTag,
      relationType,
      minimumCoOccurrence,
    ],
  });
}
