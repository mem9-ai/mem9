import "@/i18n";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RouterProvider } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "@/router";
import i18n from "@/i18n";
import type { Memory } from "@/types/memory";
import type { SpaceAnalysisState } from "@/types/analysis";

const mocks = vi.hoisted(() => ({
  clearSpace: vi.fn(),
  retry: vi.fn(),
  useMemories: vi.fn(),
}));

function createMemory(
  id: string,
  content: string,
  updatedAt: string,
  memoryType: Memory["memory_type"] = "insight",
  tags: string[] = [],
): Memory {
  return {
    id,
    content,
    memory_type: memoryType,
    source: "agent",
    tags,
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
  "insight",
  ["launch", "release"],
);
const preferenceMemory = createMemory(
  "mem-preference-1",
  "Prefer Neovim for edits",
  "2026-03-02T00:00:00Z",
  "insight",
  ["editor"],
);
const activityOlder = createMemory(
  "mem-activity-2",
  "Weekly activity planning notes",
  "2026-03-01T00:00:00Z",
  "insight",
  ["launch"],
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
  useMemories: (_spaceId: string, params: { tag?: string }) => {
    mocks.useMemories(params);
    const memories = [activityNewest, preferenceMemory, activityOlder].filter(
      (memory) =>
        !params.tag ||
        memory.tags.some((tag) => tag.toLowerCase() === params.tag?.toLowerCase()),
    );

    return {
      data: {
        pages: [
          {
            memories,
            total: memories.length,
            limit: 50,
            offset: 0,
          },
        ],
      },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
    };
  },
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
    window.innerWidth = 1440;
    window.dispatchEvent(new Event("resize"));
    mocks.useMemories.mockClear();
    await i18n.changeLanguage("en");
    window.history.pushState({}, "", "/your-memory/space");
    await act(async () => {
      await router.navigate({ to: "/space", search: {} });
    });
  });

  it("filters memories by clicked analysis category without auto-opening detail", async () => {
    render(<RouterProvider router={router} />);

    fireEvent.click(screen.getByRole("button", { name: /Activity/ }));

    await waitFor(() => {
      expect(screen.queryByText("Prefer Neovim for edits")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Deploy dashboard status update")).toBeInTheDocument();
    expect(screen.getByText("Weekly activity planning notes")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete this memory" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the detail panel closed after the user closes it in analysis mode", async () => {
    render(<RouterProvider router={router} />);

    fireEvent.click(screen.getByRole("button", { name: /Activity/ }));

    await waitFor(() => {
      expect(screen.queryByText("Prefer Neovim for edits")).not.toBeInTheDocument();
    });

    const activityCard = screen
      .getByText("Deploy dashboard status update")
      .closest('[role="button"]');

    expect(activityCard).not.toBeNull();
    fireEvent.click(activityCard!);

    expect(screen.getByTestId("detail-scroll-area")).toHaveClass(
      "max-h-[60vh]",
    );
    expect(
      screen.getByRole("button", { name: "Delete this memory" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(
      screen.queryByRole("button", { name: "Delete this memory" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Weekly activity planning notes")).toBeInTheDocument();
  });

  it("closes the detail panel when the selected memory is filtered out", async () => {
    render(<RouterProvider router={router} />);

    const preferenceCard = screen
      .getByText("Prefer Neovim for edits")
      .closest('[role="button"]');

    expect(preferenceCard).not.toBeNull();
    fireEvent.click(preferenceCard!);

    expect(
      screen.getByRole("button", { name: "Delete this memory" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Activity/ }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Delete this memory" }),
      ).not.toBeInTheDocument();
    });

    expect(screen.getByText("Weekly activity planning notes")).toBeInTheDocument();
  });

  it("uses mobile analysis and detail overlays on narrow screens", async () => {
    window.innerWidth = 390;
    window.dispatchEvent(new Event("resize"));

    render(<RouterProvider router={router} />);

    expect(
      screen.getByRole("button", { name: "Analysis" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Activity/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Analysis" }));

    const analysisDialog = screen.getByRole("dialog");
    expect(analysisDialog).toBeInTheDocument();
    expect(analysisDialog).toHaveClass("right-0", "left-auto");

    fireEvent.click(within(analysisDialog).getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    const memoryCard = screen
      .getByText("Deploy dashboard status update")
      .closest('[role="button"]');

    expect(memoryCard).not.toBeNull();
    fireEvent.click(memoryCard!);

    const detailDialog = screen.getByRole("dialog");
    expect(detailDialog).toHaveClass("right-0", "left-auto");
    expect(within(detailDialog).getByTestId("detail-scroll-area")).toHaveClass(
      "flex-1",
    );
    expect(
      within(detailDialog).getByTestId("detail-scroll-area"),
    ).not.toHaveClass("max-h-[60vh]");
    expect(
      screen.getByRole("button", { name: "Delete this memory" }),
    ).toBeInTheDocument();

    fireEvent.click(within(detailDialog).getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("shows tag chips and filters the list by tag", async () => {
    render(<RouterProvider router={router} />);

    expect(screen.getByText("Browse by tag")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /filter by tag launch/i }),
    );

    await waitFor(() => {
      expect(mocks.useMemories).toHaveBeenLastCalledWith(
        expect.objectContaining({ tag: "launch" }),
      );
    });

    expect(screen.getByRole("button", { name: /^#launch$/ })).toBeInTheDocument();
    expect(screen.getByText("Weekly activity planning notes")).toBeInTheDocument();
  });
});
