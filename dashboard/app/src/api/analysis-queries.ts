import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import { clearAnalysisCache, readAnalysisCache, writeAnalysisCache } from "./analysis-cache";
import { analysisApi, AnalysisApiError } from "./analysis-client";
import {
  applyUploadedBatch,
  buildCreateJobRequest,
  chunkAnalysisMemories,
  createBatchHash,
  createMemoryFingerprint,
  createPendingSnapshot,
  DEFAULT_TAXONOMY_VERSION,
  getAnalysisBatchSize,
  getDefaultPollMs,
  isDegradedAnalysisError,
  isTerminalJobStatus,
  mergeSnapshotWithUpdates,
  toAnalysisMemoryInput,
} from "./analysis-helpers";
import {
  buildAnalysisCardsFromMatches,
  createAnalysisMatchMap,
  matchMemoriesToTaxonomy,
} from "./analysis-matcher";
import {
  clearCachedAnalysisMatches,
  patchSyncState,
  readCachedAnalysisMatches,
  readCachedMemories,
  readSyncState,
  upsertCachedMemories,
  writeCachedAnalysisMatches,
} from "./local-cache";
import { features } from "@/config/features";
import { filterMemoriesForView, sortMemoriesByUpdatedAtDesc } from "@/lib/memory-filters";
import type {
  AnalysisCategoryCard,
  AnalysisJobSnapshotResponse,
  MemoryAnalysisMatch,
  SpaceAnalysisState,
  TaxonomyResponse,
} from "@/types/analysis";
import type { Memory } from "@/types/memory";
import type { TimeRangePreset } from "@/types/time-range";
import { presetToParams } from "@/types/time-range";

const PAGE_SIZE = 200;
const TERMINAL_BATCH_STATUSES = new Set(["SUCCEEDED", "FAILED", "DLQ"]);

const INITIAL_STATE: SpaceAnalysisState = {
  phase: "idle",
  snapshot: null,
  events: [],
  cursor: 0,
  error: null,
  warning: null,
  jobId: null,
  fingerprint: null,
  pollAfterMs: getDefaultPollMs(),
  isRetrying: false,
};

export function shouldStopPollingSnapshot(
  snapshot: AnalysisJobSnapshotResponse,
): boolean {
  if (isTerminalJobStatus(snapshot.status)) {
    return true;
  }

  if (snapshot.expectedTotalBatches === 0) {
    return false;
  }

  return (
    snapshot.progress.uploadedBatches >= snapshot.expectedTotalBatches &&
    snapshot.batchSummaries.length >= snapshot.expectedTotalBatches &&
    snapshot.batchSummaries.every((batch) =>
      TERMINAL_BATCH_STATUSES.has(batch.status),
    )
  );
}

async function syncAllMemories(spaceId: string): Promise<Memory[]> {
  const all: Memory[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    const page = await api.listMemories(spaceId, {
      limit: PAGE_SIZE,
      offset,
    });
    all.push(...page.memories);
    total = page.total;
    offset += page.limit;
  }

  await upsertCachedMemories(spaceId, all);
  await patchSyncState(spaceId, {
    hasFullCache: true,
    lastSyncedAt: new Date().toISOString(),
  });

  return sortMemoriesByUpdatedAtDesc(all);
}

async function loadSourceMemories(spaceId: string): Promise<Memory[]> {
  const [cached, syncState] = await Promise.all([
    readCachedMemories(spaceId),
    readSyncState(spaceId),
  ]);

  if (syncState?.hasFullCache) {
    return sortMemoriesByUpdatedAtDesc(cached);
  }

  return syncAllMemories(spaceId);
}

function trimEvents<T>(items: T[], limit: number): T[] {
  return items.slice(0, limit);
}

async function persistAnalysisSnapshot(
  spaceId: string,
  range: TimeRangePreset,
  jobId: string,
  fingerprint: string,
  snapshot: SpaceAnalysisState["snapshot"],
): Promise<void> {
  try {
    await writeAnalysisCache(spaceId, range, {
      fingerprint,
      jobId,
      updatedAt: new Date().toISOString(),
      taxonomyVersion: snapshot?.taxonomyVersion ?? DEFAULT_TAXONOMY_VERSION,
      snapshot,
    });
  } catch {
    // Ignore cache write failures so the main analysis flow can continue.
  }
}

export function useSpaceAnalysis(
  spaceId: string,
  range: TimeRangePreset,
): {
  state: SpaceAnalysisState;
  taxonomy: TaxonomyResponse | null;
  taxonomyUnavailable: boolean;
  cards: AnalysisCategoryCard[];
  matches: MemoryAnalysisMatch[];
  matchMap: Map<string, MemoryAnalysisMatch>;
  sourceMemories: Memory[];
  sourceCount: number;
  sourceLoading: boolean;
  retry: () => void;
} {
  const [state, setState] = useState<SpaceAnalysisState>(INITIAL_STATE);
  const [attempt, setAttempt] = useState(0);
  const [matches, setMatches] = useState<MemoryAnalysisMatch[]>([]);
  const [cards, setCards] = useState<AnalysisCategoryCard[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const runRef = useRef(0);
  const enabled = features.enableAnalysis && !!spaceId;
  const timeParams = useMemo(
    () => (range ? presetToParams(range) : undefined),
    [range],
  );

  const sourceQuery = useQuery({
    queryKey: ["analysis", "source-memories", spaceId, attempt],
    queryFn: () => loadSourceMemories(spaceId),
    enabled,
    staleTime: 30_000,
    retry: 1,
  });

  const sourceMemories = useMemo(
    () =>
      filterMemoriesForView(sourceQuery.data ?? [], {
        range,
      }),
    [range, sourceQuery.data],
  );

  const taxonomyQuery = useQuery({
    queryKey: ["analysis", "taxonomy", spaceId, DEFAULT_TAXONOMY_VERSION],
    queryFn: () => analysisApi.getTaxonomy(spaceId, DEFAULT_TAXONOMY_VERSION),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const taxonomyUnavailable = taxonomyQuery.error !== null;

  const matchMap = useMemo(
    () => createAnalysisMatchMap(matches),
    [matches],
  );

  useEffect(() => {
    if (!enabled) return;
    setState((current) => {
      if (current.warning === "poll_retrying") return current;
      return {
        ...current,
        warning: taxonomyUnavailable ? "taxonomy_unavailable" : null,
      };
    });
  }, [enabled, taxonomyUnavailable]);

  useEffect(() => {
    if (!enabled) {
      setMatches([]);
      setCards([]);
      setMatchesLoading(false);
      return;
    }

    if (sourceQuery.data === undefined) return;

    let cancelled = false;

    const loadMatches = async (): Promise<void> => {
      setMatchesLoading(true);

      if (sourceMemories.length === 0) {
        if (!cancelled) {
          setMatches([]);
          setCards([]);
          setMatchesLoading(false);
        }
        return;
      }

      try {
        if (taxonomyQuery.data) {
          const computedMatches = matchMemoriesToTaxonomy(
            sourceMemories,
            taxonomyQuery.data,
          );
          await clearCachedAnalysisMatches(spaceId, range);
          await writeCachedAnalysisMatches(spaceId, range, computedMatches);
          if (cancelled) return;

          setMatches(computedMatches);
          setCards(
            buildAnalysisCardsFromMatches(
              computedMatches,
              sourceMemories.length,
            ),
          );
          return;
        }

        const cachedMatches = await readCachedAnalysisMatches(spaceId, range);
        if (cancelled) return;

        setMatches(cachedMatches);
        setCards(
          buildAnalysisCardsFromMatches(cachedMatches, sourceMemories.length),
        );
      } finally {
        if (!cancelled) {
          setMatchesLoading(false);
        }
      }
    };

    void loadMatches();

    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    range,
    sourceMemories,
    sourceQuery.data,
    spaceId,
    taxonomyQuery.data,
  ]);

  useEffect(() => {
    if (!enabled) {
      setState(INITIAL_STATE);
      return;
    }
    if (sourceQuery.data === undefined) return;

    const currentRun = runRef.current + 1;
    runRef.current = currentRun;
    let cancelled = false;
    let timer: number | undefined;

    const updateState = (
      updater: (current: SpaceAnalysisState) => SpaceAnalysisState,
    ) => {
      startTransition(() => {
        setState((current) => updater(current));
      });
    };

    const finishWithError = (
      phase: "failed" | "degraded",
      error: string,
      fingerprint: string | null,
      jobId: string | null,
    ) => {
      updateState((current) => ({
        ...current,
        phase,
        error,
        warning: null,
        fingerprint,
        jobId,
        isRetrying: false,
      }));
    };

    const poll = async (
      jobId: string,
      fingerprint: string,
      nextCursor: number,
      delayMs: number,
    ): Promise<void> => {
      if (cancelled || runRef.current !== currentRun) return;
      try {
        const [updates, snapshot] = await Promise.all([
          analysisApi.getUpdates(spaceId, jobId, nextCursor),
          analysisApi.getSnapshot(spaceId, jobId),
        ]);

        if (cancelled || runRef.current !== currentRun) return;

        const mergedSnapshot = mergeSnapshotWithUpdates(snapshot, updates);
        const shouldStop = shouldStopPollingSnapshot(mergedSnapshot);
        await persistAnalysisSnapshot(
          spaceId,
          range,
          jobId,
          fingerprint,
          mergedSnapshot,
        );

        updateState((current) => ({
          ...current,
          phase: shouldStop ? "completed" : "processing",
          snapshot: mergedSnapshot,
          events: trimEvents([...updates.events].reverse(), 8),
          cursor: updates.nextCursor,
          error: null,
          warning: taxonomyUnavailable ? "taxonomy_unavailable" : null,
          jobId,
          fingerprint,
          pollAfterMs: delayMs,
          isRetrying: false,
        }));

        if (shouldStop) return;

        timer = window.setTimeout(() => {
          void poll(jobId, fingerprint, updates.nextCursor, delayMs);
        }, delayMs);
      } catch (error) {
        if (cancelled || runRef.current !== currentRun) return;
        const nextDelay = Math.min(delayMs * 2, 15_000);
        updateState((current) => ({
          ...current,
          phase: current.snapshot ? "processing" : current.phase,
          warning: "poll_retrying",
          isRetrying: true,
        }));
        timer = window.setTimeout(() => {
          void poll(jobId, fingerprint, nextCursor, nextDelay);
        }, nextDelay);
        if (
          error instanceof AnalysisApiError &&
          (error.status === 404 || error.status === 403)
        ) {
          await clearAnalysisCache(spaceId, range);
        }
      }
    };

    const run = async (): Promise<void> => {
      const memories = sourceMemories;
      if (memories.length === 0) {
        updateState(() => ({
          ...INITIAL_STATE,
          phase: "completed",
          warning: taxonomyUnavailable ? "taxonomy_unavailable" : null,
        }));
        await Promise.all([
          clearAnalysisCache(spaceId, range),
          clearCachedAnalysisMatches(spaceId, range),
        ]);
        return;
      }

      const fingerprint = await createMemoryFingerprint(memories);
      if (cancelled || runRef.current !== currentRun) return;

      const cached = await readAnalysisCache(spaceId, range);
      if (
        cached &&
        cached.fingerprint === fingerprint &&
        cached.taxonomyVersion === DEFAULT_TAXONOMY_VERSION &&
        cached.snapshot
      ) {
        const cachedSnapshot = cached.snapshot;
        const shouldStop = shouldStopPollingSnapshot(cachedSnapshot);
        updateState((current) => ({
          ...current,
          phase: shouldStop ? "completed" : "processing",
          snapshot: cachedSnapshot,
          events: current.events,
          cursor: current.cursor,
          error: null,
          warning: taxonomyUnavailable ? "taxonomy_unavailable" : null,
          jobId: cached.jobId,
          fingerprint,
          pollAfterMs: current.pollAfterMs,
          isRetrying: false,
        }));

        if (!shouldStop) {
          await poll(cached.jobId, fingerprint, 0, getDefaultPollMs());
        }
        return;
      }

      if (
        cached &&
        (cached.fingerprint !== fingerprint ||
          cached.taxonomyVersion !== DEFAULT_TAXONOMY_VERSION)
      ) {
        await clearAnalysisCache(spaceId, range);
      }

      const batchSize = getAnalysisBatchSize();
      const createInput = buildCreateJobRequest(memories, batchSize, timeParams);

      updateState((current) => ({
        ...current,
        phase: "creating",
        snapshot: null,
        events: [],
        cursor: 0,
        error: null,
        warning: null,
        jobId: null,
        fingerprint,
        pollAfterMs: getDefaultPollMs(),
        isRetrying: false,
      }));

      try {
        const createResponse = await analysisApi.createJob(spaceId, createInput);
        if (cancelled || runRef.current !== currentRun) return;

        const initialSnapshot = createPendingSnapshot(
          createResponse,
          createInput,
          memories,
        );
        await persistAnalysisSnapshot(
          spaceId,
          range,
          createResponse.jobId,
          fingerprint,
          initialSnapshot,
        );

        updateState((current) => ({
          ...current,
          phase: "uploading",
          snapshot: initialSnapshot,
          jobId: createResponse.jobId,
          fingerprint,
          pollAfterMs: createResponse.pollAfterMs,
        }));

        const chunks = chunkAnalysisMemories(
          memories.map(toAnalysisMemoryInput),
          batchSize,
        );

        let workingSnapshot = initialSnapshot;
        for (const [offset, batch] of chunks.entries()) {
          const batchIndex = offset + 1;
          const batchHash = await createBatchHash(batch);
          await analysisApi.uploadBatch(spaceId, createResponse.jobId, batchIndex, {
            batchHash,
            memoryCount: batch.length,
            memories: batch,
          });
          if (cancelled || runRef.current !== currentRun) return;
          workingSnapshot = applyUploadedBatch(workingSnapshot, batchIndex);
          await persistAnalysisSnapshot(
            spaceId,
            range,
            createResponse.jobId,
            fingerprint,
            workingSnapshot,
          );
          updateState((current) => ({
            ...current,
            phase: "uploading",
            snapshot: workingSnapshot,
            jobId: createResponse.jobId,
            fingerprint,
          }));
        }

        await analysisApi.finalizeJob(spaceId, createResponse.jobId);
        const snapshot = await analysisApi.getSnapshot(
          spaceId,
          createResponse.jobId,
        );
        if (cancelled || runRef.current !== currentRun) return;

        await persistAnalysisSnapshot(
          spaceId,
          range,
          createResponse.jobId,
          fingerprint,
          snapshot,
        );

        updateState((current) => ({
          ...current,
          phase: shouldStopPollingSnapshot(snapshot) ? "completed" : "processing",
          snapshot,
          error: null,
          warning: taxonomyUnavailable ? "taxonomy_unavailable" : null,
          jobId: createResponse.jobId,
          fingerprint,
          pollAfterMs: createResponse.pollAfterMs,
        }));

        if (!shouldStopPollingSnapshot(snapshot)) {
          await poll(
            createResponse.jobId,
            fingerprint,
            0,
            createResponse.pollAfterMs,
          );
        }
      } catch (error) {
        await clearAnalysisCache(spaceId, range);
        if (isDegradedAnalysisError(error)) {
          finishWithError("degraded", "analysis_unavailable", fingerprint, null);
          return;
        }
        finishWithError("failed", "analysis_failed", fingerprint, null);
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [
    enabled,
    range,
    sourceMemories,
    sourceQuery.data,
    spaceId,
    timeParams,
    taxonomyUnavailable,
  ]);

  return {
    state,
    taxonomy: taxonomyQuery.data ?? null,
    taxonomyUnavailable,
    cards: cards.length > 0 ? cards : state.snapshot?.aggregateCards ?? [],
    matches,
    matchMap,
    sourceMemories,
    sourceCount: sourceMemories.length,
    sourceLoading: sourceQuery.isLoading || sourceQuery.isFetching || matchesLoading,
    retry: () => {
      void Promise.all([
        clearAnalysisCache(spaceId, range),
        clearCachedAnalysisMatches(spaceId, range),
      ]).finally(() => {
        setAttempt((current) => current + 1);
        setMatches([]);
        setCards([]);
        setState(INITIAL_STATE);
      });
    },
  };
}
