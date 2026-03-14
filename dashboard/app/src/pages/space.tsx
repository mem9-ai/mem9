import { useEffect, useMemo, useState } from "react";
import { useNavigate, getRouteApi } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Search,
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
  useStats,
  useMemories,
  useCreateMemory,
  useDeleteMemory,
  useUpdateMemory,
  useExportMemories,
  useImportMemories,
  useImportTasks,
  useTopicSummary,
} from "@/api/queries";
import { useSpaceAnalysis } from "@/api/analysis-queries";
import { filterMemoriesForView } from "@/lib/memory-filters";
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
import { ExportDialog } from "@/components/space/export-dialog";
import { ImportDialog } from "@/components/space/import-dialog";
import { ImportStatusDialog } from "@/components/space/import-status";
import { features } from "@/config/features";
import type { Memory, MemoryType, MemoryFacet } from "@/types/memory";
import type { AnalysisCategory } from "@/types/analysis";
import type { TimeRangePreset } from "@/types/time-range";

const route = getRouteApi("/space");
const LOCAL_PAGE_SIZE = 50;

export function SpacePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = route.useSearch();
  const spaceId = getActiveSpaceId() ?? "";

  // UI state
  const [selected, setSelected] = useState<Memory | null>(null);
  const [searchInput, setSearchInput] = useState(search.q ?? "");
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Memory | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Memory | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importStatusOpen, setImportStatusOpen] = useState(false);
  const [localVisibleCount, setLocalVisibleCount] = useState(LOCAL_PAGE_SIZE);

  const range: TimeRangePreset = search.range ?? "all";
  const facet: MemoryFacet | undefined = search.facet;
  const analysisCategory: AnalysisCategory | undefined = search.analysisCategory;
  const tag = search.tag;

  useEffect(() => {
    if (!spaceId) navigate({ to: "/", replace: true });
  }, [spaceId, navigate]);

  useEffect(() => {
    setSearchInput(search.q ?? "");
  }, [search.q]);

  useEffect(() => {
    setLocalVisibleCount(LOCAL_PAGE_SIZE);
  }, [analysisCategory, range, search.q, search.type, spaceId]);

  // Queries
  const { data: stats } = useStats(spaceId, range);
  const { data: totalStats } = useStats(spaceId);
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useMemories(spaceId, {
      q: search.q,
      tag,
      memory_type: search.type,
      range,
      facet,
    });
  const createMutation = useCreateMemory(spaceId);
  const deleteMutation = useDeleteMemory(spaceId);
  const updateMutation = useUpdateMemory(spaceId);
  const exportMutation = useExportMemories(spaceId);
  const importMutation = useImportMemories(spaceId);
  const analysis = useSpaceAnalysis(spaceId, range);
  const { data: topicData } = useTopicSummary(
    spaceId,
    range,
    features.enableTopicSummary && !features.enableAnalysis,
  );
  const { data: importTaskData } = useImportTasks(spaceId, importStatusOpen);

  const memories = data?.pages.flatMap((p) => p.memories) ?? [];
  const firstPageSize = data?.pages[0]?.memories.length ?? 0;
  const analysisFilteredMemories = useMemo(() => {
    if (!analysisCategory) return [];

    return filterMemoriesForView(
      analysis.sourceMemories.filter((memory) =>
        analysis.matchMap.get(memory.id)?.categories.includes(analysisCategory),
      ),
      {
        q: search.q,
        memoryType: search.type,
        range,
      },
    );
  }, [
    analysis.matchMap,
    analysis.sourceMemories,
    analysisCategory,
    range,
    search.q,
    search.type,
  ]);
  const tagFilteredAnalysisMemories = useMemo(
    () =>
      filterMemoriesForView(analysisFilteredMemories, {
        tag,
      }),
    [analysisFilteredMemories, tag],
  );

  const usingLocalAnalysisList = !!analysisCategory;
  const displayedMemories = usingLocalAnalysisList
    ? tagFilteredAnalysisMemories.slice(0, localVisibleCount)
    : memories;
  const hasMoreMemories = usingLocalAnalysisList
    ? tagFilteredAnalysisMemories.length > localVisibleCount
    : hasNextPage;
  const isMemoryLoading = usingLocalAnalysisList
    ? analysis.sourceLoading
    : isLoading;
  const isFetchingMore = usingLocalAnalysisList ? false : isFetchingNextPage;
  const displayedFirstPageSize = usingLocalAnalysisList
    ? Math.min(displayedMemories.length, LOCAL_PAGE_SIZE)
    : firstPageSize;
  const tagOptions = useMemo<TagSummary[]>(() => {
    const source = usingLocalAnalysisList ? analysisFilteredMemories : displayedMemories;
    const counts = new Map<string, number>();

    for (const memory of source) {
      for (const memoryTag of memory.tags) {
        const normalized = memoryTag.trim();
        if (!normalized) continue;
        counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "en"))
      .slice(0, 24)
      .map(([value, count]) => ({
        tag: value,
        count,
      }));
  }, [analysisFilteredMemories, displayedMemories, usingLocalAnalysisList]);

  useEffect(() => {
    if (!usingLocalAnalysisList || isMemoryLoading) return;

    if (displayedMemories.length === 0) {
      setSelected(null);
      return;
    }

    if (
      !selected ||
      !displayedMemories.some((memory) => memory.id === selected.id)
    ) {
      setSelected(displayedMemories[0] ?? null);
    }
  }, [
    displayedMemories,
    isMemoryLoading,
    selected,
    usingLocalAnalysisList,
  ]);

  useEffect(() => {
    if (isMemoryLoading || !selected) return;

    if (displayedMemories.length === 0) {
      setSelected(null);
      return;
    }

    if (!displayedMemories.some((memory) => memory.id === selected.id)) {
      setSelected(displayedMemories[0] ?? null);
    }
  }, [displayedMemories, isMemoryLoading, selected]);

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
      search: { ...search, range: preset === "all" ? undefined : preset },
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
    displayedMemories.length === 0 &&
    !search.q &&
    !tag &&
    !search.type &&
    !facet &&
    !analysisCategory;
  const activeFilterCount =
    (search.type ? 1 : 0) +
    (facet ? 1 : 0) +
    (search.q ? 1 : 0) +
    (tag ? 1 : 0) +
    (analysisCategory ? 1 : 0);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b bg-nav-bg backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-[1180px] items-center justify-between px-6">
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
              className="text-soft-foreground hover:text-destructive"
              title={t("space.disconnect")}
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div
        className={`mx-auto px-6 ${
          features.enableAnalysis || selected
            ? "max-w-[1560px]"
            : "max-w-3xl"
        }`}
      >
        <div className="flex flex-col gap-8 xl:flex-row">
          <div className="min-w-0 flex-1 py-8">
            {/* Stats cards (clickable for type filtering) */}
            {stats && (
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
                  className="absolute top-1/2 right-3.5 -translate-y-1/2 text-soft-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>

            {/* Active filters indicator (right below search) */}
            {(search.type || facet || search.q || tag || analysisCategory) && (
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
                    className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-foreground hover:bg-secondary/80"
                  >
                    {t(`facet.${facet}`)}
                    <X className="size-3" />
                  </button>
                )}
                {tag && (
                  <button
                    onClick={() => handleTagChange(undefined)}
                    className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-foreground hover:bg-secondary/80"
                  >
                    #{tag}
                    <X className="size-3" />
                  </button>
                )}
                {analysisCategory && (
                  <button
                    onClick={() => handleAnalysisCategoryChange(undefined)}
                    className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-foreground hover:bg-secondary/80"
                  >
                    {t(`analysis.category.${analysisCategory}`)}
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExportOpen(true)}
                className="gap-1.5"
              >
                <Download className="size-3.5" />
                {t("tools.export")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImportOpen(true)}
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
                  className="gap-1.5"
                >
                  <Plus className="size-3.5" />
                  {t("add.button")}
                </Button>
              )}
            </div>

            {/* Memory list */}
            <div className="mt-4">
              {isEmpty ? (
                <EmptyState t={t} onAdd={() => setAddOpen(true)} />
              ) : isMemoryLoading ? (
                <div className="flex h-40 items-center justify-center">
                  <Loader2 className="size-5 animate-spin text-soft-foreground" />
                </div>
              ) : displayedMemories.length === 0 ? (
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
                  {displayedMemories.map((m, i) => (
                    <MemoryCard
                      key={m.id}
                      memory={m}
                      isSelected={selected?.id === m.id}
                      onClick={() => setSelected(m)}
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
                          if (usingLocalAnalysisList) {
                            setLocalVisibleCount((current) => current + LOCAL_PAGE_SIZE);
                            return;
                          }
                          fetchNextPage();
                        }}
                        disabled={isFetchingMore}
                        className="text-sm text-soft-foreground"
                      >
                        {isFetchingMore && (
                          <Loader2 className="size-4 animate-spin" />
                        )}
                        {t("list.load_more")}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            
          </div>

          {features.enableAnalysis && (
            <div className="py-8 xl:py-8">
              <AnalysisPanel
                state={analysis.state}
                sourceCount={analysis.sourceCount}
                sourceLoading={analysis.sourceLoading}
                taxonomy={analysis.taxonomy}
                taxonomyUnavailable={analysis.taxonomyUnavailable}
                cards={analysis.cards}
                activeCategory={analysisCategory}
                onSelectCategory={handleAnalysisCategoryChange}
                onRetry={analysis.retry}
                t={t}
              />
            </div>
          )}

          {/* Detail panel */}
          {selected && (
            <DetailPanel
              key={selected.id}
              memory={selected}
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
