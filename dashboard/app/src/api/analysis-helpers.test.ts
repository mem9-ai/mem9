import { describe, expect, it } from "vitest";
import { AnalysisApiError } from "./analysis-client";
import {
  buildFacetStats,
  buildCreateJobRequest,
  chunkAnalysisMemories,
  createMemoryFingerprint,
  DEFAULT_TAXONOMY_VERSION,
  isDegradedAnalysisError,
  mergeSnapshotWithUpdates,
  toAnalysisMemoryInput,
} from "./analysis-helpers";
import { readAnalysisCache, writeAnalysisCache } from "./analysis-cache";
import type {
  AnalysisJobSnapshotResponse,
  AnalysisJobUpdatesResponse,
} from "@/types/analysis";
import type { Memory } from "@/types/memory";

function createMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: overrides.id ?? "mem-1",
    content: overrides.content ?? "I am building AI agents",
    memory_type: overrides.memory_type ?? "insight",
    source: overrides.source ?? "chat",
    tags: overrides.tags ?? ["ai"],
    metadata: overrides.metadata ?? { facet: "plans" },
    agent_id: overrides.agent_id ?? "dashboard",
    session_id: overrides.session_id ?? "s1",
    state: overrides.state ?? "active",
    version: overrides.version ?? 1,
    updated_by: overrides.updated_by ?? "dashboard",
    created_at: overrides.created_at ?? "2026-03-01T00:00:00Z",
    updated_at: overrides.updated_at ?? "2026-03-02T00:00:00Z",
    score: overrides.score,
  };
}

function createSnapshot(): AnalysisJobSnapshotResponse {
  return {
    jobId: "aj_1",
    status: "PROCESSING",
    expectedTotalMemories: 2,
    expectedTotalBatches: 2,
    batchSize: 1,
    pipelineVersion: "v1",
    taxonomyVersion: "v3",
    llmEnabled: true,
    createdAt: "2026-03-03T00:00:00Z",
    startedAt: null,
    completedAt: null,
    expiresAt: null,
    progress: {
      expectedTotalBatches: 2,
      uploadedBatches: 2,
      completedBatches: 0,
      failedBatches: 0,
      processedMemories: 0,
      resultVersion: 0,
    },
    aggregate: {
      categoryCounts: {
        identity: 0,
        emotion: 0,
        preference: 0,
        experience: 0,
        activity: 0,
      },
      tagCounts: {},
      topicCounts: {},
      summarySnapshot: [],
      resultVersion: 0,
    },
    aggregateCards: [],
    topTags: [],
    topTopics: [],
    batchSummaries: [
      {
        batchIndex: 1,
        status: "QUEUED",
        memoryCount: 1,
        processedMemories: 0,
        topCategories: [],
        topTags: [],
      },
      {
        batchIndex: 2,
        status: "QUEUED",
        memoryCount: 1,
        processedMemories: 0,
        topCategories: [],
        topTags: [],
      },
    ],
  };
}

describe("analysis helpers", () => {
  it("builds create-job payloads from memories and range", () => {
    const input = buildCreateJobRequest(
      [
        createMemory({ updated_at: "2026-03-02T00:00:00Z" }),
        createMemory({
          id: "mem-2",
          updated_at: "2026-03-05T00:00:00Z",
        }),
      ],
      100,
      { updated_from: "2026-03-01T00:00:00Z" },
    );

    expect(input.expectedTotalMemories).toBe(2);
    expect(input.expectedTotalBatches).toBe(1);
    expect(input.dateRange.start).toBe("2026-03-01T00:00:00Z");
    expect(input.dateRange.end).toBe("2026-03-05T00:00:00.000Z");
    expect(input.options.taxonomyVersion).toBe(DEFAULT_TAXONOMY_VERSION);
  });

  it("chunks and maps memories for batch upload", () => {
    const mapped = [
      toAnalysisMemoryInput(createMemory()),
      toAnalysisMemoryInput(createMemory({ id: "mem-2" })),
      toAnalysisMemoryInput(createMemory({ id: "mem-3" })),
    ];

    const chunks = chunkAnalysisMemories(mapped, 2);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(2);
    expect(chunks[1]?.[0]?.id).toBe("mem-3");
  });

  it("creates stable fingerprints regardless of memory order", async () => {
    const left = await createMemoryFingerprint([
      createMemory({ id: "mem-1", version: 1 }),
      createMemory({ id: "mem-2", version: 2 }),
    ]);
    const right = await createMemoryFingerprint([
      createMemory({ id: "mem-2", version: 2 }),
      createMemory({ id: "mem-1", version: 1 }),
    ]);

    expect(left).toBe(right);
  });

  it("merges snapshot progress with incremental updates", () => {
    const updates: AnalysisJobUpdatesResponse = {
      cursor: 0,
      nextCursor: 2,
      events: [],
      completedBatchResults: [
        {
          batchIndex: 1,
          status: "SUCCEEDED",
          memoryCount: 1,
          processedMemories: 1,
          topCategories: [
            {
              category: "identity",
              count: 1,
              confidence: 1,
            },
          ],
          topTags: ["ai"],
        },
      ],
      aggregate: {
        categoryCounts: {
          identity: 1,
          emotion: 0,
          preference: 0,
          experience: 0,
          activity: 0,
        },
        tagCounts: { ai: 1 },
        topicCounts: { ai: 1 },
        summarySnapshot: ["identity:1"],
        resultVersion: 1,
      },
      progress: {
        expectedTotalBatches: 2,
        uploadedBatches: 2,
        completedBatches: 1,
        failedBatches: 0,
        processedMemories: 1,
        resultVersion: 1,
      },
    };

    const merged = mergeSnapshotWithUpdates(createSnapshot(), updates);
    expect(merged.progress.completedBatches).toBe(1);
    expect(merged.aggregate.categoryCounts.identity).toBe(1);
    expect(merged.batchSummaries[0]?.status).toBe("SUCCEEDED");
    expect(merged.topTags).toEqual(["ai"]);
    expect(merged.topTopics).toEqual(["ai"]);
    expect(merged.topTagStats).toEqual([{ value: "ai", count: 1 }]);
    expect(merged.topTopicStats).toEqual([{ value: "ai", count: 1 }]);
  });

  it("builds facet stats with stable sorting and a 50 item limit", () => {
    const counts: Record<string, number> = Object.fromEntries(
      Array.from({ length: 51 }, (_, index) => [
        `term-${index.toString().padStart(2, "0")}`,
        1,
      ]),
    );

    counts.priority = 53;
    counts.beta = 5;
    counts.alpha = 5;

    const stats = buildFacetStats(counts);

    expect(stats).toHaveLength(50);
    expect(stats[0]).toEqual({ value: "priority", count: 53 });
    expect(stats[1]).toEqual({ value: "alpha", count: 5 });
    expect(stats[2]).toEqual({ value: "beta", count: 5 });
    expect(stats[49]).toEqual({ value: "term-46", count: 1 });
  });

  it("keeps snapshot facet stats when snapshot is at least as new as updates", () => {
    const snapshot = createSnapshot();
    snapshot.progress.resultVersion = 3;
    snapshot.aggregate.resultVersion = 3;
    snapshot.topTagStats = [
      { value: "priority", count: 7 },
      { value: "alpha", count: 5 },
    ];
    snapshot.topTopicStats = [
      { value: "project", count: 9 },
      { value: "roadmap", count: 9 },
    ];
    snapshot.topTags = ["priority", "alpha"];
    snapshot.topTopics = ["project", "roadmap"];
    snapshot.aggregate.tagCounts = { priority: 7, alpha: 5 };
    snapshot.aggregate.topicCounts = { project: 9, roadmap: 9 };

    const updates: AnalysisJobUpdatesResponse = {
      cursor: 0,
      nextCursor: 2,
      events: [],
      completedBatchResults: [],
      aggregate: {
        ...snapshot.aggregate,
        resultVersion: 2,
        tagCounts: { stale: 1 },
        topicCounts: { stale: 1 },
      },
      progress: {
        ...snapshot.progress,
        resultVersion: 2,
      },
    };

    const merged = mergeSnapshotWithUpdates(snapshot, updates);

    expect(merged.topTagStats).toEqual(snapshot.topTagStats);
    expect(merged.topTopicStats).toEqual(snapshot.topTopicStats);
    expect(merged.topTags).toEqual(["priority", "alpha"]);
    expect(merged.topTopics).toEqual(["project", "roadmap"]);
  });

  it("stores cached job ids per space and range", async () => {
    await writeAnalysisCache("space-1", "30d", {
      fingerprint: "abc",
      jobId: "aj_cached",
      updatedAt: "2026-03-03T00:00:00Z",
      taxonomyVersion: DEFAULT_TAXONOMY_VERSION,
      snapshot: null,
    });

    expect((await readAnalysisCache("space-1", "30d"))?.jobId).toBe("aj_cached");
    expect(await readAnalysisCache("space-1", "7d")).toBeNull();
  });

  it("flags 5xx prisma errors as degraded", () => {
    const error = new AnalysisApiError(
      "Invalid `prisma.apiKeySubject.findUnique()` invocation",
      500,
    );
    expect(isDegradedAnalysisError(error)).toBe(true);
  });
});
