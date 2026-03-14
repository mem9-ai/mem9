import "@/i18n";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "@/router";
import i18n from "@/i18n";
import type { Memory } from "@/types/memory";
import type { SpaceAnalysisState } from "@/types/analysis";

const mocks = vi.hoisted(() => ({
  clearSpace: vi.fn(),
  retry: vi.fn(),
}));

function createMemory(
  id: string,
  content: string,
  updatedAt: string,
  memoryType: Memory["memory_type"] = "insight",
): Memory {
  return {
    id,
    content,
    memory_type: memoryType,
    source: "agent",
    tags: [],
    metadata: null,
    agent_id: "agent",
    session_id: "",
    state: "active",
    version: 1,
    updated_by: "agent",
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}

const activityNewest = createMemory(
  "mem-activity-1",
  "Deploy dashboard status update",
  "2026-03-03T00:00:00Z",
);
const preferenceMemory = createMemory(
  "mem-preference-1",
  "Prefer Neovim for edits",
  "2026-03-02T00:00:00Z",
);
const activityOlder = createMemory(
  "mem-activity-2",
  "Weekly activity planning notes",
  "2026-03-01T00:00:00Z",
);

const analysisState: SpaceAnalysisState = {
  phase: "completed",
  snapshot: {
    jobId: "aj_1",
    status: "COMPLETED",
    expectedTotalMemories: 3,
    expectedTotalBatches: 1,
    batchSize: 3,
    pipelineVersion: "v1",
    taxonomyVersion: "v2",
    llmEnabled: true,
    createdAt: "2026-03-03T00:00:00Z",
    startedAt: "2026-03-03T00:00:00Z",
    completedAt: "2026-03-03T00:00:02Z",
    expiresAt: null,
    progress: {
      expectedTotalBatches: 1,
      uploadedBatches: 1,
      completedBatches: 1,
      failedBatches: 0,
      processedMemories: 3,
      resultVersion: 1,
    },
    aggregate: {
      categoryCounts: {
        identity: 0,
        emotion: 0,
        preference: 1,
        experience: 0,
        activity: 2,
      },
      tagCounts: {},
      topicCounts: {},
      summarySnapshot: [],
      resultVersion: 1,
    },
    aggregateCards: [
      { category: "activity", count: 2, confidence: 0.67 },
      { category: "preference", count: 1, confidence: 0.33 },
    ],
    topTags: [],
    topTopics: [],
    batchSummaries: [],
  },
  events: [],
  cursor: 0,
  error: null,
  warning: null,
  jobId: "aj_1",
  fingerprint: "fp",
  pollAfterMs: 1000,
  isRetrying: false,
};

vi.mock("@/lib/session", () => ({
  getActiveSpaceId: () => "space-1",
  getSpaceId: () => "space-1",
  setSpaceId: vi.fn(),
  clearSpace: mocks.clearSpace,
  maskSpaceId: (id: string) => id,
}));

vi.mock("@/api/queries", () => ({
  useStats: () => ({
    data: {
      total: 3,
      pinned: 0,
      insight: 3,
    },
  }),
  useMemories: () => ({
    data: {
      pages: [
        {
          memories: [activityNewest, preferenceMemory, activityOlder],
          total: 3,
          limit: 50,
          offset: 0,
        },
      ],
    },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
  }),
  useCreateMemory: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteMemory: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateMemory: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useExportMemories: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportMemories: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportTasks: () => ({ data: { tasks: [] } }),
  useTopicSummary: () => ({ data: undefined }),
}));

vi.mock("@/api/analysis-queries", () => ({
  useSpaceAnalysis: () => ({
    state: analysisState,
    taxonomy: {
      version: "v2",
      updatedAt: "2026-03-10T00:00:00Z",
      categories: ["identity", "emotion", "preference", "experience", "activity"],
      rules: [],
    },
    taxonomyUnavailable: false,
    cards: [
      { category: "activity", count: 2, confidence: 0.67 },
      { category: "preference", count: 1, confidence: 0.33 },
    ],
    matches: [
      {
        memoryId: activityNewest.id,
        categories: ["activity"],
        categoryScores: { activity: 2 },
      },
      {
        memoryId: preferenceMemory.id,
        categories: ["preference"],
        categoryScores: { preference: 1 },
      },
      {
        memoryId: activityOlder.id,
        categories: ["activity"],
        categoryScores: { activity: 1 },
      },
    ],
    matchMap: new Map([
      [
        activityNewest.id,
        {
          memoryId: activityNewest.id,
          categories: ["activity"],
          categoryScores: { activity: 2 },
        },
      ],
      [
        preferenceMemory.id,
        {
          memoryId: preferenceMemory.id,
          categories: ["preference"],
          categoryScores: { preference: 1 },
        },
      ],
      [
        activityOlder.id,
        {
          memoryId: activityOlder.id,
          categories: ["activity"],
          categoryScores: { activity: 1 },
        },
      ],
    ]),
    sourceMemories: [activityNewest, preferenceMemory, activityOlder],
    sourceCount: 3,
    sourceLoading: false,
    retry: mocks.retry,
  }),
}));

describe("SpacePage", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    window.history.pushState({}, "", "/your-memory/space");
    await act(async () => {
      await router.navigate({ to: "/space", search: {} });
    });
  });

  it("filters memories by clicked analysis category and auto-selects the first match", async () => {
    render(<RouterProvider router={router} />);

    fireEvent.click(screen.getByRole("button", { name: /Activity/ }));

    await waitFor(() => {
      expect(screen.queryByText("Prefer Neovim for edits")).not.toBeInTheDocument();
    });

    expect(screen.getAllByText("Deploy dashboard status update")).toHaveLength(2);
    expect(screen.getByText("Weekly activity planning notes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete this memory" })).toBeInTheDocument();
  });
});
