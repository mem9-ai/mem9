import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  readCachedAnalysisMatches,
  writeCachedAnalysisMatches,
} from "./local-cache";
import { useSourceMemories } from "./source-memories";
import { features } from "@/config/features";
import { filterMemoriesForView } from "@/lib/memory-filters";
import type {
  AnalysisCategoryCard,
  AnalysisJobSnapshotResponse,
  MemoryAnalysisMatch,
  SpaceAnalysisState,
  TaxonomyResponse,
} from "@/types/analysis";
import type { Memory } from "@/types/memory";
import type { TimeRangePreset } from "@/types/time-range";
const TERMINAL_BATCH_STATUSES = new Set(["SUCCEEDED", "FAILED", "DLQ"]);
export const ANALYSIS_AUTO_REFRESH_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
export const MAX_STALLED_POLL_ATTEMPTS = 4;

interface PollProgressState {
  nextCursor: number;
  resultVersion: number;
  uploadedBatches: number;
  completedBatches: number;
  failedBatches: number;
  terminalBatchSignature: string;
  stagnantPolls: number;
}

interface AnalysisStartupResult {
  jobId: string;
  pollAfterMs: number;
  snapshot: AnalysisJobSnapshotResponse;
}

const activeStartupRuns = new Map<string, Promise<AnalysisStartupResult>>();

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

export function isAnalysisCacheFresh(
  updatedAt: string,
  now = Date.now(),
): boolean {
  const updatedTime = Date.parse(updatedAt);

  if (!Number.isFinite(updatedTime)) {
    return false;
  }

  return now - updatedTime < ANALYSIS_AUTO_REFRESH_WINDOW_MS;
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

function createAnalysisRunKey(
  spaceId: string,
  range: TimeRangePreset,
  fingerprint: string,
): string {
  return `${spaceId}:${range}:${fingerprint}`;
}

function getSnapshotPhase(
  snapshot: AnalysisJobSnapshotResponse,
): SpaceAnalysisState["phase"] {
  if (shouldStopPollingSnapshot(snapshot)) {
    return "completed";
  }

  return shouldRestartIncompleteCachedSnapshot(snapshot)
    ? "uploading"
    : "processing";
}

export function shouldRestartIncompleteCachedSnapshot(
  snapshot: AnalysisJobSnapshotResponse,
): boolean {
  return (
    !shouldStopPollingSnapshot(snapshot) &&
    snapshot.progress.uploadedBatches < snapshot.expectedTotalBatches
  );
}

function createTerminalBatchSignature(
  snapshot: AnalysisJobSnapshotResponse,
): string {
  return snapshot.batchSummaries
    .filter((batch) => TERMINAL_BATCH_STATUSES.has(batch.status))
    .map((batch) => `${batch.batchIndex}:${batch.status}`)
    .join("|");
}

export function createPollProgressState(
  nextCursor: number,
  snapshot: AnalysisJobSnapshotResponse,
): PollProgressState {
  return {
    nextCursor,
    resultVersion: snapshot.progress.resultVersion,
    uploadedBatches: snapshot.progress.uploadedBatches,
    completedBatches: snapshot.progress.completedBatches,
    failedBatches: snapshot.progress.failedBatches,
    terminalBatchSignature: createTerminalBatchSignature(snapshot),
    stagnantPolls: 0,
  };
}

function hasPollingProgress(
  previous: PollProgressState,
  next: PollProgressState,
): boolean {
  return (
    previous.nextCursor !== next.nextCursor ||
    previous.resultVersion !== next.resultVersion ||
    previous.uploadedBatches !== next.uploadedBatches ||
    previous.completedBatches !== next.completedBatches ||
    previous.failedBatches !== next.failedBatches ||
    previous.terminalBatchSignature !== next.terminalBatchSignature
  );
}

export function getNextPollProgressState(
  previous: PollProgressState | null,
  nextCursor: number,
  snapshot: AnalysisJobSnapshotResponse,
): PollProgressState {
  const nextState = createPollProgressState(nextCursor, snapshot);

  if (!previous) {
    return nextState;
  }

  return {
    ...nextState,
    stagnantPolls: hasPollingProgress(previous, nextState)
      ? 0
      : previous.stagnantPolls + 1,
  };
}

export function shouldTreatPollAsStalled(
  progress: PollProgressState,
): boolean {
  return progress.stagnantPolls >= MAX_STALLED_POLL_ATTEMPTS;
}

export function shouldUseCachedAnalysisMatches({
  hasFreshSnapshot,
  fingerprintMatches,
  taxonomyVersionMatches,
  taxonomyAvailable,
}: {
  hasFreshSnapshot: boolean;
  fingerprintMatches: boolean;
  taxonomyVersionMatches: boolean;
  taxonomyAvailable: boolean;
}): boolean {
  return (
    hasFreshSnapshot &&
    fingerprintMatches &&
    taxonomyVersionMatches &&
    !taxonomyAvailable
  );
}

async function startAnalysisStartup(
  spaceId: string,
  range: TimeRangePreset,
  memories: Memory[],
  fingerprint: string,
  onSnapshot?: (
    snapshot: AnalysisJobSnapshotResponse,
    jobId: string,
    pollAfterMs: number,
  ) => void,
): Promise<AnalysisStartupResult> {
  const runKey = createAnalysisRunKey(spaceId, range, fingerprint);
  const activeRun = activeStartupRuns.get(runKey);

  if (activeRun) {
    return activeRun;
  }

  const startupRun = (async () => {
    const batchSize = getAnalysisBatchSize();
    const createInput = buildCreateJobRequest(memories, batchSize);
    const createResponse = await analysisApi.createJob(spaceId, createInput);
    const emitSnapshot = (snapshot: AnalysisJobSnapshotResponse) => {
      if (!onSnapshot) return;
      try {
        onSnapshot(snapshot, createResponse.jobId, createResponse.pollAfterMs);
      } catch {
        // Ignore UI callback failures so the startup run can finish.
      }
    };

    let workingSnapshot = createPendingSnapshot(
      createResponse,
      createInput,
      memories,
    );
    await persistAnalysisSnapshot(
      spaceId,
      range,
      createResponse.jobId,
      fingerprint,
      workingSnapshot,
    );
    emitSnapshot(workingSnapshot);

    const chunks = chunkAnalysisMemories(
      memories.map(toAnalysisMemoryInput),
      batchSize,
    );

    for (const [offset, batch] of chunks.entries()) {
      const batchIndex = offset + 1;
      const batchHash = await createBatchHash(batch);
      await analysisApi.uploadBatch(spaceId, createResponse.jobId, batchIndex, {
        batchHash,
        memoryCount: batch.length,
        memories: batch,
      });
      workingSnapshot = applyUploadedBatch(workingSnapshot, batchIndex);
      await persistAnalysisSnapshot(
        spaceId,
        range,
        createResponse.jobId,
        fingerprint,
        workingSnapshot,
      );
      emitSnapshot(workingSnapshot);
    }

    await analysisApi.finalizeJob(spaceId, createResponse.jobId);
    const snapshot = await analysisApi.getSnapshot(spaceId, createResponse.jobId);
    await persistAnalysisSnapshot(
      spaceId,
      range,
      createResponse.jobId,
      fingerprint,
      snapshot,
    );
    emitSnapshot(snapshot);

    return {
      jobId: createResponse.jobId,
      pollAfterMs: createResponse.pollAfterMs,
      snapshot,
    };
  })().finally(() => {
    activeStartupRuns.delete(runKey);
  });

  activeStartupRuns.set(runKey, startupRun);
  return startupRun;
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
  const sourceQuery = useSourceMemories(spaceId, attempt);

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
        const cachedAnalysis = await readAnalysisCache(spaceId, range);
        const fingerprint = await createMemoryFingerprint(sourceMemories);
        const shouldUseCachedMatches = shouldUseCachedAnalysisMatches({
          hasFreshSnapshot:
            !!cachedAnalysis?.snapshot &&
            isAnalysisCacheFresh(cachedAnalysis.updatedAt),
          fingerprintMatches: cachedAnalysis?.fingerprint === fingerprint,
          taxonomyVersionMatches:
            cachedAnalysis?.taxonomyVersion === DEFAULT_TAXONOMY_VERSION,
          taxonomyAvailable: !!taxonomyQuery.data,
        });

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

        if (shouldUseCachedMatches) {
          const cachedMatches = await readCachedAnalysisMatches(spaceId, range);
          if (cancelled) return;

          setMatches(cachedMatches);
          setCards([]);
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
    let pollProgressState: PollProgressState | null = null;

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
      snapshot?: AnalysisJobSnapshotResponse | null,
      cursor?: number,
    ) => {
      updateState((current) => ({
        ...current,
        phase,
        snapshot: snapshot ?? current.snapshot,
        cursor: cursor ?? current.cursor,
        error,
        warning: null,
        fingerprint,
        jobId,
        isRetrying: false,
      }));
    };

    const canUpdateCurrentRun = (): boolean =>
      !cancelled && runRef.current === currentRun;

    const syncStartupSnapshot = (
      snapshot: AnalysisJobSnapshotResponse,
      jobId: string,
      fingerprint: string,
      pollAfterMs: number,
    ) => {
      if (!canUpdateCurrentRun()) return;
      updateState((current) => ({
        ...current,
        phase: getSnapshotPhase(snapshot),
        snapshot,
        error: null,
        warning: taxonomyUnavailable ? "taxonomy_unavailable" : null,
        jobId,
        fingerprint,
        pollAfterMs,
        isRetrying: false,
      }));
    };

    const poll = async (
      jobId: string,
      fingerprint: string,
      nextCursor: number,
      delayMs: number,
    ): Promise<void> => {
      if (!canUpdateCurrentRun()) return;
      try {
        const [updates, snapshot] = await Promise.all([
          analysisApi.getUpdates(spaceId, jobId, nextCursor),
          analysisApi.getSnapshot(spaceId, jobId),
        ]);

        if (!canUpdateCurrentRun()) return;

        const mergedSnapshot = mergeSnapshotWithUpdates(snapshot, updates);
        const shouldStop = shouldStopPollingSnapshot(mergedSnapshot);
        const nextPollProgressState = getNextPollProgressState(
          pollProgressState,
          updates.nextCursor,
          mergedSnapshot,
        );
        await persistAnalysisSnapshot(
          spaceId,
          range,
          jobId,
          fingerprint,
          mergedSnapshot,
        );

        if (!shouldStop && shouldTreatPollAsStalled(nextPollProgressState)) {
          pollProgressState = nextPollProgressState;
          await clearAnalysisCache(spaceId, range);
          finishWithError(
            "failed",
            "analysis_stalled",
            fingerprint,
            jobId,
            mergedSnapshot,
            updates.nextCursor,
          );
          return;
        }

        pollProgressState = shouldStop ? null : nextPollProgressState;
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
        if (!canUpdateCurrentRun()) return;
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
      if (!canUpdateCurrentRun()) return;
      const runKey = createAnalysisRunKey(spaceId, range, fingerprint);

      const cached = await readAnalysisCache(spaceId, range);
      if (!canUpdateCurrentRun()) return;
      const activeStartup = activeStartupRuns.get(runKey);
      const isMatchingCachedJob =
        cached?.fingerprint === fingerprint &&
        cached.taxonomyVersion === DEFAULT_TAXONOMY_VERSION &&
        cached.snapshot !== null;

      if (
        cached &&
        (!isMatchingCachedJob ||
          !cached.snapshot ||
          !isAnalysisCacheFresh(cached.updatedAt))
      ) {
        await clearAnalysisCache(spaceId, range);
      }

      if (isMatchingCachedJob && cached?.snapshot) {
        const cachedSnapshot = cached.snapshot;

        if (shouldRestartIncompleteCachedSnapshot(cachedSnapshot)) {
          if (!activeStartup) {
            await clearAnalysisCache(spaceId, range);
          } else {
            syncStartupSnapshot(
              cachedSnapshot,
              cached.jobId,
              fingerprint,
              getDefaultPollMs(),
            );
            try {
              const startup = await activeStartup;
              if (!canUpdateCurrentRun()) return;
              const shouldStop = shouldStopPollingSnapshot(startup.snapshot);
              pollProgressState = shouldStop
                ? null
                : createPollProgressState(0, startup.snapshot);
              updateState((current) => ({
                ...current,
                phase: shouldStop ? "completed" : "processing",
                snapshot: startup.snapshot,
                error: null,
                warning: taxonomyUnavailable ? "taxonomy_unavailable" : null,
                jobId: startup.jobId,
                fingerprint,
                pollAfterMs: startup.pollAfterMs,
                isRetrying: false,
              }));

              if (!shouldStop) {
                await poll(startup.jobId, fingerprint, 0, startup.pollAfterMs);
              }
              return;
            } catch (error) {
              await clearAnalysisCache(spaceId, range);
              if (isDegradedAnalysisError(error)) {
                finishWithError(
                  "degraded",
                  "analysis_unavailable",
                  fingerprint,
                  null,
                );
                return;
              }
              finishWithError("failed", "analysis_failed", fingerprint, null);
              return;
            }
          }
        } else if (isAnalysisCacheFresh(cached.updatedAt)) {
          const shouldStop = shouldStopPollingSnapshot(cachedSnapshot);
          pollProgressState = shouldStop
            ? null
            : createPollProgressState(0, cachedSnapshot);
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
      }

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
        const startup = await startAnalysisStartup(
          spaceId,
          range,
          memories,
          fingerprint,
          (snapshot, jobId, pollAfterMs) => {
            syncStartupSnapshot(snapshot, jobId, fingerprint, pollAfterMs);
          },
        );
        if (!canUpdateCurrentRun()) return;

        const shouldStop = shouldStopPollingSnapshot(startup.snapshot);
        pollProgressState = shouldStop
          ? null
          : createPollProgressState(0, startup.snapshot);
        updateState((current) => ({
          ...current,
          phase: shouldStop ? "completed" : "processing",
          snapshot: startup.snapshot,
          error: null,
          warning: taxonomyUnavailable ? "taxonomy_unavailable" : null,
          jobId: startup.jobId,
          fingerprint,
          pollAfterMs: startup.pollAfterMs,
          isRetrying: false,
        }));

        if (!shouldStop) {
          await poll(startup.jobId, fingerprint, 0, startup.pollAfterMs);
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
    sourceCount: state.snapshot?.expectedTotalMemories ?? sourceMemories.length,
    sourceLoading: sourceQuery.isLoading || sourceQuery.isFetching || matchesLoading,
    retry: () => {
      const fingerprint = state.fingerprint;
      if (fingerprint) {
        activeStartupRuns.delete(createAnalysisRunKey(spaceId, range, fingerprint));
      }
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
