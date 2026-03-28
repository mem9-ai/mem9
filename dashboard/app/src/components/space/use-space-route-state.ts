import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { clearSpace } from "@/lib/session";
import type {
  Memory,
  MemoryFacet,
  MemoryType,
  MemoryTypeFilter,
} from "@/types/memory";
import type {
  TimeRangePreset,
  TimelineSelection,
} from "@/types/time-range";
import { isValidTimelineSelection } from "@/types/time-range";
import type { AnalysisCategory } from "@/types/analysis";
import type { OverviewMemorySelectionSource } from "./memory-overview-tabs";
import {
  formatTimelineLabel,
  resolveSelectedDetailMode,
} from "./space-selectors";
import { useIsDesktopViewport } from "./space-view-utils";

const route = getRouteApi("/space");

export type SpaceSearch = ReturnType<typeof route.useSearch>;

export interface SpaceRouteState {
  search: SpaceSearch;
  isDesktopViewport: boolean;
  selected: Memory | null;
  selectedDetailMode: "panel" | "sheet";
  searchInput: string;
  mobileAnalysisOpen: boolean;
  localVisibleCount: number;
  range: TimeRangePreset;
  facet: MemoryFacet | undefined;
  analysisCategory: AnalysisCategory | undefined;
  tag: string | undefined;
  memoryTypeFilter: MemoryTypeFilter;
  timelineSelection: TimelineSelection | undefined;
  timelineLabel: string;
  setSelected: (value: Memory | null) => void;
  setSelectedDetailMode: (value: "panel" | "sheet") => void;
  setSearchInput: (value: string) => void;
  setMobileAnalysisOpen: (value: boolean) => void;
  setLocalVisibleCount: (value: number | ((current: number) => number)) => void;
  disconnect: () => void;
  openMemoryDetail: (
    memory: Memory,
    source?: OverviewMemorySelectionSource,
  ) => void;
  handleSearch: (event: KeyboardEvent<HTMLInputElement>) => void;
  clearTypeFilter: () => void;
  clearSearch: () => void;
  clearAllFilters: () => void;
  handleTypeClick: (clicked: MemoryType) => void;
  handleRangeChange: (preset: TimeRangePreset) => void;
  handleTimelineSelect: (selection: TimelineSelection) => void;
  handleTimelineClear: () => void;
  handleFacetChange: (facet: MemoryFacet | undefined) => void;
  handleTagChange: (nextTag: string | undefined) => void;
  handleAnalysisCategoryChange: (
    category: AnalysisCategory | undefined,
  ) => void;
  handleMobileAnalysisCategoryChange: (
    category: AnalysisCategory | undefined,
  ) => void;
  handleEntitySearch: (query: string) => void;
}

export function useSpaceRouteState(spaceId: string): SpaceRouteState {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const search = route.useSearch();
  const isDesktopViewport = useIsDesktopViewport();
  const [selected, setSelected] = useState<Memory | null>(null);
  const [selectedDetailMode, setSelectedDetailMode] = useState<"panel" | "sheet">("panel");
  const [searchInput, setSearchInput] = useState(search.q ?? "");
  const [mobileAnalysisOpen, setMobileAnalysisOpen] = useState(false);
  const [localVisibleCount, setLocalVisibleCount] = useState(50);

  const range: TimeRangePreset = search.range ?? "all";
  const facet: MemoryFacet | undefined = search.facet;
  const analysisCategory: AnalysisCategory | undefined = search.analysisCategory;
  const tag = search.tag;
  const memoryTypeFilter: MemoryTypeFilter = search.type ?? "pinned,insight";
  const timelineSelection = useMemo(() => {
    const selection = search.timelineFrom && search.timelineTo
      ? {
          from: search.timelineFrom,
          to: search.timelineTo,
        }
      : null;

    return isValidTimelineSelection(selection) ? selection : undefined;
  }, [search.timelineFrom, search.timelineTo]);
  const timelineLabel = useMemo(
    () =>
      timelineSelection
        ? formatTimelineLabel(timelineSelection, i18n.language)
        : "",
    [i18n.language, timelineSelection],
  );

  useEffect(() => {
    if (!spaceId) {
      navigate({ to: "/", replace: true });
    }
  }, [navigate, spaceId]);

  useEffect(() => {
    setSearchInput(search.q ?? "");
  }, [search.q]);

  useEffect(() => {
    setLocalVisibleCount(50);
  }, [
    analysisCategory,
    facet,
    range,
    search.q,
    search.type,
    spaceId,
    tag,
    timelineSelection,
  ]);

  useEffect(() => {
    if (isDesktopViewport) {
      setMobileAnalysisOpen(false);
    }
  }, [isDesktopViewport]);

  useEffect(() => {
    if (!selected) {
      setSelectedDetailMode("panel");
    }
  }, [selected]);

  const openMemoryDetail = (
    memory: Memory,
    source: OverviewMemorySelectionSource = "list",
  ) => {
    setSelected(memory);
    setSelectedDetailMode(resolveSelectedDetailMode(isDesktopViewport, source));
  };

  const disconnect = () => {
    clearSpace();
    navigate({ to: "/", replace: true });
  };

  const handleSearch = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      navigate({
        to: "/space",
        search: { ...search, q: searchInput || undefined },
      });
    }
  };

  const clearTypeFilter = () => {
    navigate({
      to: "/space",
      search: { ...search, type: undefined },
    });
  };

  const clearSearch = () => {
    setSearchInput("");
    navigate({
      to: "/space",
      search: { ...search, q: undefined },
    });
  };

  const clearAllFilters = () => {
    setSearchInput("");
    navigate({
      to: "/space",
      search: {},
    });
  };

  const handleTypeClick = (clicked: MemoryType) => {
    const next = search.type === clicked ? undefined : clicked;
    navigate({ to: "/space", search: { ...search, type: next } });
  };

  const handleRangeChange = (preset: TimeRangePreset) => {
    navigate({
      to: "/space",
      search: {
        ...search,
        range: preset === "all" ? undefined : preset,
        timelineFrom: undefined,
        timelineTo: undefined,
      },
    });
  };

  const handleTimelineSelect = (selection: TimelineSelection) => {
    const isSameSelection =
      timelineSelection?.from === selection.from &&
      timelineSelection?.to === selection.to;

    navigate({
      to: "/space",
      search: {
        ...search,
        timelineFrom: isSameSelection ? undefined : selection.from,
        timelineTo: isSameSelection ? undefined : selection.to,
      },
    });
  };

  const handleTimelineClear = () => {
    navigate({
      to: "/space",
      search: {
        ...search,
        timelineFrom: undefined,
        timelineTo: undefined,
      },
    });
  };

  const handleFacetChange = (nextFacet: MemoryFacet | undefined) => {
    navigate({
      to: "/space",
      search: { ...search, facet: nextFacet, tag: undefined },
    });
  };

  const handleTagChange = (nextTag: string | undefined) => {
    navigate({
      to: "/space",
      search: { ...search, tag: nextTag },
    });
  };

  const handleAnalysisCategoryChange = (
    category: AnalysisCategory | undefined,
  ) => {
    const nextCategory =
      analysisCategory === category ? undefined : category;

    if (nextCategory) {
      setSearchInput("");
    }

    navigate({
      to: "/space",
      search: {
        ...search,
        analysisCategory: nextCategory,
        q: nextCategory ? undefined : search.q,
      },
    });
  };

  const handleMobileAnalysisCategoryChange = (
    category: AnalysisCategory | undefined,
  ) => {
    handleAnalysisCategoryChange(category);
    setMobileAnalysisOpen(false);
  };

  const handleEntitySearch = (query: string) => {
    setSearchInput(query);
    navigate({
      to: "/space",
      search: { ...search, q: query },
    });
  };

  return {
    search,
    isDesktopViewport,
    selected,
    selectedDetailMode,
    searchInput,
    mobileAnalysisOpen,
    localVisibleCount,
    range,
    facet,
    analysisCategory,
    tag,
    memoryTypeFilter,
    timelineSelection,
    timelineLabel,
    setSelected,
    setSelectedDetailMode,
    setSearchInput,
    setMobileAnalysisOpen,
    setLocalVisibleCount,
    disconnect,
    openMemoryDetail,
    handleSearch,
    clearTypeFilter,
    clearSearch,
    clearAllFilters,
    handleTypeClick,
    handleRangeChange,
    handleTimelineSelect,
    handleTimelineClear,
    handleFacetChange,
    handleTagChange,
    handleAnalysisCategoryChange,
    handleMobileAnalysisCategoryChange,
    handleEntitySearch,
  };
}
