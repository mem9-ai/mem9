import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSpaceDataModel } from "./use-space-data-model";
import type { LocalDerivedSignalIndex } from "@/lib/memory-derived-signals";
import type { Memory } from "@/types/memory";

const mocks = vi.hoisted(() => ({
  useStats: vi.fn(),
  useMemories: vi.fn(),
  useSelectedSessionMessages: vi.fn(),
  useCreateMemory: vi.fn(),
  useDeleteMemory: vi.fn(),
  useUpdateMemory: vi.fn(),
  useExportMemories: vi.fn(),
  useImportMemories: vi.fn(),
  useImportTasks: vi.fn(),
  useTopicSummary: vi.fn(),
  useSourceMemories: vi.fn(),
  sourceRefetch: vi.fn(async () => undefined),
  useSpaceAnalysis: vi.fn(),
  useBackgroundDerivedSignals: vi.fn(),
}));

function createMemory(id: string): Memory {
  return {
    id,
    content: `memory-${id}`,
    memory_type: "insight",
    source: "agent",
    tags: ["dashboard"],
    metadata: null,
    agent_id: "agent",
    session_id: id === "mem-1" ? "sess-1" : "",
    state: "active",
    version: 1,
    updated_by: "agent",
    created_at: "2026-03-28T00:00:00Z",
    updated_at: "2026-03-28T00:00:00Z",
  };
}

const SOURCE_MEMORIES = [createMemory("mem-1"), createMemory("mem-2")];
const EMPTY_SIGNAL_INDEX: LocalDerivedSignalIndex = {
  derivedTagsByMemoryId: new Map(),
  combinedTagsByMemoryId: new Map(),
  tagStats: [],
  tagSourceByValue: new Map(),
};

vi.mock("@/api/queries", () => ({
  getLinkedSessionID: (memory: Pick<Memory, "session_id"> | null | undefined) =>
    memory?.session_id.trim() ?? "",
  useStats: (...args: unknown[]) => mocks.useStats(...args),
  useMemories: (...args: unknown[]) => mocks.useMemories(...args),
  useSelectedSessionMessages: (...args: unknown[]) => mocks.useSelectedSessionMessages(...args),
  useCreateMemory: () => mocks.useCreateMemory(),
  useDeleteMemory: () => mocks.useDeleteMemory(),
  useUpdateMemory: () => mocks.useUpdateMemory(),
  useExportMemories: () => mocks.useExportMemories(),
  useImportMemories: () => mocks.useImportMemories(),
  useImportTasks: () => mocks.useImportTasks(),
  useTopicSummary: (...args: unknown[]) => mocks.useTopicSummary(...args),
}));

vi.mock("@/api/source-memories", () => ({
  useSourceMemories: (...args: unknown[]) => mocks.useSourceMemories(...args),
}));

vi.mock("@/api/analysis-queries", () => ({
  useSpaceAnalysis: (...args: unknown[]) => mocks.useSpaceAnalysis(...args),
}));

vi.mock("@/components/space/use-memory-farm-entry-state", () => ({
  useMemoryFarmEntryState: () => "ready",
}));

vi.mock("@/lib/memory-insight-background", () => ({
  useBackgroundDerivedSignals: (...args: unknown[]) => mocks.useBackgroundDerivedSignals(...args),
}));

function primeMocks(): void {
  mocks.useStats.mockImplementation(
    (_spaceId: string, _range?: string, enabled = true) => ({
      data: enabled ? { total: 2, pinned: 0, insight: 2 } : undefined,
      isLoading: false,
      isFetching: false,
    }),
  );
  mocks.useMemories.mockReturnValue({
    data: {
      pages: [
        {
          memories: SOURCE_MEMORIES,
          total: SOURCE_MEMORIES.length,
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
  });
  mocks.useSelectedSessionMessages.mockReturnValue({
    data: [],
    isLoading: false,
    isFetching: false,
  });
  mocks.useCreateMemory.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  mocks.useDeleteMemory.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  mocks.useUpdateMemory.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  mocks.useExportMemories.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  mocks.useImportMemories.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  mocks.useImportTasks.mockReturnValue({ data: { tasks: [] } });
  mocks.useTopicSummary.mockReturnValue({ data: undefined });
  mocks.useSourceMemories.mockReturnValue({
    data: SOURCE_MEMORIES,
    isLoading: false,
    isFetching: false,
    refetch: mocks.sourceRefetch,
  });
  mocks.useSpaceAnalysis.mockImplementation((input: {
    sourceMemories: Memory[];
    sourceLoading: boolean;
  }) => ({
    state: {
      phase: "completed",
      snapshot: null,
      events: [],
      cursor: 0,
      error: null,
      warning: null,
      jobId: null,
      fingerprint: null,
      pollAfterMs: 0,
      isRetrying: false,
    },
    taxonomy: null,
    taxonomyUnavailable: false,
    cards: [],
    matches: [],
    matchMap: new Map(),
    sourceMemories: input.sourceMemories,
    sourceCount: input.sourceMemories.length,
    sourceLoading: input.sourceLoading,
    retry: vi.fn(),
  }));
  mocks.useBackgroundDerivedSignals.mockReturnValue({
    data: EMPTY_SIGNAL_INDEX,
    isComputing: false,
  });
}

describe("useSpaceDataModel", () => {
  afterEach(() => {
    vi.clearAllMocks();
    primeMocks();
  });

  primeMocks();

  it("keeps source memories under a single owner and passes shared source state into useSpaceAnalysis", () => {
    renderHook(() =>
      useSpaceDataModel({
        spaceId: "space-1",
        q: undefined,
        range: "all",
        facet: undefined,
        analysisCategory: undefined,
        tag: undefined,
        memoryTypeFilter: "pinned,insight",
        timelineSelection: undefined,
        importStatusOpen: false,
        exportOpen: false,
        isDesktopViewport: true,
        mobileAnalysisOpen: false,
        selected: null,
        localVisibleCount: 50,
        onSelectedMissing: vi.fn(),
      }),
    );

    expect(mocks.useSourceMemories).toHaveBeenCalledTimes(1);
    expect(mocks.useSpaceAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: "space-1",
        range: "all",
        sourceMemories: SOURCE_MEMORIES,
        sourceLoading: false,
        refreshSource: expect.any(Function),
      }),
    );
  });

  it("gates all-range stats behind the export dialog and only enables analysis signals when visible", () => {
    renderHook(() =>
      useSpaceDataModel({
        spaceId: "space-1",
        q: undefined,
        range: "30d",
        facet: undefined,
        analysisCategory: undefined,
        tag: undefined,
        memoryTypeFilter: "pinned,insight",
        timelineSelection: undefined,
        importStatusOpen: false,
        exportOpen: false,
        isDesktopViewport: false,
        mobileAnalysisOpen: false,
        selected: null,
        localVisibleCount: 50,
        onSelectedMissing: vi.fn(),
      }),
    );

    expect(mocks.useStats).toHaveBeenNthCalledWith(1, "space-1", "30d");
    expect(mocks.useStats).toHaveBeenNthCalledWith(2, "space-1", undefined, false);
    expect(mocks.useBackgroundDerivedSignals.mock.calls[0]?.[0]).not.toHaveProperty("enabled");
    expect(mocks.useBackgroundDerivedSignals).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ enabled: false }),
    );
    expect(mocks.useBackgroundDerivedSignals).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ enabled: false }),
    );
  });

  it("enables analysis-range and category signals when the analysis surface is active", () => {
    renderHook(() =>
      useSpaceDataModel({
        spaceId: "space-1",
        q: undefined,
        range: "30d",
        facet: undefined,
        analysisCategory: "activity",
        tag: undefined,
        memoryTypeFilter: "pinned,insight",
        timelineSelection: undefined,
        importStatusOpen: false,
        exportOpen: true,
        isDesktopViewport: false,
        mobileAnalysisOpen: true,
        selected: null,
        localVisibleCount: 50,
        onSelectedMissing: vi.fn(),
      }),
    );

    expect(mocks.useStats).toHaveBeenNthCalledWith(2, "space-1", undefined, true);
    expect(mocks.useBackgroundDerivedSignals).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ enabled: true }),
    );
    expect(mocks.useBackgroundDerivedSignals).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ enabled: true }),
    );
  });

  it("loads raw session data only for the selected memory", () => {
    const selected = SOURCE_MEMORIES[0]!;
    mocks.useSelectedSessionMessages.mockReturnValue({
      data: [
        {
          id: "msg-1",
          session_id: "sess-1",
          agent_id: "agent",
          source: "agent",
          seq: 1,
          role: "user",
          content: "hello",
          content_type: "text/plain",
          tags: [],
          state: "active",
          created_at: "2026-03-28T00:00:00Z",
          updated_at: "2026-03-28T00:00:00Z",
        },
      ],
      isLoading: false,
      isFetching: false,
    });

    const { result } = renderHook(() =>
      useSpaceDataModel({
        spaceId: "space-1",
        q: undefined,
        range: "all",
        facet: undefined,
        analysisCategory: undefined,
        tag: undefined,
        memoryTypeFilter: "pinned,insight",
        timelineSelection: undefined,
        importStatusOpen: false,
        exportOpen: false,
        isDesktopViewport: true,
        mobileAnalysisOpen: false,
        selected,
        localVisibleCount: 50,
        onSelectedMissing: vi.fn(),
      }),
    );

    expect(mocks.useSelectedSessionMessages).toHaveBeenCalledWith("space-1", selected);
    expect(result.current.selectedSessionMessages).toHaveLength(1);
    expect(result.current.selectedSessionMessagesLoading).toBe(false);
  });

  it("does not report selected-session loading when there is no linked session", () => {
    const { result } = renderHook(() =>
      useSpaceDataModel({
        spaceId: "space-1",
        q: undefined,
        range: "all",
        facet: undefined,
        analysisCategory: undefined,
        tag: undefined,
        memoryTypeFilter: "pinned,insight",
        timelineSelection: undefined,
        importStatusOpen: false,
        exportOpen: false,
        isDesktopViewport: true,
        mobileAnalysisOpen: false,
        selected: SOURCE_MEMORIES[1]!,
        localVisibleCount: 50,
        onSelectedMissing: vi.fn(),
      }),
    );

    expect(mocks.useSelectedSessionMessages).toHaveBeenCalledWith(
      "space-1",
      SOURCE_MEMORIES[1]!,
    );
    expect(result.current.selectedSessionMessages).toEqual([]);
    expect(result.current.selectedSessionMessagesLoading).toBe(false);
  });
});
