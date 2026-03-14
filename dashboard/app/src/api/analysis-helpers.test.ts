import { describe, expect, it } from "vitest";
import { AnalysisApiError } from "./analysis-client";
import {
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
    taxonomyVersion: "v2",
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
