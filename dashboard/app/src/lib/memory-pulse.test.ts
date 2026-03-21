import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMemoryPulseData } from "./memory-pulse";
import type { AnalysisJobSnapshotResponse } from "@/types/analysis";
import type { Memory, MemoryStats } from "@/types/memory";

const FIXED_NOW = new Date("2026-03-21T12:00:00Z");

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
    taxonomyVersion: "v3",
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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("memory pulse helpers", () => {
  it("prefers local memory tags for clickable signal stack filters", () => {
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
    expect(data.signals.source).toBe("memory");
    expect(data.signals.items[0]).toEqual({
      value: "project",
      count: 3,
      ratio: 1,
    });
  });

  it("falls back to analysis tag stats when memories have no local tags", () => {
    const data = buildMemoryPulseData({
      stats: createStats(),
      memories: [
        createMemory({ id: "mem-1", tags: [] }),
        createMemory({ id: "mem-2", tags: [] }),
      ],
      cards: [
        { category: "identity", count: 2, confidence: 0.5 },
      ],
      snapshot: createSnapshot(),
      range: "30d",
    });

    expect(data.signals.source).toBe("analysis");
    expect(data.signals.items[0]).toEqual({
      value: "project",
      count: 3,
      ratio: 1,
    });
  });

  it("builds the all-time window from created_at timestamps", () => {
    const data = buildMemoryPulseData({
      stats: createStats({ total: 2, pinned: 1, insight: 1 }),
      memories: [
        createMemory({
          id: "mem-early",
          created_at: "2026-03-01T12:00:00Z",
          updated_at: "2026-03-20T12:00:00Z",
        }),
        createMemory({
          id: "mem-late",
          created_at: "2026-03-10T12:00:00Z",
          updated_at: "2026-03-02T12:00:00Z",
        }),
      ],
      cards: [],
      snapshot: null,
      range: "all",
    });

    expect(data.trend.buckets).toHaveLength(12);
    expect(data.trend.buckets[0]?.start).toBe(
      Date.parse("2026-03-01T12:00:00Z"),
    );
    expect(data.trend.buckets[data.trend.buckets.length - 1]?.end).toBe(
      Date.parse("2026-03-10T12:00:00Z"),
    );
  });

  it("counts created_at entries inside a range even when updated_at falls outside it", () => {
    const data = buildMemoryPulseData({
      stats: createStats({ total: 2, pinned: 1, insight: 1 }),
      memories: [
        createMemory({
          id: "mem-created-recent",
          created_at: "2026-03-19T12:00:00Z",
          updated_at: "2026-03-01T12:00:00Z",
        }),
        createMemory({
          id: "mem-created-recent-two",
          created_at: "2026-03-18T12:00:00Z",
          updated_at: "2026-03-20T12:00:00Z",
        }),
      ],
      cards: [],
      snapshot: null,
      range: "7d",
    });

    expect(
      data.trend.buckets.reduce((sum, bucket) => sum + bucket.count, 0),
    ).toBe(2);
    expect(data.trend.maxCount).toBeGreaterThanOrEqual(1);
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
