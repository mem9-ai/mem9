import { useEffect, useMemo } from "react";
import {
  getSessionPreviewLookupKey,
  useStats,
  useMemories,
  useSessionPreviewMessages,
  useCreateMemory,
  useDeleteMemory,
  useUpdateMemory,
  useExportMemories,
  useImportMemories,
  useImportTasks,
  useTopicSummary,
} from "@/api/queries";
import { useSourceMemories } from "@/api/source-memories";
import { useSpaceAnalysis } from "@/api/analysis-queries";
import {
  filterMemoriesForView,
  type MemoryTagResolver,
} from "@/lib/memory-filters";
import {
  type DerivedTagOrigin,
  getDerivedTagOrigin,
  getDerivedTagsForMemory,
} from "@/lib/memory-derived-signals";
import { useBackgroundDerivedSignals } from "@/lib/memory-insight-background";
import { normalizeTagSignal } from "@/lib/tag-signals";
import { buildStats, buildTagOptions, createTagResolver, selectDisplayedMemories } from "./space-selectors";
import { useMemoryFarmEntryState, type MemoryFarmEntryStatus } from "./use-memory-farm-entry-state";
import { features } from "@/config/features";
import type { AnalysisCategory } from "@/types/analysis";
import type {
  Memory,
  MemoryFacet,
  MemoryStats,
  MemoryTypeFilter,
  SessionMessage,
} from "@/types/memory";
import type { TimeRangePreset, TimelineSelection } from "@/types/time-range";
import type { TagSummary } from "./tag-strip";

export interface SpaceDataModel {
  stats: MemoryStats | undefined;
  totalStats: MemoryStats | undefined;
  rangeStats: MemoryStats;
  pulseMemories: Memory[];
  analysis: ReturnType<typeof useSpaceAnalysis>;
  sourceQuery: ReturnType<typeof useSourceMemories>;
  farmEntryStatus: MemoryFarmEntryStatus;
  topicData: ReturnType<typeof useTopicSummary>["data"];
  importTaskData: ReturnType<typeof useImportTasks>["data"];
  createMutation: ReturnType<typeof useCreateMemory>;
  deleteMutation: ReturnType<typeof useDeleteMemory>;
  updateMutation: ReturnType<typeof useUpdateMemory>;
  exportMutation: ReturnType<typeof useExportMemories>;
  importMutation: ReturnType<typeof useImportMemories>;
  memories: Memory[];
  displayedMemories: Memory[];
  baseDisplayedMemories: Memory[];
  usingLocalFilteredList: boolean;
  hasMoreMemories: boolean;
  isMemoryLoading: boolean;
  isFetchingMore: boolean;
  displayedFirstPageSize: number;
  fetchNextPage: ReturnType<typeof useMemories>["fetchNextPage"];
  sessionPreviewBySessionID: Record<string, SessionMessage[]>;
  selectedSessionPreview: SessionMessage[];
  selectedSessionPreviewLoading: boolean;
  tagOptions: TagSummary[];
  analysisTagStats: Array<{
    value: string;
    count: number;
    origin?: DerivedTagOrigin;
  }>;
  activeTagNormalized: string | null;
  activeTagOrigin: DerivedTagOrigin | null;
  getActiveDerivedTags: (memory: Memory) => string[];
}

export function useSpaceDataModel(input: {
  spaceId: string;
  q: string | undefined;
  range: TimeRangePreset;
  facet: MemoryFacet | undefined;
  analysisCategory: AnalysisCategory | undefined;
  tag: string | undefined;
  memoryTypeFilter: MemoryTypeFilter;
  timelineSelection: TimelineSelection | undefined;
  importStatusOpen: boolean;
  selected: Memory | null;
  localVisibleCount: number;
  onSelectedMissing: () => void;
}): SpaceDataModel {
  const { spaceId } = input;
  const { data: stats } = useStats(spaceId, input.range);
  const { data: totalStats } = useStats(spaceId);
  const {
    data: memData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isFetching,
  } = useMemories(spaceId, {
    q: input.q,
    memory_type: input.memoryTypeFilter,
    range: input.range,
    facet: input.facet,
  });
  const sourceQuery = useSourceMemories(spaceId);
  const createMutation = useCreateMemory(spaceId);
  const deleteMutation = useDeleteMemory(spaceId);
  const updateMutation = useUpdateMemory(spaceId);
  const exportMutation = useExportMemories(spaceId);
  const importMutation = useImportMemories(spaceId);
  const analysis = useSpaceAnalysis(spaceId, input.range);
  const farmEntryStatus = useMemoryFarmEntryState(
    spaceId,
    sourceQuery.isLoading || sourceQuery.isFetching,
    analysis.state,
    input.range,
  );
  const { data: topicData } = useTopicSummary(
    spaceId,
    input.range,
    features.enableTopicSummary && !features.enableAnalysis,
  );
  const { data: importTaskData } = useImportTasks(spaceId, input.importStatusOpen);

  const memories = memData?.pages.flatMap((page) => page.memories) ?? [];
  const firstPageSize = memData?.pages[0]?.memories.length ?? 0;
  const allMemories = sourceQuery.data ?? [];
  const rangeScopedMemories = useMemo(
    () => filterMemoriesForView(allMemories, { range: input.range }),
    [allMemories, input.range],
  );
  const rangeStats = useMemo(
    () => buildStats(rangeScopedMemories),
    [rangeScopedMemories],
  );
  const timelineScopedMemories = useMemo(
    () => filterMemoriesForView(rangeScopedMemories, { timeline: input.timelineSelection }),
    [input.timelineSelection, rangeScopedMemories],
  );
  const listFilterScopeMemories = useMemo(
    () =>
      filterMemoriesForView(timelineScopedMemories, {
        memoryType: input.memoryTypeFilter,
        facet: input.facet,
      }),
    [input.facet, input.memoryTypeFilter, timelineScopedMemories],
  );
  const { data: listSignalIndex } = useBackgroundDerivedSignals({
    memories: listFilterScopeMemories,
    matchMap: analysis.matchMap,
  });
  const listTagResolver = useMemo<MemoryTagResolver>(
    () => createTagResolver(listSignalIndex),
    [listSignalIndex],
  );
  const { data: analysisRangeSignalIndex } = useBackgroundDerivedSignals({
    memories: rangeScopedMemories,
    matchMap: analysis.matchMap,
  });
  const analysisTagStats = useMemo(
    () => analysisRangeSignalIndex.tagStats.map((stat) => ({
      value: stat.value,
      count: stat.count,
      origin: stat.origin,
    })),
    [analysisRangeSignalIndex],
  );
  const analysisCategoryScopeMemories = useMemo(() => {
    if (!input.analysisCategory) {
      return [];
    }

    const analysisCategory = input.analysisCategory;

    const categoryMemories = analysis.sourceMemories.filter((memory) =>
      analysis.matchMap.get(memory.id)?.categories.includes(analysisCategory),
    );

    return filterMemoriesForView(categoryMemories, {
      timeline: input.timelineSelection,
      memoryType: input.memoryTypeFilter,
      facet: input.facet,
    });
  }, [
    analysis.matchMap,
    analysis.sourceMemories,
    input.analysisCategory,
    input.facet,
    input.memoryTypeFilter,
    input.timelineSelection,
  ]);
  const { data: analysisCategorySignalIndex } = useBackgroundDerivedSignals({
    memories: analysisCategoryScopeMemories,
    matchMap: analysis.matchMap,
  });
  const analysisCategoryTagResolver = useMemo<MemoryTagResolver>(
    () => createTagResolver(analysisCategorySignalIndex),
    [analysisCategorySignalIndex],
  );
  const analysisFilteredMemories = useMemo(() => {
    if (!input.analysisCategory) return [];

    return filterMemoriesForView(
      analysisCategoryScopeMemories,
      {
        q: input.q,
        tag: input.tag,
        tagResolver: analysisCategoryTagResolver,
      },
    );
  }, [
    input.analysisCategory,
    analysisCategoryScopeMemories,
    analysisCategoryTagResolver,
    input.q,
    input.tag,
  ]);
  const tagFilteredMemories = useMemo(() => {
    if (input.analysisCategory || !input.tag) {
      return [];
    }

    return filterMemoriesForView(listFilterScopeMemories, {
      q: input.q,
      tag: input.tag,
      tagResolver: listTagResolver,
    });
  }, [
    input.analysisCategory,
    input.q,
    input.tag,
    listFilterScopeMemories,
    listTagResolver,
  ]);
  const timelineFilteredMemories = useMemo(() => {
    if (input.analysisCategory || input.tag || !input.timelineSelection) {
      return [];
    }

    return filterMemoriesForView(listFilterScopeMemories, {
      q: input.q,
      tagResolver: listTagResolver,
    });
  }, [
    input.analysisCategory,
    input.q,
    input.tag,
    input.timelineSelection,
    listFilterScopeMemories,
    listTagResolver,
  ]);
  const currentSignalScopeMemories = input.analysisCategory
    ? analysisCategoryScopeMemories
    : listFilterScopeMemories;
  const currentSignalIndex = input.analysisCategory
    ? analysisCategorySignalIndex
    : listSignalIndex;
  const currentTagResolver = input.analysisCategory
    ? analysisCategoryTagResolver
    : listTagResolver;
  const tagOptionMemories = useMemo(
    () =>
      filterMemoriesForView(currentSignalScopeMemories, {
        q: input.q,
        tagResolver: currentTagResolver,
      }),
    [currentSignalScopeMemories, currentTagResolver, input.q],
  );
  const displayedSelection = useMemo(
    () =>
      selectDisplayedMemories({
        analysisCategory: input.analysisCategory,
        tag: input.tag,
        timelineSelection: input.timelineSelection,
        memories,
        analysisFilteredMemories,
        tagFilteredMemories,
        timelineFilteredMemories,
        localVisibleCount: input.localVisibleCount,
      }),
    [
      analysisFilteredMemories,
      input.analysisCategory,
      input.localVisibleCount,
      input.tag,
      input.timelineSelection,
      memories,
      tagFilteredMemories,
      timelineFilteredMemories,
    ],
  );
  const sessionPreviewMemories = useMemo(() => {
    if (!input.selected) return displayedSelection.displayedMemories;

    const previewMemories = new Map(
      displayedSelection.displayedMemories.map((memory) => [memory.id, memory]),
    );
    previewMemories.set(input.selected.id, input.selected);
    return [...previewMemories.values()];
  }, [displayedSelection.displayedMemories, input.selected]);
  const sessionPreviewQuery = useSessionPreviewMessages(spaceId, sessionPreviewMemories);
  const sessionPreviewBySessionID = sessionPreviewQuery.data ?? {};
  const hasMoreMemories = displayedSelection.usingLocalFilteredList
    ? displayedSelection.baseDisplayedMemories.length > input.localVisibleCount
    : hasNextPage;
  const isMemoryLoading = displayedSelection.usingLocalFilteredList
    ? analysis.sourceLoading
    : isLoading || (isFetching && !isFetchingNextPage);
  const isFetchingMore = displayedSelection.usingLocalFilteredList ? false : isFetchingNextPage;
  const displayedFirstPageSize = displayedSelection.usingLocalFilteredList
    ? Math.min(displayedSelection.displayedMemories.length, 50)
    : firstPageSize;
  const tagOptions = useMemo<TagSummary[]>(
    () => buildTagOptions(tagOptionMemories, currentSignalIndex),
    [currentSignalIndex, tagOptionMemories],
  );
  const activeTagNormalized = input.tag ? normalizeTagSignal(input.tag) : null;
  const activeTagOrigin = useMemo(
    () => (input.tag ? getDerivedTagOrigin(input.tag, currentSignalIndex) : null),
    [currentSignalIndex, input.tag],
  );
  const showActiveDerivedTags = activeTagOrigin === "derived" && !!activeTagNormalized;
  const getActiveDerivedTags = (memory: Memory): string[] => {
    if (!showActiveDerivedTags || !activeTagNormalized) {
      return [];
    }

    return getDerivedTagsForMemory(memory, currentSignalIndex).filter(
      (derivedTag) => normalizeTagSignal(derivedTag) === activeTagNormalized,
    );
  };
  const selectedSessionID = input.selected
    ? getSessionPreviewLookupKey(input.selected)
    : "";
  const selectedSessionPreview = selectedSessionID
    ? (sessionPreviewBySessionID[selectedSessionID] ?? [])
    : [];
  const selectedSessionPreviewLoading = !!selectedSessionID &&
    selectedSessionPreview.length === 0 &&
    (sessionPreviewQuery.isLoading || sessionPreviewQuery.isFetching);

  useEffect(() => {
    if (isMemoryLoading || !input.selected) return;

    if (displayedSelection.baseDisplayedMemories.length === 0) {
      input.onSelectedMissing();
      return;
    }

    if (!displayedSelection.baseDisplayedMemories.some((memory) => memory.id === input.selected?.id)) {
      input.onSelectedMissing();
    }
  }, [
    displayedSelection.baseDisplayedMemories,
    input.onSelectedMissing,
    input.selected,
    isMemoryLoading,
  ]);

  return {
    stats,
    totalStats,
    rangeStats,
    pulseMemories: rangeScopedMemories,
    analysis,
    sourceQuery,
    farmEntryStatus,
    topicData,
    importTaskData,
    createMutation,
    deleteMutation,
    updateMutation,
    exportMutation,
    importMutation,
    memories,
    displayedMemories: displayedSelection.displayedMemories,
    baseDisplayedMemories: displayedSelection.baseDisplayedMemories,
    usingLocalFilteredList: displayedSelection.usingLocalFilteredList,
    hasMoreMemories,
    isMemoryLoading,
    isFetchingMore,
    displayedFirstPageSize,
    fetchNextPage,
    sessionPreviewBySessionID,
    selectedSessionPreview,
    selectedSessionPreviewLoading,
    tagOptions,
    analysisTagStats,
    activeTagNormalized,
    activeTagOrigin,
    getActiveDerivedTags,
  };
}
