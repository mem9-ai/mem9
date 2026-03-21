import { describe, expect, it } from "vitest";
import {
  ANALYSIS_AUTO_REFRESH_WINDOW_MS,
  createPollProgressState,
  getNextPollProgressState,
  isAnalysisCacheFresh,
  shouldRestartIncompleteCachedSnapshot,
  shouldStopPollingSnapshot,
  shouldTreatPollAsStalled,
  shouldUseCachedAnalysisMatches,
} from "./analysis-queries";
import type { AnalysisJobSnapshotResponse, BatchStatus } from "@/types/analysis";

function createSnapshot(
  overrides: Partial<AnalysisJobSnapshotResponse> = {},
): AnalysisJobSnapshotResponse {
  return {
    jobId: "aj_1",
    status: "PROCESSING",
    expectedTotalMemories: 4,
    expectedTotalBatches: 2,
    batchSize: 2,
    pipelineVersion: "v1",
    taxonomyVersion: "v3",
    llmEnabled: true,
    createdAt: "2026-03-03T00:00:00Z",
    startedAt: "2026-03-03T00:00:01Z",
    completedAt: null,
    expiresAt: null,
    progress: {
      expectedTotalBatches: 2,
      uploadedBatches: 2,
      completedBatches: 1,
      failedBatches: 0,
      processedMemories: 2,
      resultVersion: 1,
    },
    aggregate: {
      categoryCounts: {
        identity: 1,
        emotion: 0,
        preference: 1,
        experience: 0,
        activity: 0,
      },
      tagCounts: { priority: 3 },
      topicCounts: { agents: 2 },
      summarySnapshot: ["identity:1", "preference:1"],
      resultVersion: 1,
    },
    aggregateCards: [
      { category: "identity", count: 1, confidence: 0.5 },
      { category: "preference", count: 1, confidence: 0.5 },
    ],
    topTagStats: [{ value: "priority", count: 3 }],
    topTopicStats: [{ value: "agents", count: 2 }],
    topTags: ["priority"],
    topTopics: ["agents"],
    batchSummaries: [
      {
        batchIndex: 1,
        status: "SUCCEEDED",
        memoryCount: 2,
        processedMemories: 2,
        topCategories: [{ category: "identity", count: 1, confidence: 0.5 }],
        topTags: ["priority"],
      },
      {
        batchIndex: 2,
        status: "SUCCEEDED",
        memoryCount: 2,
        processedMemories: 2,
        topCategories: [{ category: "preference", count: 1, confidence: 0.5 }],
        topTags: ["priority"],
      },
    ],
    ...overrides,
  };
}

function createBatchSummaries(
  secondStatus: BatchStatus,
): AnalysisJobSnapshotResponse["batchSummaries"] {
  return [
    {
      batchIndex: 1,
      status: "SUCCEEDED",
      memoryCount: 2,
      processedMemories: 2,
      topCategories: [{ category: "identity", count: 1, confidence: 0.5 }],
      topTags: ["priority"],
    },
    {
      batchIndex: 2,
      status: secondStatus,
      memoryCount: 2,
      processedMemories: secondStatus === "SUCCEEDED" ? 2 : 0,
      topCategories: [],
      topTags: [],
    },
  ];
}

describe("shouldStopPollingSnapshot", () => {
  it("stops polling when the snapshot status is terminal", () => {
    expect(
      shouldStopPollingSnapshot(createSnapshot({ status: "COMPLETED" })),
    ).toBe(true);
  });

  it("stops polling when all uploaded batches are terminal even if the job status lags", () => {
    expect(
      shouldStopPollingSnapshot(
        createSnapshot({
          status: "PROCESSING",
          progress: {
            expectedTotalBatches: 2,
            uploadedBatches: 2,
            completedBatches: 1,
            failedBatches: 1,
            processedMemories: 2,
            resultVersion: 2,
          },
          batchSummaries: createBatchSummaries("FAILED"),
        }),
      ),
    ).toBe(true);
  });

  it.each(["QUEUED", "RUNNING", "RETRYING"] as const)(
    "keeps polling while a batch is still %s",
    (status) => {
      expect(
        shouldStopPollingSnapshot(
          createSnapshot({
            progress: {
              expectedTotalBatches: 2,
              uploadedBatches: 2,
              completedBatches: 1,
              failedBatches: 0,
              processedMemories: 2,
              resultVersion: 2,
            },
            batchSummaries: createBatchSummaries(status),
          }),
        ),
      ).toBe(false);
    },
  );
});

describe("shouldRestartIncompleteCachedSnapshot", () => {
  it("restarts partial cached jobs when upload never finished", () => {
    expect(
      shouldRestartIncompleteCachedSnapshot(
        createSnapshot({
          status: "PARTIAL",
          expectedTotalBatches: 30,
          progress: {
            expectedTotalBatches: 30,
            uploadedBatches: 3,
            completedBatches: 3,
            failedBatches: 0,
            processedMemories: 263,
            resultVersion: 3,
          },
          batchSummaries: [
            {
              batchIndex: 1,
              status: "SUCCEEDED",
              memoryCount: 100,
              processedMemories: 100,
              topCategories: [],
              topTags: [],
            },
            {
              batchIndex: 2,
              status: "SUCCEEDED",
              memoryCount: 100,
              processedMemories: 100,
              topCategories: [],
              topTags: [],
            },
            {
              batchIndex: 3,
              status: "SUCCEEDED",
              memoryCount: 63,
              processedMemories: 63,
              topCategories: [],
              topTags: [],
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("does not restart jobs once all batches were uploaded", () => {
    expect(
      shouldRestartIncompleteCachedSnapshot(
        createSnapshot({
          progress: {
            expectedTotalBatches: 2,
            uploadedBatches: 2,
            completedBatches: 1,
            failedBatches: 0,
            processedMemories: 2,
            resultVersion: 2,
          },
          batchSummaries: createBatchSummaries("RUNNING"),
        }),
      ),
    ).toBe(false);
  });
});

describe("poll stall detection", () => {
  it("marks polling as stalled after repeated non-advancing responses", () => {
    const snapshot = createSnapshot({
      status: "PARTIAL",
      expectedTotalBatches: 30,
      progress: {
        expectedTotalBatches: 30,
        uploadedBatches: 3,
        completedBatches: 3,
        failedBatches: 0,
        processedMemories: 263,
        resultVersion: 3,
      },
      batchSummaries: [
        {
          batchIndex: 1,
          status: "SUCCEEDED",
          memoryCount: 100,
          processedMemories: 100,
          topCategories: [],
          topTags: [],
        },
        {
          batchIndex: 2,
          status: "SUCCEEDED",
          memoryCount: 100,
          processedMemories: 100,
          topCategories: [],
          topTags: [],
        },
        {
          batchIndex: 3,
          status: "SUCCEEDED",
          memoryCount: 63,
          processedMemories: 63,
          topCategories: [],
          topTags: [],
        },
      ],
    });

    let progress = createPollProgressState(3, snapshot);
    expect(shouldTreatPollAsStalled(progress)).toBe(false);

    for (let index = 0; index < 4; index += 1) {
      progress = getNextPollProgressState(progress, 3, snapshot);
    }

    expect(shouldTreatPollAsStalled(progress)).toBe(true);
  });

  it("resets the stalled counter when polling advances", () => {
    const snapshot = createSnapshot({
      progress: {
        expectedTotalBatches: 2,
        uploadedBatches: 2,
        completedBatches: 1,
        failedBatches: 0,
        processedMemories: 2,
        resultVersion: 2,
      },
      batchSummaries: createBatchSummaries("RUNNING"),
    });
    const advancedSnapshot = createSnapshot({
      progress: {
        expectedTotalBatches: 2,
        uploadedBatches: 2,
        completedBatches: 2,
        failedBatches: 0,
        processedMemories: 4,
        resultVersion: 3,
      },
      batchSummaries: createBatchSummaries("SUCCEEDED"),
    });

    let progress = createPollProgressState(1, snapshot);
    progress = getNextPollProgressState(progress, 1, snapshot);
    progress = getNextPollProgressState(progress, 2, advancedSnapshot);

    expect(shouldTreatPollAsStalled(progress)).toBe(false);
    expect(progress.stagnantPolls).toBe(0);
  });
});

describe("shouldUseCachedAnalysisMatches", () => {
  it("does not use cached matches when taxonomy data is available", () => {
    expect(
      shouldUseCachedAnalysisMatches({
        hasFreshSnapshot: true,
        fingerprintMatches: true,
        taxonomyVersionMatches: true,
        taxonomyAvailable: true,
      }),
    ).toBe(false);
  });

  it("uses cached matches only when the snapshot is fresh and taxonomy is unavailable", () => {
    expect(
      shouldUseCachedAnalysisMatches({
        hasFreshSnapshot: true,
        fingerprintMatches: true,
        taxonomyVersionMatches: true,
        taxonomyAvailable: false,
      }),
    ).toBe(true);
  });
});

describe("isAnalysisCacheFresh", () => {
  it("treats caches newer than three days as fresh", () => {
    const now = Date.parse("2026-03-21T12:00:00Z");
    const updatedAt = new Date(now - ANALYSIS_AUTO_REFRESH_WINDOW_MS + 60_000).toISOString();

    expect(isAnalysisCacheFresh(updatedAt, now)).toBe(true);
  });

  it("treats caches older than three days as stale", () => {
    const now = Date.parse("2026-03-21T12:00:00Z");
    const updatedAt = new Date(now - ANALYSIS_AUTO_REFRESH_WINDOW_MS - 60_000).toISOString();

    expect(isAnalysisCacheFresh(updatedAt, now)).toBe(false);
  });
});
