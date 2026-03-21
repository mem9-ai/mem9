import { useEffect, useMemo, useState } from "react";
import { useNavigate, getRouteApi } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Search,
  BarChart3,
  Plus,
  LogOut,
  Download,
  Upload,
  X,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/theme-toggle";
import { LangToggle } from "@/components/lang-toggle";
import {
  getSessionPreviewLookupKey,
  useSessionPreviewMessages,
  useCreateMemory,
  useDeleteMemory,
  useUpdateMemory,
  useExportMemories,
  useImportMemories,
  useImportTasks,
} from "@/api/queries";
import { useSourceMemories } from "@/api/source-memories";
import { useSpaceAnalysis } from "@/api/analysis-queries";
import {
  filterMemoriesForView,
  type MemoryTagResolver,
} from "@/lib/memory-filters";
import {
  getCombinedTagsForMemory,
  getDerivedTagOrigin,
  getDerivedTagsForMemory,
  type LocalDerivedSignalIndex,
} from "@/lib/memory-derived-signals";
import { useBackgroundDerivedSignals } from "@/lib/memory-insight-background";
import { getActiveSpaceId, clearSpace, maskSpaceId } from "@/lib/session";
import { MemoryCard } from "@/components/space/memory-card";
import { DetailPanel } from "@/components/space/detail-panel";
import { EmptyState } from "@/components/space/empty-state";
import { AddMemoryDialog } from "@/components/space/add-dialog";
import { EditMemoryDialog } from "@/components/space/edit-dialog";
import { DeleteDialog } from "@/components/space/delete-dialog";
import { TimeRangeSelector } from "@/components/space/time-range";
import { TopicStrip } from "@/components/space/topic-strip";
import { TagStrip, type TagSummary } from "@/components/space/tag-strip";
import { AnalysisPanel } from "@/components/space/analysis-panel";
import { MemoryOverviewTabs } from "@/components/space/memory-overview-tabs";
import { MobileAnalysisSheet } from "@/components/space/mobile-analysis-sheet";
import { MobileDetailSheet } from "@/components/space/mobile-detail-sheet";
import { ExportDialog } from "@/components/space/export-dialog";
import { ImportDialog } from "@/components/space/import-dialog";
import { ImportStatusDialog } from "@/components/space/import-status";
import { features } from "@/config/features";
import { formatInsightCategoryLabel } from "@/lib/memory-insight";
import { normalizeTagSignal } from "@/lib/tag-signals";
import type {
  Memory,
  MemoryFacet,
  MemoryType,
  MemoryStats,
  TopicSummary,
} from "@/types/memory";
import type { AnalysisCategory } from "@/types/analysis";
import type {
  TimeRangePreset,
  TimelineSelection,
} from "@/types/time-range";
import { isValidTimelineSelection } from "@/types/time-range";
import type { OverviewMemorySelectionSource } from "@/components/space/memory-overview-tabs";

const route = getRouteApi("/space");
const LOCAL_PAGE_SIZE = 50;
const DESKTOP_BREAKPOINT = 1280;

function getIsDesktopViewport(): boolean {
  if (typeof window === "undefined") return true;
  return window.innerWidth >= DESKTOP_BREAKPOINT;
}

function useIsDesktopViewport(): boolean {
  const [isDesktop, setIsDesktop] = useState(getIsDesktopViewport);

  useEffect(() => {
    const handleResize = () => {
      setIsDesktop(getIsDesktopViewport());
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return isDesktop;
}

const FACETS: MemoryFacet[] = [
  "about_you",
  "preferences",
  "important_people",
  "experiences",
  "plans",
  "routines",
  "constraints",
  "other",
];

function formatAnalysisCategoryLabel(
  t: ReturnType<typeof useTranslation>["t"],
  category: AnalysisCategory,
): string {
  return formatInsightCategoryLabel(category, t);
}

function buildStats(memories: Memory[]): MemoryStats {
  return {
    total: memories.length,
    pinned: memories.filter((memory) => memory.memory_type === "pinned").length,
    insight: memories.filter((memory) => memory.memory_type === "insight").length,
  };
}

function buildTopicSummary(memories: Memory[]): TopicSummary {
  const counts = new Map<MemoryFacet, number>();

  for (const memory of memories) {
    const facet = memory.metadata?.facet;
    if (typeof facet !== "string" || !FACETS.includes(facet as MemoryFacet)) {
      continue;
    }
    counts.set(facet as MemoryFacet, (counts.get(facet as MemoryFacet) ?? 0) + 1);
  }

  return {
    topics: [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([facet, count]) => ({ facet, count })),
    total: memories.length,
  };
}

function createTagResolver(signalIndex: LocalDerivedSignalIndex): MemoryTagResolver {
  return (memory) => getCombinedTagsForMemory(memory, signalIndex);
}

function buildTagOptions(
  memories: Memory[],
  signalIndex: LocalDerivedSignalIndex,
): TagSummary[] {
  const counts = new Map<string, { tag: string; count: number; origin?: TagSummary["origin"] }>();

  for (const memory of memories) {
    for (const tag of getCombinedTagsForMemory(memory, signalIndex)) {
      const normalized = normalizeTagSignal(tag);
      if (!normalized) {
        continue;
      }

      const current = counts.get(normalized);
      if (current) {
        current.count += 1;
        continue;
      }

      counts.set(normalized, {
        tag,
        count: 1,
        origin: signalIndex.tagSourceByValue.get(normalized),
      });
    }
  }

  return [...counts.values()]
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.tag.localeCompare(right.tag, "en"),
    )
    .slice(0, 24);
}

function scrollToMemoryList(): void {
  const el = document.getElementById("memory-list");
  if (!el) return;

  const headerOffset = window.innerWidth >= 1280 ? 120 : 180;
  const y = el.getBoundingClientRect().top + window.scrollY - headerOffset;
  window.scrollTo({ top: y, behavior: "smooth" });
}

function formatTimelineLabel(
  selection: TimelineSelection,
  locale: string,
): string {
  const fromDate = new Date(selection.from);
  const toDate = new Date(selection.to);
  const duration = toDate.getTime() - fromDate.getTime();
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  });

  if (duration < 86_400_000) {
    const dateTimeFormatter = new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const timeFormatter = new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
    });
    const fromDay = dateFormatter.format(fromDate);
    const toDay = dateFormatter.format(toDate);

    return fromDay === toDay
      ? `${fromDay}, ${timeFormatter.format(fromDate)} - ${timeFormatter.format(toDate)}`
      : `${dateTimeFormatter.format(fromDate)} - ${dateTimeFormatter.format(toDate)}`;
  }

  const from = dateFormatter.format(fromDate);
  const to = dateFormatter.format(toDate);
  return from === to ? from : `${from} - ${to}`;
}

export function SpacePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = route.useSearch();
  const spaceId = getActiveSpaceId() ?? "";
  const isDesktopViewport = useIsDesktopViewport();

  // UI state
  const [selected, setSelected] = useState<Memory | null>(null);
  const [selectedDetailMode, setSelectedDetailMode] = useState<"panel" | "sheet">("panel");
  const [searchInput, setSearchInput] = useState(search.q ?? "");
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Memory | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Memory | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importStatusOpen, setImportStatusOpen] = useState(false);
  const [mobileAnalysisOpen, setMobileAnalysisOpen] = useState(false);
  const [localVisibleCount, setLocalVisibleCount] = useState(LOCAL_PAGE_SIZE);

  const range: TimeRangePreset = search.range ?? "all";
  const facet: MemoryFacet | undefined = search.facet;
  const analysisCategory: AnalysisCategory | undefined = search.analysisCategory;
  const tag = search.tag;
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
    if (!spaceId) navigate({ to: "/", replace: true });
  }, [spaceId, navigate]);

  useEffect(() => {
    setSearchInput(search.q ?? "");
  }, [search.q]);

  useEffect(() => {
    setLocalVisibleCount(LOCAL_PAGE_SIZE);
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
    setSelectedDetailMode(
      !isDesktopViewport || source === "insight" ? "sheet" : "panel",
    );
  };

  // Queries
  const sourceQuery = useSourceMemories(spaceId);
  const createMutation = useCreateMemory(spaceId);
  const deleteMutation = useDeleteMemory(spaceId);
  const updateMutation = useUpdateMemory(spaceId);
  const exportMutation = useExportMemories(spaceId);
  const importMutation = useImportMemories(spaceId);
  const analysis = useSpaceAnalysis(spaceId, range);
  const { data: importTaskData } = useImportTasks(spaceId, importStatusOpen);

  const allMemories = sourceQuery.data ?? [];
  const totalStats = useMemo(() => buildStats(allMemories), [allMemories]);
  const rangeScopedMemories = useMemo(
    () =>
      filterMemoriesForView(allMemories, {
        range,
      }),
    [allMemories, range],
  );
  const rangeStats = useMemo(
    () => buildStats(rangeScopedMemories),
    [rangeScopedMemories],
  );
  const timelineScopedMemories = useMemo(
    () =>
      filterMemoriesForView(rangeScopedMemories, {
        timeline: timelineSelection,
      }),
    [rangeScopedMemories, timelineSelection],
  );
  const stats = useMemo(
    () => buildStats(timelineScopedMemories),
    [timelineScopedMemories],
  );
  const listFilterScopeMemories = useMemo(
    () =>
      filterMemoriesForView(timelineScopedMemories, {
        memoryType: search.type,
        facet,
      }),
    [facet, search.type, timelineScopedMemories],
  );
  const { data: listSignalIndex } = useBackgroundDerivedSignals({
    memories: listFilterScopeMemories,
    matchMap: analysis.matchMap,
  });
  const listTagResolver = useMemo<MemoryTagResolver>(
    () => createTagResolver(listSignalIndex),
    [listSignalIndex],
  );
  const topicData = useMemo(
    () =>
      features.enableTopicSummary && !features.enableAnalysis
        ? buildTopicSummary(timelineScopedMemories)
        : undefined,
    [timelineScopedMemories],
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
    if (!analysisCategory) {
      return [];
    }

    const categoryMemories = analysis.sourceMemories.filter((memory) =>
      analysis.matchMap.get(memory.id)?.categories.includes(analysisCategory),
    );

    return filterMemoriesForView(categoryMemories, {
      timeline: timelineSelection,
      memoryType: search.type,
      facet,
    });
  }, [
    analysis.matchMap,
    analysis.sourceMemories,
    analysisCategory,
    facet,
    search.type,
    timelineSelection,
  ]);
  const { data: analysisCategorySignalIndex } = useBackgroundDerivedSignals({
    memories: analysisCategoryScopeMemories,
    matchMap: analysis.matchMap,
  });
  const analysisCategoryTagResolver = useMemo<MemoryTagResolver>(
    () => createTagResolver(analysisCategorySignalIndex),
    [analysisCategorySignalIndex],
  );
  const filteredMemories = useMemo(
    () =>
      filterMemoriesForView(listFilterScopeMemories, {
        q: search.q,
        tag,
        tagResolver: listTagResolver,
      }),
    [listFilterScopeMemories, listTagResolver, search.q, tag],
  );
  const analysisFilteredMemories = useMemo(() => {
    if (!analysisCategory) return [];

    return filterMemoriesForView(
      analysisCategoryScopeMemories,
      {
        q: search.q,
        tag,
        tagResolver: analysisCategoryTagResolver,
      },
    );
  }, [
    analysisCategory,
    analysisCategoryScopeMemories,
    analysisCategoryTagResolver,
    search.q,
    tag,
  ]);

  const usingLocalAnalysisList = !!analysisCategory;
  const baseDisplayedMemories = usingLocalAnalysisList
    ? analysisFilteredMemories
    : filteredMemories;
  const currentSignalScopeMemories = usingLocalAnalysisList
    ? analysisCategoryScopeMemories
    : listFilterScopeMemories;
  const currentSignalIndex = usingLocalAnalysisList
    ? analysisCategorySignalIndex
    : listSignalIndex;
  const currentTagResolver = usingLocalAnalysisList
    ? analysisCategoryTagResolver
    : listTagResolver;
  const tagOptionMemories = useMemo(
    () =>
      filterMemoriesForView(currentSignalScopeMemories, {
        q: search.q,
        tagResolver: currentTagResolver,
      }),
    [currentSignalScopeMemories, currentTagResolver, search.q],
  );
  const displayedMemories = baseDisplayedMemories.slice(0, localVisibleCount);
  const sessionPreviewMemories = useMemo(() => {
    if (!selected) return displayedMemories;

    const previewMemories = new Map(displayedMemories.map((memory) => [memory.id, memory]));
    previewMemories.set(selected.id, selected);
    return [...previewMemories.values()];
  }, [displayedMemories, selected]);
  const sessionPreviewQuery = useSessionPreviewMessages(spaceId, sessionPreviewMemories);
  const sessionPreviewBySessionID = sessionPreviewQuery.data ?? {};
  const hasMoreMemories = usingLocalAnalysisList
    ? baseDisplayedMemories.length > localVisibleCount
    : baseDisplayedMemories.length > localVisibleCount;
  const sourceLoading = sourceQuery.isLoading || sourceQuery.isFetching;
  const isMemoryLoading = usingLocalAnalysisList ? analysis.sourceLoading : sourceLoading;
  const displayedFirstPageSize = Math.min(displayedMemories.length, LOCAL_PAGE_SIZE);
  const tagOptions = useMemo<TagSummary[]>(() => {
    return buildTagOptions(tagOptionMemories, currentSignalIndex);
  }, [currentSignalIndex, tagOptionMemories]);
  const pulseMemories = rangeScopedMemories;
  const activeTagNormalized = tag ? normalizeTagSignal(tag) : null;
  const activeTagOrigin = useMemo(
    () =>
      tag
        ? getDerivedTagOrigin(tag, currentSignalIndex)
        : null,
    [currentSignalIndex, tag],
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
  const selectedSessionID = selected
    ? getSessionPreviewLookupKey(selected)
    : "";
  const selectedSessionPreview = selectedSessionID
    ? (sessionPreviewBySessionID[selectedSessionID] ?? [])
    : [];
  const selectedSessionPreviewLoading = !!selectedSessionID &&
    selectedSessionPreview.length === 0 &&
    (sessionPreviewQuery.isLoading || sessionPreviewQuery.isFetching);

  useEffect(() => {
    if (isMemoryLoading || !selected) return;

    if (baseDisplayedMemories.length === 0) {
      setSelected(null);
      return;
    }

    if (!baseDisplayedMemories.some((memory) => memory.id === selected.id)) {
      setSelected(null);
    }
  }, [baseDisplayedMemories, isMemoryLoading, selected]);

  if (!spaceId) return null;

  // Handlers
  function disconnect() {
    clearSpace();
    navigate({ to: "/", replace: true });
  }

  function handleSearch(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      navigate({
        to: "/space",
        search: { ...search, q: searchInput || undefined },
      });
    }
  }

  function handleTypeClick(clicked: MemoryType) {
    const next = search.type === clicked ? undefined : clicked;
    navigate({ to: "/space", search: { ...search, type: next } });
  }

  function handleRangeChange(preset: TimeRangePreset) {
    navigate({
      to: "/space",
      search: {
        ...search,
        range: preset === "all" ? undefined : preset,
        timelineFrom: undefined,
        timelineTo: undefined,
      },
    });
  }

  function handleTimelineSelect(selection: TimelineSelection) {
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
  }

  function handleTimelineClear() {
    navigate({
      to: "/space",
      search: {
        ...search,
        timelineFrom: undefined,
        timelineTo: undefined,
      },
    });
  }

  function handleFacetChange(f: MemoryFacet | undefined) {
    navigate({
      to: "/space",
      search: { ...search, facet: f, tag: undefined },
    });
  }

  function handleTagChange(nextTag: string | undefined) {
    navigate({
      to: "/space",
      search: { ...search, tag: nextTag },
    });
  }

  function handleAnalysisCategoryChange(
    category: AnalysisCategory | undefined,
  ) {
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
  }

  function handleMobileAnalysisCategoryChange(
    category: AnalysisCategory | undefined,
  ) {
    handleAnalysisCategoryChange(category);
    setMobileAnalysisOpen(false);
  }

  async function handleCreate(content: string, tagsStr: string) {
    const tags = tagsStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await createMutation.mutateAsync({
        content,
        tags: tags.length ? tags : undefined,
      });
      setAddOpen(false);
      toast.success(t("add.success"));
    } catch {
      toast.error(t("error.api"));
    }
  }

  async function handleEdit(mem: Memory, content: string, tagsStr: string) {
    const tags = tagsStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const updated = await updateMutation.mutateAsync({
        memoryId: mem.id,
        input: { content, tags },
        version: mem.version,
      });
      setEditTarget(null);
      if (selected?.id === mem.id) setSelected(updated);
      toast.success(t("edit.success"));
    } catch {
      toast.error(t("error.api"));
    }
  }

  async function handleDelete(mem: Memory) {
    try {
      await deleteMutation.mutateAsync(mem.id);
      setDeleteTarget(null);
      if (selected?.id === mem.id) setSelected(null);
      toast.success(t("delete.success"));
    } catch {
      toast.error(t("error.api"));
    }
  }

  async function handleExport() {
    try {
      const exportFile = await exportMutation.mutateAsync();
      const blob = new Blob([JSON.stringify(exportFile, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mem9-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("export.success"));
    } catch {
      toast.error(t("error.api"));
    }
  }

  async function handleImport(file: File) {
    try {
      await importMutation.mutateAsync(file);
      toast.success(t("import.success"));
    } catch {
      toast.error(t("error.api"));
      throw new Error("import failed");
    }
  }

  const isEmpty =
    !isMemoryLoading &&
    allMemories.length === 0 &&
    !search.q &&
    !tag &&
    !search.type &&
    !facet &&
    !analysisCategory &&
    !timelineSelection;
  const activeFilterCount =
    (search.type ? 1 : 0) +
    (facet ? 1 : 0) +
    (search.q ? 1 : 0) +
    (tag ? 1 : 0) +
    (analysisCategory ? 1 : 0) +
    (timelineSelection ? 1 : 0);
  const pageShellClass = features.enableAnalysis || selected
    ? "max-w-[1560px]"
    : "max-w-3xl";

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b bg-nav-bg backdrop-blur-sm">
        <div className={`mx-auto flex h-14 items-center justify-between px-6 ${pageShellClass}`}>
          <div className="flex items-center gap-3">
            <img
              src="/your-memory/mem9-logo.svg"
              alt="mem9"
              className="h-5 w-auto dark:invert"
            />
            <span className="hidden text-sm font-semibold text-foreground sm:inline">
              {t("space.title")}
            </span>
            <span className="rounded-md bg-secondary px-2 py-0.5 font-mono text-xs text-soft-foreground">
              {maskSpaceId(spaceId)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <LangToggle />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={disconnect}
              data-mp-event="Dashboard/Space/DisconnectClicked"
              data-mp-page-name="space"
              className="text-soft-foreground hover:text-destructive"
              title={t("space.disconnect")}
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className={`mx-auto px-6 ${pageShellClass}`}>
        <div className="flex flex-col gap-8 xl:flex-row">
          <div className="min-w-0 flex-1 py-8 xl:order-2">
            {/* Stats cards (clickable for type filtering) */}
            {sourceQuery.data && (
              <div
                style={{
                  animation: "slide-up 0.4s cubic-bezier(0.16,1,0.3,1)",
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="grid flex-1 grid-cols-3 gap-2">
                    <button
                      onClick={() =>
                        search.type
                          ? navigate({
                              to: "/space",
                              search: { ...search, type: undefined },
                            })
                          : undefined
                      }
                      data-mp-event="Dashboard/Space/TotalStatClicked"
                      data-mp-page-name="space"
                      className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
                        !search.type
                          ? "border-foreground/15 bg-foreground/[0.03]"
                          : "border-transparent hover:border-foreground/10"
                      }`}
                    >
                      <div className="text-xl font-bold tracking-tight text-foreground">
                        {stats.total}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {t("space.stats.total")}
                      </div>
                    </button>

                    <button
                      onClick={() => handleTypeClick("pinned")}
                      data-mp-event="Dashboard/Space/PinnedStatClicked"
                      data-mp-page-name="space"
                      data-mp-memory-type="pinned"
                      className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
                        search.type === "pinned"
                          ? "border-type-pinned/30 bg-type-pinned/5"
                          : "border-transparent hover:border-type-pinned/20"
                      }`}
                    >
                      <div className="flex items-baseline gap-1.5">
                        <span className="size-2 shrink-0 rounded-full bg-type-pinned" />
                        <span className="text-xl font-bold tracking-tight text-foreground">
                          {stats.pinned}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {t("space.stats.pinned")}
                      </div>
                      <div className="mt-0.5 text-[10px] leading-tight text-soft-foreground">
                        {t("legend.pinned")}
                      </div>
                    </button>

                    <button
                      onClick={() => handleTypeClick("insight")}
                      data-mp-event="Dashboard/Space/InsightStatClicked"
                      data-mp-page-name="space"
                      data-mp-memory-type="insight"
                      className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
                        search.type === "insight"
                          ? "border-type-insight/30 bg-type-insight/5"
                          : "border-transparent hover:border-type-insight/20"
                      }`}
                    >
                      <div className="flex items-baseline gap-1.5">
                        <span className="size-2 shrink-0 rounded-full bg-type-insight" />
                        <span className="text-xl font-bold tracking-tight text-foreground">
                          {stats.insight}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {t("space.stats.insight")}
                      </div>
                      <div className="mt-0.5 text-[10px] leading-tight text-soft-foreground">
                        {t("legend.insight")}
                      </div>
                    </button>
                  </div>
                  {features.enableTimeRange && !selected && (
                    <TimeRangeSelector
                      value={range}
                      onChange={handleRangeChange}
                      t={t}
                    />
                  )}
                </div>
              </div>
            )}

            <MemoryOverviewTabs
              stats={rangeStats}
              pulseMemories={pulseMemories}
              insightMemories={analysis.sourceMemories}
              cards={analysis.cards}
              snapshot={analysis.state.snapshot}
              range={range}
              loading={sourceLoading || analysis.sourceLoading}
              compact={selected !== null && isDesktopViewport}
              activeType={search.type}
              activeCategory={analysisCategory}
              activeTag={tag}
              selectedTimeline={timelineSelection}
              matchMap={analysis.matchMap}
              onTypeSelect={(t) => {
                handleTypeClick(t);
                setTimeout(() => {
                  scrollToMemoryList();
                }, 200);
              }}
              onTagSelect={(t) => {
                handleTagChange(t);
                setTimeout(() => {
                  scrollToMemoryList();
                }, 200);
              }}
              onMemorySelect={openMemoryDetail}
              onTimelineSelect={(selection) => {
                handleTimelineSelect(selection);
                setTimeout(() => {
                  scrollToMemoryList();
                }, 200);
              }}
              onTimelineClear={() => {
                handleTimelineClear();
              }}
            />

            {/* Search (full-width, prominent) */}
            <div className="relative mt-5">
              <Search className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-soft-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={handleSearch}
                placeholder={t("search.placeholder")}
                className="h-11 bg-popover pl-10 pr-9 text-sm placeholder:text-soft-foreground"
              />
              {searchInput && (
                <button
                  onClick={() => {
                    setSearchInput("");
                    navigate({
                      to: "/space",
                      search: { ...search, q: undefined },
                    });
                  }}
                  data-mp-event="Dashboard/Space/SearchClearClicked"
                  data-mp-page-name="space"
                  className="absolute top-1/2 right-3.5 -translate-y-1/2 text-soft-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>

            {/* Active filters indicator (right below search) */}
            {(search.type || facet || search.q || tag || analysisCategory || timelineSelection) && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{t("filter.active")}</span>
                {search.q && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-foreground">
                    &ldquo;{search.q}&rdquo;
                    <button
                      onClick={() => {
                        setSearchInput("");
                        navigate({
                          to: "/space",
                          search: { ...search, q: undefined },
                        });
                      }}
                      data-mp-event="Dashboard/Space/SearchFilterClearClicked"
                      data-mp-page-name="space"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                )}
                {search.type && (
                  <button
                    onClick={() =>
                      navigate({
                        to: "/space",
                        search: { ...search, type: undefined },
                      })
                    }
                    data-mp-event="Dashboard/Space/TypeFilterClearClicked"
                    data-mp-page-name="space"
                    data-mp-memory-type={search.type}
                    className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-foreground hover:bg-secondary/80"
                  >
                    {t(
                      search.type === "pinned"
                        ? "space.stats.pinned"
                        : "space.stats.insight",
                    )}
                    <X className="size-3" />
                  </button>
                )}
                {facet && (
                  <button
                    onClick={() => handleFacetChange(undefined)}
                    data-mp-event="Dashboard/Space/FacetFilterClearClicked"
                    data-mp-page-name="space"
                    data-mp-facet={facet}
                    className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-foreground hover:bg-secondary/80"
                  >
                    {t(`facet.${facet}`)}
                    <X className="size-3" />
                  </button>
                )}
                {tag && (
                  <button
                    onClick={() => handleTagChange(undefined)}
                    data-mp-event="Dashboard/Space/TagFilterClearClicked"
                    data-mp-page-name="space"
                    data-mp-tag={tag}
                    className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-foreground hover:bg-secondary/80"
                  >
                    #{tag}
                    <X className="size-3" />
                  </button>
                )}
                {timelineSelection && (
                  <button
                    onClick={() =>
                      navigate({
                        to: "/space",
                        search: {
                          ...search,
                          timelineFrom: undefined,
                          timelineTo: undefined,
                        },
                      })
                    }
                    data-mp-event="Dashboard/Space/TimelineFilterClearClicked"
                    data-mp-page-name="space"
                    className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-foreground hover:bg-secondary/80"
                  >
                    {timelineLabel}
                    <X className="size-3" />
                  </button>
                )}
                {analysisCategory && (
                  <button
                    onClick={() => handleAnalysisCategoryChange(undefined)}
                    data-mp-event="Dashboard/Space/AnalysisFilterClearClicked"
                    data-mp-page-name="space"
                    data-mp-category={analysisCategory}
                    className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-foreground hover:bg-secondary/80"
                  >
                    {formatAnalysisCategoryLabel(t, analysisCategory)}
                    <X className="size-3" />
                  </button>
                )}
                {activeFilterCount > 1 && (
                  <button
                    onClick={() => {
                      setSearchInput("");
                      navigate({
                        to: "/space",
                        search: {},
                      });
                    }}
                    data-mp-event="Dashboard/Space/ClearAllFiltersClicked"
                    data-mp-page-name="space"
                    className="text-primary/70 hover:text-primary hover:underline"
                  >
                    {t("filter.clear_all")}
                  </button>
                )}
              </div>
            )}

            {tagOptions.length > 0 && (
              <div className="mt-4">
                <TagStrip
                  tags={tagOptions}
                  activeTag={tag}
                  onSelect={handleTagChange}
                  t={t}
                />
              </div>
            )}

            {/* Topic Strip */}
            {features.enableTopicSummary &&
              !features.enableAnalysis &&
              topicData &&
              topicData.topics.length > 0 && (
                <div className="mt-4">
                  <TopicStrip
                    data={topicData}
                    activeFacet={facet}
                    onSelect={handleFacetChange}
                    t={t}
                  />
                </div>
              )}

            {/* Action Bar */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {!isDesktopViewport && features.enableAnalysis && (
                <Button
                  variant={analysisCategory ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setMobileAnalysisOpen(true)}
                  data-mp-event="Dashboard/Space/MobileAnalysisOpenClicked"
                  data-mp-page-name="space"
                  className="gap-1.5"
                >
                  <BarChart3 className="size-3.5" />
                  {t("analysis.open")}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExportOpen(true)}
                data-mp-event="Dashboard/Space/ExportOpenClicked"
                data-mp-page-name="space"
                className="gap-1.5"
              >
                <Download className="size-3.5" />
                {t("tools.export")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImportOpen(true)}
                data-mp-event="Dashboard/Space/ImportOpenClicked"
                data-mp-page-name="space"
                className="gap-1.5"
              >
                <Upload className="size-3.5" />
                {t("tools.import")}
              </Button>
              {features.enableManualAdd && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAddOpen(true)}
                  data-mp-event="Dashboard/Space/AddOpenClicked"
                  data-mp-page-name="space"
                  className="gap-1.5"
                >
                  <Plus className="size-3.5" />
                  {t("add.button")}
                </Button>
              )}
            </div>

            {/* Memory list */}
            <div id="memory-list" className="mt-4 scroll-mt-20">
              {isEmpty ? (
                <EmptyState t={t} onAdd={() => setAddOpen(true)} />
              ) : displayedMemories.length === 0 && !isMemoryLoading ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16">
                  <Search className="size-8 text-foreground/15" />
                  <p className="text-sm font-medium text-muted-foreground">
                    {t("search.no_results")}
                  </p>
                  <p className="text-xs text-soft-foreground">
                    {t("search.no_results_hint")}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {isMemoryLoading && (
                    <div className="flex items-center gap-2 rounded-xl bg-secondary/55 px-3 py-3 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      {t("list.loading")}
                    </div>
                  )}
                  {displayedMemories.map((m, i) => (
                    <MemoryCard
                      key={m.id}
                      memory={m}
                      derivedTags={getActiveDerivedTags(m)}
                      sessionPreview={
                        sessionPreviewBySessionID[getSessionPreviewLookupKey(m)] ?? []
                      }
                      isSelected={selected?.id === m.id}
                      onClick={() => openMemoryDetail(m, "list")}
                      onDelete={() => setDeleteTarget(m)}
                      t={t}
                      delay={i < displayedFirstPageSize ? i * 30 : 0}
                    />
                  ))}
                  {hasMoreMemories && (
                    <div className="py-4 text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setLocalVisibleCount((current) => current + LOCAL_PAGE_SIZE);
                        }}
                        data-mp-event="Dashboard/Space/LoadMoreClicked"
                        data-mp-page-name="space"
                        className="text-sm text-soft-foreground"
                      >
                        {t("list.load_more")}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>

          {features.enableAnalysis && isDesktopViewport && (
            <div className="py-8 xl:order-1 xl:py-8">
              <AnalysisPanel
                state={analysis.state}
                sourceCount={analysis.sourceCount}
                sourceLoading={analysis.sourceLoading}
                taxonomy={analysis.taxonomy}
                taxonomyUnavailable={analysis.taxonomyUnavailable}
                cards={analysis.cards}
                activeCategory={analysisCategory}
                activeTag={tag}
                tagStats={analysisTagStats}
                onSelectCategory={(c) => {
                  handleAnalysisCategoryChange(c);
                  setTimeout(() => {
                    const el = document.getElementById('memory-list');
                    if (el) {
                      const headerOffset = window.innerWidth >= 1280 ? 120 : 180;
                      const y = el.getBoundingClientRect().top + window.scrollY - headerOffset;
                      window.scrollTo({ top: y, behavior: 'smooth' });
                    }
                  }, 200);
                }}
                onSelectTag={(t) => {
                  handleTagChange(t);
                  setTimeout(() => {
                    const el = document.getElementById('memory-list');
                    if (el) {
                      const headerOffset = window.innerWidth >= 1280 ? 120 : 180;
                      const y = el.getBoundingClientRect().top + window.scrollY - headerOffset;
                      window.scrollTo({ top: y, behavior: 'smooth' });
                    }
                  }, 200);
                }}
                onRetry={analysis.retry}
                t={t}
              />
            </div>
          )}

          {/* Detail panel */}
          {selected && isDesktopViewport && selectedDetailMode === "panel" && (
            <DetailPanel
              key={selected.id}
              memory={selected}
              derivedTags={getActiveDerivedTags(selected)}
              sessionPreview={selectedSessionPreview}
              sessionPreviewLoading={selectedSessionPreviewLoading}
              onClose={() => setSelected(null)}
              onDelete={() => setDeleteTarget(selected)}
              onEdit={
                selected.memory_type === "pinned"
                  ? () => setEditTarget(selected)
                  : undefined
              }
              t={t}
            />
          )}
        </div>
      </div>

      {!isDesktopViewport && features.enableAnalysis && (
        <MobileAnalysisSheet
          open={mobileAnalysisOpen}
          onOpenChange={setMobileAnalysisOpen}
          state={analysis.state}
          sourceCount={analysis.sourceCount}
          sourceLoading={analysis.sourceLoading}
          taxonomy={analysis.taxonomy}
          taxonomyUnavailable={analysis.taxonomyUnavailable}
          cards={analysis.cards}
          activeCategory={analysisCategory}
          activeTag={tag}
          tagStats={analysisTagStats}
          onSelectCategory={(c) => {
            handleMobileAnalysisCategoryChange(c);
            setTimeout(() => {
              const el = document.getElementById('memory-list');
              if (el) {
                const headerOffset = window.innerWidth >= 1280 ? 120 : 180;
                const y = el.getBoundingClientRect().top + window.scrollY - headerOffset;
                window.scrollTo({ top: y, behavior: 'smooth' });
              }
            }, 200);
          }}
          onSelectTag={(t) => {
            handleTagChange(t);
            setMobileAnalysisOpen(false);
            setTimeout(() => {
              const el = document.getElementById('memory-list');
              if (el) {
                const headerOffset = window.innerWidth >= 1280 ? 120 : 180;
                const y = el.getBoundingClientRect().top + window.scrollY - headerOffset;
                window.scrollTo({ top: y, behavior: 'smooth' });
              }
            }, 200);
          }}
          onRetry={analysis.retry}
          t={t}
        />
      )}

      {(selected && (!isDesktopViewport || selectedDetailMode === "sheet")) && (
        <MobileDetailSheet
          memory={selected}
          derivedTags={selected ? getActiveDerivedTags(selected) : []}
          sessionPreview={selectedSessionPreview}
          sessionPreviewLoading={selectedSessionPreviewLoading}
          open={!!selected}
          onOpenChange={(open) => !open && setSelected(null)}
          onDelete={() => {
            if (!selected) return;
            setDeleteTarget(selected);
            setSelected(null);
          }}
          onEdit={
            selected?.memory_type === "pinned"
              ? () => {
                  setEditTarget(selected);
                  setSelected(null);
                }
              : undefined
          }
          t={t}
        />
      )}

      {/* Dialogs */}
      {features.enableManualAdd && (
        <AddMemoryDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          onSave={handleCreate}
          loading={createMutation.isPending}
          t={t}
        />
      )}
      {editTarget && (
        <EditMemoryDialog
          memory={editTarget}
          open={!!editTarget}
          onOpenChange={(open) => !open && setEditTarget(null)}
          onSave={(content, tags) => handleEdit(editTarget, content, tags)}
          loading={updateMutation.isPending}
          t={t}
        />
      )}
      {deleteTarget && (
        <DeleteDialog
          memory={deleteTarget}
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          onConfirm={() => handleDelete(deleteTarget)}
          loading={deleteMutation.isPending}
          t={t}
        />
      )}
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        onExport={handleExport}
        stats={totalStats}
        loading={exportMutation.isPending}
        t={t}
      />
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={handleImport}
        onViewHistory={() => setImportStatusOpen(true)}
        loading={importMutation.isPending}
        t={t}
      />
      <ImportStatusDialog
        open={importStatusOpen}
        onOpenChange={setImportStatusOpen}
        tasks={importTaskData?.tasks ?? []}
        t={t}
      />
    </div>
  );
}
