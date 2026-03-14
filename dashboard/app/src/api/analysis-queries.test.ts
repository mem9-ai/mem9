import { describe, expect, it } from "vitest";
import { shouldStopPollingSnapshot } from "./analysis-queries";
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
    taxonomyVersion: "v2",
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
