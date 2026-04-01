import "@/i18n";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "@/router";
import i18n from "@/i18n";
import type { Memory } from "@/types/memory";
import type { SpaceAnalysisState } from "@/types/analysis";
import { shouldCompactMemoryOverview } from "./space";

const mocks = vi.hoisted(() => ({
  clearSpace: vi.fn(),
  isRememberedSpace: vi.fn(() => false),
  retry: vi.fn(),
  useStats: vi.fn(),
  useSourceMemories: vi.fn(),
  useSessionPreviewMessages: vi.fn(),
  useMemories: vi.fn(),
  useDeepAnalysisReports: vi.fn(),
}));

const FIXED_NOW = new Date("2026-03-21T12:00:00Z");

Object.defineProperty(window, "scrollTo", {
  value: vi.fn(),
  writable: true,
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("min-width") && window.innerWidth >= 1200,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

if (typeof Element.prototype.requestFullscreen === "undefined") {
  Element.prototype.requestFullscreen = vi.fn().mockResolvedValue(undefined);
}
if (typeof document.exitFullscreen === "undefined") {
  document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
}

function getAnalysisCategoryButton(category: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(
    `[data-mp-event="Dashboard/Analysis/CategoryClicked"][data-mp-category="${category}"]`,
  );

  if (!button) {
    throw new Error(`Missing analysis category button for ${category}`);
  }

  return button;
}

function getTimelineBucket(index: number): Element {
  const bucket = document.querySelector(`[data-timeline-bucket-index="${index}"]`);

  if (!bucket) {
    throw new Error(`Missing timeline bucket at index ${index}`);
  }

  return bucket;
}

function getFarmCta(): HTMLElement {
  const cta = document.querySelector<HTMLElement>(
    '[data-mp-event="Dashboard/MemoryFarm/EnterClicked"]',
  );

  if (!cta) {
    throw new Error("Missing Memory Farm CTA");
  }

  return cta;
}

function getFarmMoreActionsTrigger(): HTMLButtonElement {
  return screen.getByRole("button", { name: "More options" });
}

function createMemory(
  id: string,
  content: string,
  createdAt: string,
  memoryType: Memory["memory_type"] = "insight",
  tags: string[] = [],
  sessionId = "",
  updatedAt = createdAt,
): Memory {
  return {
    id,
    content,
    memory_type: memoryType,
    source: "agent",
    tags,
    metadata: null,
    agent_id: "agent",
    session_id: sessionId,
    state: "active",
    version: 1,
    updated_by: "agent",
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function renderSpacePage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Infinity,
        retry: false,
      },
      mutations: {
        gcTime: Infinity,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const activityNewest = createMemory(
  "mem-activity-1",
  "Deploy dashboard status update",
  "2026-03-03T00:00:00Z",
  "insight",
  ["launch", "release"],
  "sess-activity-1",
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
  "2026-03-17T00:00:00Z",
  "insight",
  ["launch"],
  "",
  "2026-03-20T00:00:00Z",
);
const archivedMemory = createMemory(
  "mem-archived-1",
  "Archived launch notes from February",
  "2026-02-10T00:00:00Z",
  "insight",
  ["launch"],
  "",
  "2026-03-21T00:00:00Z",
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
    taxonomyVersion: "v3",
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

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  },
  Toaster: () => null,
}));

vi.mock("@/lib/ga4", () => ({
  trackGa4PageView: vi.fn(),
  trackGa4Event: vi.fn(),
}));

vi.mock("@/lib/mixpanel", () => ({
  trackMixpanelPageView: vi.fn(),
  trackMixpanelEvent: vi.fn(),
}));

vi.mock("@/lib/mixpanel-auto-click", () => ({
  useMixpanelAutoClick: vi.fn(),
}));

vi.mock("@/lib/memory-insight-background", async () => {
  const { buildLocalDerivedSignalIndex } = await import("@/lib/memory-derived-signals");
  const { useMemo } = await import("react");
  return {
    useBackgroundDerivedSignals: (input: {
      memories: import("@/types/memory").Memory[];
      matchMap: Map<string, import("@/types/analysis").MemoryAnalysisMatch>;
    }) => {
      const data = useMemo(
        () => buildLocalDerivedSignalIndex({
          memories: input.memories,
          matchMap: input.matchMap,
        }),
        [input.memories, input.matchMap],
      );
      return { data, isComputing: false };
    },
    useBackgroundMemoryInsightGraph: () => ({
      data: { cards: [], tags: [], entities: [], memories: [] },
      isComputing: false,
    }),
    useBackgroundMemoryInsightRelationGraph: () => ({
      data: {
        entities: [],
        edges: [],
        clusters: [],
        bridgeEntities: [],
        risingEntities: [],
        entitiesById: new Map(),
        edgesById: new Map(),
        topEntityIds: [],
        topEdgeIds: [],
        totalMemories: 0,
      },
      isComputing: false,
    }),
    EMPTY_LOCAL_DERIVED_SIGNAL_INDEX: {
      derivedTagsByMemoryId: new Map(),
      combinedTagsByMemoryId: new Map(),
      tagStats: [],
      tagSourceByValue: new Map(),
    },
  };
});

vi.mock("@/lib/session", () => ({
  getActiveSpaceId: () => "space-1",
  getSpaceId: () => "space-1",
  isRememberedSpace: mocks.isRememberedSpace,
  setSpaceId: vi.fn(),
  clearSpace: mocks.clearSpace,
  maskSpaceId: (id: string) => id,
}));

vi.mock("@/config/features", () => ({
  features: {
    useMock: false,
    enableMockSessionPreview: false,
    enableManualAdd: false,
    enableTimeRange: true,
    enableFacet: false,
    enableTopicSummary: false,
    enableAnalysis: true,
  },
}));

vi.mock("@/api/local-cache", () => ({
  patchSyncState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/components/space/use-memory-farm-entry-state", () => ({
  useMemoryFarmEntryState: () => "ready",
}));

vi.mock("@/api/queries", () => ({
  getSessionPreviewLookupKey: (memory: Memory) =>
    memory.memory_type === "insight" ? memory.session_id : "",
  useStats: (spaceId: string, range?: string, enabled = true) => {
    mocks.useStats(spaceId, range, enabled);
    return {
      data: enabled ? { total: 4, pinned: 0, insight: 4 } : undefined,
      isLoading: false,
      isFetching: false,
    };
  },
  useMemories: (_spaceId: string, params: Record<string, unknown>) => {
    mocks.useMemories(_spaceId, params);
    return {
      data: {
        pages: [
          {
            memories: [activityNewest, preferenceMemory, activityOlder, archivedMemory],
            total: 4,
            limit: 50,
            offset: 0,
          },
        ],
      },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
      isFetching: false,
    };
  },
  useSessionPreviewMessages: (_spaceId: string, memories: Memory[]) => {
    mocks.useSessionPreviewMessages(memories);
    return {
      data: {
        "sess-activity-1": [
          {
            id: "msg-1",
            session_id: "sess-activity-1",
            agent_id: "agent",
            source: "agent",
            seq: 1,
            role: "user",
            content: "We should keep the launch demo focused and avoid expanding scope.",
            content_type: "text/plain",
            tags: [],
            state: "active",
            created_at: "2026-03-03T00:00:00Z",
            updated_at: "2026-03-03T00:00:00Z",
          },
          {
            id: "msg-2",
            session_id: "sess-activity-1",
            agent_id: "agent",
            source: "agent",
            seq: 2,
            role: "assistant",
            content: [
              "Agreed. I will keep the dashboard release notes compact and demo-oriented.",
              "",
              "```json",
              '{"status":"ok"}',
              "```",
            ].join("\n"),
            content_type: "text/plain",
            tags: [],
            state: "active",
            created_at: "2026-03-03T00:01:00Z",
            updated_at: "2026-03-03T00:01:00Z",
          },
        ],
      },
      isLoading: false,
      isFetching: false,
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

vi.mock("@/api/source-memories", () => ({
  getSourceMemoriesQueryKey: (spaceId: string) => ["space", spaceId, "sourceMemories"],
  useSourceMemories: (_spaceId: string) => {
    mocks.useSourceMemories(_spaceId);
    return {
      data: [activityNewest, preferenceMemory, activityOlder, archivedMemory],
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(async () => undefined),
    };
  },
}));

vi.mock("@/api/analysis-queries", () => ({
  useSpaceAnalysis: () => ({
    state: analysisState,
    taxonomy: {
      version: "v3",
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

vi.mock("@/api/deep-analysis-queries", () => ({
  useDeepAnalysisReports: (...args: unknown[]) => {
    mocks.useDeepAnalysisReports(...args);
    return {
      reports: [],
      selectedReport: null,
      selectedReportId: null,
      setSelectedReportId: vi.fn(),
      inlineError: null,
      clearInlineError: vi.fn(),
      isLoading: false,
      isCreating: false,
      createReport: vi.fn(async () => undefined),
    };
  },
}));

describe("SpacePage", () => {
  beforeEach(async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW.getTime());
    window.innerWidth = 1440;
    window.dispatchEvent(new Event("resize"));
    mocks.isRememberedSpace.mockReset();
    mocks.isRememberedSpace.mockReturnValue(false);
    mocks.useStats.mockClear();
    mocks.useSourceMemories.mockClear();
    mocks.useMemories.mockClear();
    mocks.useDeepAnalysisReports.mockClear();
    await i18n.changeLanguage("en");
    window.history.pushState({}, "", "/your-memory/space");
    await act(async () => {
      await router.navigate({ to: "/space", search: {} });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not compact the overview when an insight memory opens in a sheet", () => {
    const selected = createMemory(
      "mem-1",
      "Insight memory",
      "2026-03-10T00:00:00Z",
    );

    expect(shouldCompactMemoryOverview(selected, true, "sheet")).toBe(false);
    expect(shouldCompactMemoryOverview(selected, true, "panel")).toBe(true);
    expect(shouldCompactMemoryOverview(selected, false, "sheet")).toBe(false);
  });

  it("filters memories by clicked analysis category without auto-opening detail", async () => {
    renderSpacePage();

    fireEvent.click(getAnalysisCategoryButton("activity"));

    await waitFor(() => {
      expect(screen.queryByText("Prefer Neovim for edits")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Deploy dashboard status update")).toBeInTheDocument();
    expect(screen.getByText("Weekly activity planning notes")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete this memory" }),
    ).not.toBeInTheDocument();
  });

  it("does not prefetch deep-analysis reports before the analysis tab is opened", async () => {
    renderSpacePage();

    expect(mocks.useDeepAnalysisReports).not.toHaveBeenCalled();

    const analysisTab = screen.getByRole("tab", { name: "Memory Analysis" });
    analysisTab.focus();
    fireEvent.keyDown(analysisTab, { key: "Enter" });

    await waitFor(() => {
      expect(mocks.useDeepAnalysisReports).toHaveBeenCalledWith("space-1", true);
    });
  });

  it("keeps all-range stats disabled until the export dialog is opened", async () => {
    renderSpacePage();

    await act(async () => {
      await router.navigate({
        to: "/space",
        search: { range: "30d" },
      });
    });

    expect(mocks.useStats).toHaveBeenCalledWith("space-1", "30d", true);
    expect(mocks.useStats).toHaveBeenCalledWith("space-1", undefined, false);

    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => {
      expect(mocks.useStats).toHaveBeenCalledWith("space-1", undefined, true);
    });
  });

  it("navigates to memory farm in the current tab when remember is off", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    renderSpacePage();

    expect(screen.queryByRole("button", { name: "More options" })).not.toBeInTheDocument();

    fireEvent.click(getFarmCta());

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/labs/memory-farm");
    });

    expect(openSpy).not.toHaveBeenCalled();
  });

  it("shows a remembered-only new-tab menu for memory farm", async () => {
    mocks.isRememberedSpace.mockReturnValue(true);

    renderSpacePage();

    expect(screen.queryByText("New tab:")).not.toBeInTheDocument();
    expect(getFarmMoreActionsTrigger()).toBeInTheDocument();

    const menuTrigger = getFarmMoreActionsTrigger();
    menuTrigger.focus();
    fireEvent.keyDown(menuTrigger, { key: "Enter" });

    const menuItem = await screen.findByRole("menuitem", { name: "Enter Farm in new tab" });

    expect(menuItem).toHaveAttribute("href", "/your-memory/labs/memory-farm");
    expect(menuItem).toHaveAttribute("target", "_blank");
    expect(menuItem).toHaveTextContent("Enter Farm");
    expect(menuItem).toHaveTextContent("(new tab)");
  });

  it("keeps current-tab enter as the primary CTA when remember is on", async () => {
    mocks.isRememberedSpace.mockReturnValue(true);
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    renderSpacePage();

    const cta = getFarmCta();

    expect(cta.tagName).toBe("BUTTON");

    fireEvent.click(cta);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/labs/memory-farm");
    });

    expect(openSpy).not.toHaveBeenCalled();
  });

  it("keeps the detail panel closed after the user closes it in analysis mode", async () => {
    renderSpacePage();

    fireEvent.click(getAnalysisCategoryButton("activity"));

    await waitFor(() => {
      expect(screen.queryByText("Prefer Neovim for edits")).not.toBeInTheDocument();
    });

    const activityCard = screen
      .getByText("Deploy dashboard status update")
      .closest('[role="button"]');

    expect(activityCard).not.toBeNull();
    fireEvent.click(activityCard!);

    expect(screen.getByTestId("detail-scroll-area")).toHaveClass("flex-1");
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
    renderSpacePage();

    const preferenceCard = screen
      .getByText("Prefer Neovim for edits")
      .closest('[role="button"]');

    expect(preferenceCard).not.toBeNull();
    fireEvent.click(preferenceCard!);

    expect(
      screen.getByRole("button", { name: "Delete this memory" }),
    ).toBeInTheDocument();

    fireEvent.click(getAnalysisCategoryButton("activity"));

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

    renderSpacePage();

    expect(
      screen.getByRole("button", { name: "Summary" }),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-mp-event="Dashboard/Analysis/CategoryClicked"]'),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Summary" }));

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
    renderSpacePage();

    expect(screen.getByText("Browse by tag")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /filter by tag launch/i }),
    );

    await waitFor(() => {
      expect(router.state.location.search.tag).toBe("launch");
    });

    expect(screen.getByRole("button", { name: /^#launch$/ })).toBeInTheDocument();
    expect(screen.getByText("Deploy dashboard status update")).toBeInTheDocument();
    expect(screen.getByText("Weekly activity planning notes")).toBeInTheDocument();
    expect(screen.queryByText("Prefer Neovim for edits")).not.toBeInTheDocument();
  });

  it("filters memories by clicked rhythm bucket using created_at", async () => {
    renderSpacePage();

    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    await waitFor(() => {
      expect(router.state.location.search.range).toBe("7d");
    });

    fireEvent.click(getTimelineBucket(2));

    await waitFor(() => {
      expect(router.state.location.search.timelineFrom).toBeDefined();
    });

    expect(screen.getByText("Weekly activity planning notes")).toBeInTheDocument();
    expect(screen.queryByText("Deploy dashboard status update")).not.toBeInTheDocument();
    expect(screen.queryByText("Prefer Neovim for edits")).not.toBeInTheDocument();
    expect(screen.queryByText("Archived launch notes from February")).not.toBeInTheDocument();
  });

  it("toggles off the timeline filter when the same bucket is clicked twice", async () => {
    renderSpacePage();

    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    await waitFor(() => {
      expect(router.state.location.search.range).toBe("7d");
    });

    fireEvent.click(getTimelineBucket(2));
    await waitFor(() => {
      expect(router.state.location.search.timelineFrom).toBeDefined();
    });

    fireEvent.click(getTimelineBucket(2));
    await waitFor(() => {
      expect(router.state.location.search.timelineFrom).toBeUndefined();
      expect(router.state.location.search.timelineTo).toBeUndefined();
    });

    expect(screen.getByText("Weekly activity planning notes")).toBeInTheDocument();
  });

  it("clears the selected timeline bucket when the range changes", async () => {
    renderSpacePage();

    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    await waitFor(() => {
      expect(router.state.location.search.range).toBe("7d");
    });

    fireEvent.click(getTimelineBucket(2));

    await waitFor(() => {
      expect(router.state.location.search.timelineFrom).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "30 days" }));

    await waitFor(() => {
      expect(router.state.location.search.range).toBe("30d");
      expect(router.state.location.search.timelineFrom).toBeUndefined();
      expect(router.state.location.search.timelineTo).toBeUndefined();
    });
  });

  it("shows no results when a zero-count timeline bucket is selected", async () => {
    renderSpacePage();

    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    await waitFor(() => {
      expect(router.state.location.search.range).toBe("7d");
    });

    fireEvent.click(getTimelineBucket(0));

    await waitFor(() => {
      expect(router.state.location.search.timelineFrom).toBeDefined();
    });

    expect(screen.getByRole("tab", { name: "Memory Pulse" })).toBeInTheDocument();
    expect(screen.getByText("No matching memories found")).toBeInTheDocument();
    expect(screen.queryByText("Weekly activity planning notes")).not.toBeInTheDocument();
    expect(screen.queryByText("Deploy dashboard status update")).not.toBeInTheDocument();
  });

  it("closes the detail panel when a timeline filter removes the selected memory", async () => {
    renderSpacePage();

    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    await waitFor(() => {
      expect(router.state.location.search.range).toBe("7d");
    });

    const olderCard = screen
      .getByText("Weekly activity planning notes")
      .closest('[role="button"]');

    expect(olderCard).not.toBeNull();
    fireEvent.click(olderCard!);

    expect(
      screen.getByRole("button", { name: "Delete this memory" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /0 memories$/i })[0]!);

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Delete this memory" }),
      ).not.toBeInTheDocument();
    });
  });

  it("renders session preview content for insight memories with matched session data", async () => {
    renderSpacePage();

    expect(
      screen.getByText("We should keep the launch demo focused and avoid expanding scope."),
    ).toBeInTheDocument();

    const activityCard = screen
      .getByText("Deploy dashboard status update")
      .closest('[role="button"]');

    expect(activityCard).not.toBeNull();
    fireEvent.click(activityCard!);

    expect(
      within(screen.getByTestId("detail-scroll-area")).getByText("Original Conversation"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("detail-scroll-area")).getByText(
        "Agreed. I will keep the dashboard release notes compact and demo-oriented.",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("detail-scroll-area")).getByText('{"status":"ok"}'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("detail-scroll-area")).queryByText("```json"),
    ).not.toBeInTheDocument();
  });

  it("does not pass tag state to the useMemories API query", async () => {
    renderSpacePage();

    const tagButton = within(screen.getByTestId("analysis-facets-tags"))
      .getByRole("button", { name: /launch/i });
    fireEvent.click(tagButton);

    await waitFor(() => {
      expect(router.state.location.search.tag).toBe("launch");
    });

    const calls = mocks.useMemories.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall).toBeDefined();
    expect(lastCall![1]).not.toHaveProperty("tag");
  });

  it("keeps tag state when leaving analysis mode", async () => {
    renderSpacePage();

    fireEvent.click(getAnalysisCategoryButton("activity"));

    await waitFor(() => {
      expect(router.state.location.search.analysisCategory).toBe("activity");
    });

    const tagButton = within(screen.getByTestId("analysis-facets-tags"))
      .getByRole("button", { name: /launch/i });
    fireEvent.click(tagButton);

    await waitFor(() => {
      expect(router.state.location.search.tag).toBe("launch");
    });

    fireEvent.click(getAnalysisCategoryButton("activity"));

    await waitFor(() => {
      expect(router.state.location.search.analysisCategory).toBeUndefined();
    });

    expect(router.state.location.search.tag).toBe("launch");
  });

  it("filters the list locally when clicking a left analysis tag", async () => {
    renderSpacePage();

    const tagButton = within(screen.getByTestId("analysis-facets-tags"))
      .getByRole("button", { name: /launch/i });
    fireEvent.click(tagButton);

    await waitFor(() => {
      expect(router.state.location.search.tag).toBe("launch");
    });

    expect(screen.getByText("Deploy dashboard status update")).toBeInTheDocument();
    expect(screen.getByText("Weekly activity planning notes")).toBeInTheDocument();
    expect(screen.queryByText("Prefer Neovim for edits")).not.toBeInTheDocument();
  });
});
