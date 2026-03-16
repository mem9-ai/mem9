import { describe, expect, it } from "vitest";
import { buildMemoryPulseData } from "./memory-pulse";
import type { AnalysisJobSnapshotResponse } from "@/types/analysis";
import type { Memory, MemoryStats } from "@/types/memory";

function createMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: overrides.id ?? "mem-1",
    content: overrides.content ?? "mem9",
    memory_type: overrides.memory_type ?? "insight",
    source: overrides.source ?? "openclaw",
    tags: overrides.tags ?? ["project"],
    metadata: overrides.metadata ?? { facet: "plans" },
    agent_id: overrides.agent_id ?? "agent",
    session_id: overrides.session_id ?? "session",
    state: overrides.state ?? "active",
    version: overrides.version ?? 1,
    updated_by: overrides.updated_by ?? "agent",
    created_at: overrides.created_at ?? "2026-03-10T00:00:00Z",
    updated_at: overrides.updated_at ?? "2026-03-10T00:00:00Z",
    score: overrides.score,
  };
}

function createStats(overrides: Partial<MemoryStats> = {}): MemoryStats {
  return {
    total: overrides.total ?? 4,
    pinned: overrides.pinned ?? 1,
    insight: overrides.insight ?? 3,
  };
}

function createSnapshot(): AnalysisJobSnapshotResponse {
  return {
    jobId: "job_1",
    status: "COMPLETED",
    expectedTotalMemories: 4,
    expectedTotalBatches: 1,
    batchSize: 100,
    pipelineVersion: "v1",
    taxonomyVersion: "v2",
    llmEnabled: true,
    createdAt: "2026-03-10T00:00:00Z",
    startedAt: "2026-03-10T00:00:00Z",
    completedAt: "2026-03-10T00:00:00Z",
    expiresAt: null,
    progress: {
      expectedTotalBatches: 1,
      uploadedBatches: 1,
      completedBatches: 1,
      failedBatches: 0,
      processedMemories: 4,
      resultVersion: 1,
    },
    aggregate: {
      categoryCounts: {
        identity: 2,
        emotion: 0,
        preference: 1,
        experience: 0,
        activity: 1,
      },
      tagCounts: {
        project: 3,
        go: 1,
      },
      topicCounts: {},
      summarySnapshot: [],
      resultVersion: 1,
    },
    aggregateCards: [],
    topTagStats: [
      { value: "project", count: 3 },
      { value: "go", count: 1 },
    ],
    topTopicStats: [],
    topTags: ["project", "go"],
    topTopics: [],
    batchSummaries: [],
  };
}

describe("memory pulse helpers", () => {
  it("builds composition and tag signals from analysis data", () => {
    const data = buildMemoryPulseData({
      stats: createStats(),
      memories: [
        createMemory({ id: "mem-1", tags: ["project"] }),
        createMemory({ id: "mem-2", tags: ["project", "go"] }),
        createMemory({ id: "mem-3", tags: ["project"] }),
        createMemory({ id: "mem-4", tags: ["go"], memory_type: "pinned" }),
      ],
      cards: [
        { category: "identity", count: 2, confidence: 0.5 },
        { category: "preference", count: 1, confidence: 0.25 },
      ],
      snapshot: createSnapshot(),
      range: "30d",
    });

    expect(data.composition.outer).toHaveLength(2);
    expect(data.composition.outer[0]?.key).toBe("pinned");
    expect(data.composition.innerKind).toBe("analysis");
    expect(data.signals.source).toBe("analysis");
    expect(data.signals.items[0]).toEqual({
      value: "project",
      count: 3,
      ratio: 1,
    });
  });

  it("falls back to facet composition and local tag counts", () => {
    const data = buildMemoryPulseData({
      stats: createStats({ total: 3, pinned: 0, insight: 3 }),
      memories: [
        createMemory({
          id: "mem-1",
          metadata: { facet: "preferences" },
          tags: ["ui"],
        }),
        createMemory({
          id: "mem-2",
          metadata: { facet: "preferences" },
          tags: ["ui", "react"],
        }),
        createMemory({
          id: "mem-3",
          metadata: { facet: "plans" },
          tags: ["react"],
        }),
      ],
      cards: [],
      snapshot: null,
      range: "7d",
    });

    expect(data.composition.innerKind).toBe("facet");
    expect(data.composition.inner[0]?.key).toBe("preferences");
    expect(data.signals.source).toBe("memory");
    expect(data.signals.items[0]?.value).toBe("react");
    expect(data.trend.buckets).toHaveLength(7);
  });
});
