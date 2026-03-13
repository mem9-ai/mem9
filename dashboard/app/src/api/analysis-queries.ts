import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import { readAnalysisCache, writeAnalysisCache, clearAnalysisCache } from "./analysis-cache";
import { analysisApi, AnalysisApiError } from "./analysis-client";
import {
  applyUploadedBatch,
  buildCreateJobRequest,
  chunkAnalysisMemories,
  createBatchHash,
  createMemoryFingerprint,
  createPendingSnapshot,
  getAnalysisBatchSize,
  getDefaultPollMs,
  isDegradedAnalysisError,
  isTerminalJobStatus,
  mergeSnapshotWithUpdates,
  toAnalysisMemoryInput,
} from "./analysis-helpers";
import { features } from "@/config/features";
import type { SpaceAnalysisState, TaxonomyResponse } from "@/types/analysis";
import type { Memory } from "@/types/memory";
import type { TimeRangePreset } from "@/types/time-range";
import { presetToParams } from "@/types/time-range";

const PAGE_SIZE = 200;

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

async function listAllMemories(
  spaceId: string,
  range?: TimeRangePreset,
): Promise<Memory[]> {
  const params = range ? presetToParams(range) : undefined;
  const all: Memory[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    const page = await api.listMemories(spaceId, {
      ...params,
      limit: PAGE_SIZE,
      offset,
    });
    all.push(...page.memories);
    total = page.total;
    offset += page.limit;
  }

  return all;
}

function trimEvents<T>(items: T[], limit: number): T[] {
  return items.slice(0, limit);
}

export function useSpaceAnalysis(
  spaceId: string,
  range: TimeRangePreset,
): {
  state: SpaceAnalysisState;
  taxonomy: TaxonomyResponse | null;
  taxonomyUnavailable: boolean;
  sourceCount: number;
  sourceLoading: boolean;
  retry: () => void;
} {
  const [state, setState] = useState<SpaceAnalysisState>(INITIAL_STATE);
  const [attempt, setAttempt] = useState(0);
  const runRef = useRef(0);
  const enabled = features.enableAnalysis && !!spaceId;
  const timeParams = useMemo(
    () => (range ? presetToParams(range) : undefined),
    [range],
  );

  const sourceQuery = useQuery({
    queryKey: ["analysis", "source-memories", spaceId, range, attempt],
    queryFn: () => listAllMemories(spaceId, range),
    enabled,
    staleTime: 30_000,
    retry: 1,
  });

  const taxonomyQuery = useQuery({
    queryKey: ["analysis", "taxonomy", spaceId],
    queryFn: () => analysisApi.getTaxonomy(spaceId, "v1"),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const taxonomyUnavailable = taxonomyQuery.error !== null;

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
      setState(INITIAL_STATE);
      return;
    }
    if (!sourceQuery.data) return;

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

        updateState((current) => ({
          ...current,
          phase: isTerminalJobStatus(snapshot.status) ? "completed" : "processing",
          snapshot: mergeSnapshotWithUpdates(snapshot, updates),
          events: trimEvents([...updates.events].reverse(), 8),
          cursor: updates.nextCursor,
          error: null,
          warning: taxonomyUnavailable ? "taxonomy_unavailable" : null,
          jobId,
          fingerprint,
          pollAfterMs: delayMs,
          isRetrying: false,
        }));

        if (isTerminalJobStatus(snapshot.status)) return;

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
          clearAnalysisCache(spaceId, range);
        }
      }
    };

    const run = async (): Promise<void> => {
      const memories = sourceQuery.data;
      if (memories.length === 0) {
        updateState(() => ({
          ...INITIAL_STATE,
          phase: "completed",
          warning: taxonomyUnavailable ? "taxonomy_unavailable" : null,
        }));
        clearAnalysisCache(spaceId, range);
        return;
      }

      const fingerprint = await createMemoryFingerprint(memories);
      if (cancelled || runRef.current !== currentRun) return;

      const cached = readAnalysisCache(spaceId, range);
      if (cached && cached.fingerprint === fingerprint) {
        try {
          const snapshot = await analysisApi.getSnapshot(spaceId, cached.jobId);
          if (cancelled || runRef.current !== currentRun) return;
          updateState((current) => ({
            ...current,
            phase: isTerminalJobStatus(snapshot.status)
              ? "completed"
              : "processing",
            snapshot,
            events: current.events,
            cursor: current.cursor,
            error: null,
            warning: taxonomyUnavailable ? "taxonomy_unavailable" : null,
            jobId: cached.jobId,
            fingerprint,
            pollAfterMs: current.pollAfterMs,
            isRetrying: false,
          }));
          if (!isTerminalJobStatus(snapshot.status)) {
            await poll(cached.jobId, fingerprint, 0, getDefaultPollMs());
          }
          return;
        } catch (error) {
          if (
            error instanceof AnalysisApiError &&
            (error.status === 404 || error.status === 403)
          ) {
            clearAnalysisCache(spaceId, range);
          } else if (isDegradedAnalysisError(error)) {
            finishWithError(
              "degraded",
              "analysis_unavailable",
              fingerprint,
              cached.jobId,
            );
            return;
          }
        }
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
        updateState((current) => ({
          ...current,
          phase: "uploading",
          snapshot: initialSnapshot,
          jobId: createResponse.jobId,
          fingerprint,
          pollAfterMs: createResponse.pollAfterMs,
        }));

        writeAnalysisCache(spaceId, range, {
          fingerprint,
          jobId: createResponse.jobId,
          updatedAt: new Date().toISOString(),
        });

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

        updateState((current) => ({
          ...current,
          phase: isTerminalJobStatus(snapshot.status) ? "completed" : "processing",
          snapshot,
          error: null,
          warning: taxonomyUnavailable ? "taxonomy_unavailable" : null,
          jobId: createResponse.jobId,
          fingerprint,
          pollAfterMs: createResponse.pollAfterMs,
        }));

        if (!isTerminalJobStatus(snapshot.status)) {
          await poll(
            createResponse.jobId,
            fingerprint,
            0,
            createResponse.pollAfterMs,
          );
        }
      } catch (error) {
        clearAnalysisCache(spaceId, range);
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
    sourceQuery.data,
    spaceId,
    timeParams,
  ]);

  return {
    state,
    taxonomy: taxonomyQuery.data ?? null,
    taxonomyUnavailable,
    sourceCount: sourceQuery.data?.length ?? 0,
    sourceLoading: sourceQuery.isLoading,
    retry: () => {
      clearAnalysisCache(spaceId, range);
      setAttempt((current) => current + 1);
      setState(INITIAL_STATE);
    },
  };
}
