import { describe, expect, it, vi } from "vitest";

vi.mock("@/api/local-cache", () => ({
  readSyncState: vi.fn(),
  readCachedAnalysisResult: vi.fn(),
}));

async function importModules() {
  vi.resetModules();
  const localCache = await import("@/api/local-cache");
  const memoryFarm = await import("./use-memory-farm-entry-state");
  return {
    localCache,
    memoryFarm,
  };
}

describe("resolveMemoryFarmEntryStatus", () => {
  it("returns ready when the full cache exists and the all-range snapshot is terminal", async () => {
    const { localCache, memoryFarm } = await importModules();
    vi.mocked(localCache.readSyncState).mockResolvedValue({
      spaceId: "space-1",
      hasFullCache: true,
      lastSyncedAt: "2026-03-28T00:00:00Z",
      incrementalCursor: null,
      incrementalTodo: null,
    });

    const status = await memoryFarm.resolveMemoryFarmEntryStatus({
      spaceId: "space-1",
      isSourceMemoriesLoading: false,
      currentAnalysisState: {
        phase: "completed",
        snapshot: {
          jobId: "aj_1",
          status: "COMPLETED",
          expectedTotalMemories: 1,
          expectedTotalBatches: 1,
          batchSize: 1,
          pipelineVersion: "v1",
          taxonomyVersion: "v3",
          llmEnabled: true,
          createdAt: "2026-03-28T00:00:00Z",
          startedAt: "2026-03-28T00:00:00Z",
          completedAt: "2026-03-28T00:00:01Z",
          expiresAt: null,
          progress: {
            expectedTotalBatches: 1,
            uploadedBatches: 1,
            completedBatches: 1,
            failedBatches: 0,
            processedMemories: 1,
            resultVersion: 1,
          },
          aggregate: {
            categoryCounts: {
              identity: 0,
              emotion: 0,
              preference: 0,
              experience: 0,
              activity: 1,
            },
            tagCounts: {},
            topicCounts: {},
            summarySnapshot: [],
            resultVersion: 1,
          },
          aggregateCards: [],
          topTags: [],
          topTopics: [],
          batchSummaries: [
            {
              batchIndex: 1,
              status: "SUCCEEDED",
              memoryCount: 1,
              processedMemories: 1,
              topCategories: [],
              topTags: [],
            },
          ],
        },
        events: [],
        cursor: 0,
        error: null,
        warning: null,
        jobId: "aj_1",
        fingerprint: "fp",
        pollAfterMs: 1000,
        isRetrying: false,
      },
      currentRange: "all",
    });

    expect(status).toBe("ready");
  });

  it("returns unavailable when all-range analysis is degraded after cache sync", async () => {
    const { localCache, memoryFarm } = await importModules();
    vi.mocked(localCache.readSyncState).mockResolvedValue({
      spaceId: "space-1",
      hasFullCache: true,
      lastSyncedAt: "2026-03-28T00:00:00Z",
      incrementalCursor: null,
      incrementalTodo: null,
    });

    const status = await memoryFarm.resolveMemoryFarmEntryStatus({
      spaceId: "space-1",
      isSourceMemoriesLoading: false,
      currentAnalysisState: {
        phase: "degraded",
        snapshot: null,
        events: [],
        cursor: 0,
        error: null,
        warning: null,
        jobId: null,
        fingerprint: null,
        pollAfterMs: 1000,
        isRetrying: false,
      },
      currentRange: "all",
    });

    expect(status).toBe("unavailable");
  });
});
