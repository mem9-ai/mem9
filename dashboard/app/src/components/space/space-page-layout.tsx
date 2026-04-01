import type { Dispatch, SetStateAction } from "react";
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
import type { TFunction } from "i18next";
import { getSessionPreviewLookupKey } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/theme-toggle";
import { LangToggle } from "@/components/lang-toggle";
import { MemoryCard } from "@/components/space/memory-card";
import { DetailPanel } from "@/components/space/detail-panel";
import { EmptyState } from "@/components/space/empty-state";
import { AddMemoryDialog } from "@/components/space/add-dialog";
import { EditMemoryDialog } from "@/components/space/edit-dialog";
import { DeleteDialog } from "@/components/space/delete-dialog";
import { TimeRangeSelector } from "@/components/space/time-range";
import { TopicStrip } from "@/components/space/topic-strip";
import { TagStrip } from "@/components/space/tag-strip";
import { AnalysisPanel } from "@/components/space/analysis-panel";
import { MemoryOverviewTabs } from "@/components/space/memory-overview-tabs";
import { MobileAnalysisSheet } from "@/components/space/mobile-analysis-sheet";
import { MobileDetailSheet } from "@/components/space/mobile-detail-sheet";
import { ExportDialog } from "@/components/space/export-dialog";
import { ImportDialog } from "@/components/space/import-dialog";
import { ImportStatusDialog } from "@/components/space/import-status";
import { MemoryFarmPromoCard } from "@/components/space/memory-farm-promo-card";
import { MemoryFarmPreparationDialog } from "@/components/space/memory-farm-preparation-dialog";
import { features } from "@/config/features";
import { maskSpaceId } from "@/lib/session";
import type { Memory } from "@/types/memory";
import type { SpaceRouteState } from "./use-space-route-state";
import type { SpaceDataModel } from "./use-space-data-model";
import {
  formatAnalysisCategoryLabel,
  getActiveFilterCount,
  getPageShellClass,
} from "./space-selectors";
import { navigateAndScrollToMemoryList } from "./space-view-utils";

interface SpacePageLayoutProps {
  spaceId: string;
  routeState: SpaceRouteState;
  dataModel: SpaceDataModel;
  t: TFunction;
  canOpenFarmInNewTab: boolean;
  addOpen: boolean;
  setAddOpen: Dispatch<SetStateAction<boolean>>;
  editTarget: Memory | null;
  setEditTarget: Dispatch<SetStateAction<Memory | null>>;
  deleteTarget: Memory | null;
  setDeleteTarget: Dispatch<SetStateAction<Memory | null>>;
  exportOpen: boolean;
  setExportOpen: Dispatch<SetStateAction<boolean>>;
  importOpen: boolean;
  setImportOpen: Dispatch<SetStateAction<boolean>>;
  importStatusOpen: boolean;
  setImportStatusOpen: Dispatch<SetStateAction<boolean>>;
  farmPrepOpen: boolean;
  setFarmPrepOpen: Dispatch<SetStateAction<boolean>>;
  refreshingMemories: boolean;
  onHandleCreate: (content: string, tags: string) => Promise<void>;
  onHandleEdit: (memory: Memory, content: string, tags: string) => Promise<void>;
  onHandleDelete: (memory: Memory) => Promise<void>;
  onHandleExport: () => Promise<void>;
  onHandleImport: (file: File) => Promise<void>;
  onRefreshMemories: () => Promise<void>;
  onHandleFarmAction: () => void;
}

export function SpacePageLayout({
  spaceId,
  routeState,
  dataModel,
  t,
  canOpenFarmInNewTab,
  addOpen,
  setAddOpen,
  editTarget,
  setEditTarget,
  deleteTarget,
  setDeleteTarget,
  exportOpen,
  setExportOpen,
  importOpen,
  setImportOpen,
  importStatusOpen,
  setImportStatusOpen,
  farmPrepOpen,
  setFarmPrepOpen,
  refreshingMemories,
  onHandleCreate,
  onHandleEdit,
  onHandleDelete,
  onHandleExport,
  onHandleImport,
  onRefreshMemories,
  onHandleFarmAction,
}: SpacePageLayoutProps) {
  const isEmpty =
    !dataModel.isMemoryLoading &&
    dataModel.displayedMemories.length === 0 &&
    !routeState.search.q &&
    !routeState.tag &&
    !routeState.search.type &&
    !routeState.facet &&
    !routeState.analysisCategory &&
    !routeState.timelineSelection;
  const activeFilterCount = getActiveFilterCount({
    type: routeState.search.type,
    facet: routeState.facet,
    q: routeState.search.q,
    tag: routeState.tag,
    analysisCategory: routeState.analysisCategory,
    hasTimelineSelection: !!routeState.timelineSelection,
  });
  const pageShellClass = getPageShellClass(
    features.enableAnalysis,
    routeState.selected !== null,
  );

  return (
    <div className="min-h-screen">
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
              onClick={routeState.disconnect}
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

      <div className={`mx-auto px-6 ${pageShellClass}`}>
        <div className="flex flex-col gap-8 xl:flex-row">
          <div className="min-w-0 flex-1 py-8 xl:order-2">
            {dataModel.stats && (
              <div
                style={{
                  animation: "slide-up 0.4s cubic-bezier(0.16,1,0.3,1)",
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="grid flex-1 grid-cols-3 gap-2">
                    <button
                      onClick={() =>
                        routeState.search.type
                          ? routeState.clearTypeFilter()
                          : undefined
                      }
                      data-mp-event="Dashboard/Space/TotalStatClicked"
                      data-mp-page-name="space"
                      className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
                        !routeState.search.type
                          ? "border-foreground/15 bg-foreground/[0.03]"
                          : "border-transparent hover:border-foreground/10"
                      }`}
                    >
                      <div className="text-xl font-bold tracking-tight text-foreground">
                        {dataModel.stats.total}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {t("space.stats.total")}
                      </div>
                    </button>

                    <button
                      onClick={() => routeState.handleTypeClick("pinned")}
                      data-mp-event="Dashboard/Space/PinnedStatClicked"
                      data-mp-page-name="space"
                      data-mp-memory-type="pinned"
                      className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
                        routeState.search.type === "pinned"
                          ? "border-type-pinned/30 bg-type-pinned/5"
                          : "border-transparent hover:border-type-pinned/20"
                      }`}
                    >
                      <div className="flex items-baseline gap-1.5">
                        <span className="size-2 shrink-0 rounded-full bg-type-pinned" />
                        <span className="text-xl font-bold tracking-tight text-foreground">
                          {dataModel.stats.pinned}
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
                      onClick={() => routeState.handleTypeClick("insight")}
                      data-mp-event="Dashboard/Space/InsightStatClicked"
                      data-mp-page-name="space"
                      data-mp-memory-type="insight"
                      className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
                        routeState.search.type === "insight"
                          ? "border-type-insight/30 bg-type-insight/5"
                          : "border-transparent hover:border-type-insight/20"
                      }`}
                    >
                      <div className="flex items-baseline gap-1.5">
                        <span className="size-2 shrink-0 rounded-full bg-type-insight" />
                        <span className="text-xl font-bold tracking-tight text-foreground">
                          {dataModel.stats.insight}
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
                  {features.enableTimeRange && !routeState.selected && (
                    <TimeRangeSelector
                      value={routeState.range}
                      onChange={routeState.handleRangeChange}
                      t={t}
                    />
                  )}
                </div>
              </div>
            )}

            <MemoryOverviewTabs
              spaceId={spaceId}
              stats={dataModel.stats}
              pulseMemories={dataModel.pulseMemories}
              insightMemories={dataModel.analysis.sourceMemories}
              cards={dataModel.analysis.cards}
              snapshot={dataModel.analysis.state.snapshot}
              range={routeState.range}
              loading={!dataModel.stats || dataModel.analysis.sourceLoading}
              compact={routeState.selected !== null && routeState.isDesktopViewport}
              activeType={routeState.search.type}
              activeCategory={routeState.analysisCategory}
              activeTag={routeState.tag}
              selectedTimeline={routeState.timelineSelection}
              matchMap={dataModel.analysis.matchMap}
              onTypeSelect={(type) =>
                navigateAndScrollToMemoryList(() => routeState.handleTypeClick(type))
              }
              onTagSelect={(tag) =>
                navigateAndScrollToMemoryList(() => routeState.handleTagChange(tag))
              }
              onMemorySelect={routeState.openMemoryDetail}
              onTimelineSelect={(selection) =>
                navigateAndScrollToMemoryList(() => routeState.handleTimelineSelect(selection))
              }
              onTimelineClear={routeState.handleTimelineClear}
              onEntitySearch={(query) =>
                navigateAndScrollToMemoryList(() => routeState.handleEntitySearch(query))
              }
            />

            <div className="relative mt-5">
              <Search className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-soft-foreground" />
              <Input
                value={routeState.searchInput}
                onChange={(event) => routeState.setSearchInput(event.target.value)}
                onKeyDown={routeState.handleSearch}
                placeholder={t("search.placeholder")}
                className="h-11 bg-popover pl-10 pr-9 text-sm placeholder:text-soft-foreground"
              />
              {routeState.searchInput && (
                <button
                  onClick={routeState.clearSearch}
                  data-mp-event="Dashboard/Space/SearchClearClicked"
                  data-mp-page-name="space"
                  className="absolute top-1/2 right-3.5 -translate-y-1/2 text-soft-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>

            {(routeState.search.type ||
              routeState.facet ||
              routeState.search.q ||
              routeState.tag ||
              routeState.analysisCategory ||
              routeState.timelineSelection) && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{t("filter.active")}</span>
                {routeState.search.q && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-foreground">
                    &ldquo;{routeState.search.q}&rdquo;
                    <button
                      onClick={routeState.clearSearch}
                      data-mp-event="Dashboard/Space/SearchFilterClearClicked"
                      data-mp-page-name="space"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                )}
                {routeState.search.type && (
                  <button
                    onClick={routeState.clearTypeFilter}
                    data-mp-event="Dashboard/Space/TypeFilterClearClicked"
                    data-mp-page-name="space"
                    data-mp-memory-type={routeState.search.type}
                    className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-foreground hover:bg-secondary/80"
                  >
                    {t(
                      routeState.search.type === "pinned"
                        ? "space.stats.pinned"
                        : "space.stats.insight",
                    )}
                    <X className="size-3" />
                  </button>
                )}
                {routeState.facet && (
                  <button
                    onClick={() => routeState.handleFacetChange(undefined)}
                    data-mp-event="Dashboard/Space/FacetFilterClearClicked"
                    data-mp-page-name="space"
                    data-mp-facet={routeState.facet}
                    className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-foreground hover:bg-secondary/80"
                  >
                    {t(`facet.${routeState.facet}`)}
                    <X className="size-3" />
                  </button>
                )}
                {routeState.tag && (
                  <button
                    onClick={() => routeState.handleTagChange(undefined)}
                    data-mp-event="Dashboard/Space/TagFilterClearClicked"
                    data-mp-page-name="space"
                    data-mp-tag={routeState.tag}
                    className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-foreground hover:bg-secondary/80"
                  >
                    #{routeState.tag}
                    <X className="size-3" />
                  </button>
                )}
                {routeState.timelineSelection && (
                  <button
                    onClick={routeState.handleTimelineClear}
                    data-mp-event="Dashboard/Space/TimelineFilterClearClicked"
                    data-mp-page-name="space"
                    className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-foreground hover:bg-secondary/80"
                  >
                    {routeState.timelineLabel}
                    <X className="size-3" />
                  </button>
                )}
                {routeState.analysisCategory && (
                  <button
                    onClick={() => routeState.handleAnalysisCategoryChange(undefined)}
                    data-mp-event="Dashboard/Space/AnalysisFilterClearClicked"
                    data-mp-page-name="space"
                    data-mp-category={routeState.analysisCategory}
                    className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-foreground hover:bg-secondary/80"
                  >
                    {formatAnalysisCategoryLabel(t, routeState.analysisCategory)}
                    <X className="size-3" />
                  </button>
                )}
                {activeFilterCount > 1 && (
                  <button
                    onClick={routeState.clearAllFilters}
                    data-mp-event="Dashboard/Space/ClearAllFiltersClicked"
                    data-mp-page-name="space"
                    className="text-primary/70 hover:text-primary hover:underline"
                  >
                    {t("filter.clear_all")}
                  </button>
                )}
              </div>
            )}

            {dataModel.tagOptions.length > 0 && (
              <div className="mt-4">
                <TagStrip
                  tags={dataModel.tagOptions}
                  activeTag={routeState.tag}
                  onSelect={routeState.handleTagChange}
                  t={t}
                />
              </div>
            )}

            {features.enableTopicSummary &&
              !features.enableAnalysis &&
              dataModel.topicData &&
              dataModel.topicData.topics.length > 0 && (
                <div className="mt-4">
                  <TopicStrip
                    data={dataModel.topicData}
                    activeFacet={routeState.facet}
                    onSelect={routeState.handleFacetChange}
                    t={t}
                  />
                </div>
              )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {!routeState.isDesktopViewport && features.enableAnalysis && (
                <Button
                  variant={routeState.analysisCategory ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => routeState.setMobileAnalysisOpen(true)}
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

            <div id="memory-list" className="mt-4 scroll-mt-20">
              {isEmpty ? (
                <EmptyState t={t} onAdd={() => setAddOpen(true)} />
              ) : dataModel.displayedMemories.length === 0 && !dataModel.isMemoryLoading ? (
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
                  {dataModel.isMemoryLoading && (
                    <div className="flex items-center gap-2 rounded-xl bg-secondary/55 px-3 py-3 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      {t("list.loading")}
                    </div>
                  )}
                  {dataModel.displayedMemories.map((memory, index) => (
                    <MemoryCard
                      key={memory.id}
                      memory={memory}
                      derivedTags={dataModel.getActiveDerivedTags(memory)}
                      sessionPreview={
                        dataModel.sessionPreviewBySessionID[
                          getSessionPreviewLookupKey(memory)
                        ] ?? []
                      }
                      isSelected={routeState.selected?.id === memory.id}
                      onClick={() => routeState.openMemoryDetail(memory, "list")}
                      onDelete={() => setDeleteTarget(memory)}
                      t={t}
                      delay={index < dataModel.displayedFirstPageSize ? index * 30 : 0}
                    />
                  ))}
                  {dataModel.hasMoreMemories && (
                    <div className="py-4 text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (dataModel.usingLocalFilteredList) {
                            routeState.setLocalVisibleCount((current) => current + 50);
                            return;
                          }
                          dataModel.fetchNextPage();
                        }}
                        disabled={dataModel.isFetchingMore}
                        data-mp-event="Dashboard/Space/LoadMoreClicked"
                        data-mp-page-name="space"
                        className="text-sm text-soft-foreground"
                      >
                        {dataModel.isFetchingMore && (
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

          {features.enableAnalysis && routeState.isDesktopViewport && (
            <div className="w-full shrink-0 py-8 xl:order-1 xl:py-8 xl:w-[312px] 2xl:w-[320px]">
              <MemoryFarmPromoCard
                status={dataModel.farmEntryStatus}
                canOpenInNewTab={canOpenFarmInNewTab}
                href="/your-memory/labs/memory-farm"
                onAction={onHandleFarmAction}
              />
              <AnalysisPanel
                state={dataModel.analysis.state}
                sourceCount={dataModel.analysis.sourceCount}
                sourceLoading={dataModel.analysis.sourceLoading}
                taxonomy={dataModel.analysis.taxonomy}
                taxonomyUnavailable={dataModel.analysis.taxonomyUnavailable}
                cards={dataModel.analysis.cards}
                activeCategory={routeState.analysisCategory}
                activeTag={routeState.tag}
                tagStats={dataModel.analysisTagStats}
                onSelectCategory={(category) =>
                  navigateAndScrollToMemoryList(() =>
                    routeState.handleAnalysisCategoryChange(category),
                  )
                }
                onSelectTag={(tag) =>
                  navigateAndScrollToMemoryList(() => routeState.handleTagChange(tag))
                }
                onRefreshMemories={onRefreshMemories}
                refreshingMemories={refreshingMemories}
                onRetry={dataModel.analysis.retry}
                t={t}
              />
            </div>
          )}

          {routeState.selected &&
            routeState.isDesktopViewport &&
            routeState.selectedDetailMode === "panel" && (
              <DetailPanel
                key={routeState.selected.id}
                memory={routeState.selected}
                derivedTags={dataModel.getActiveDerivedTags(routeState.selected)}
                sessionPreview={dataModel.selectedSessionPreview}
                sessionPreviewLoading={dataModel.selectedSessionPreviewLoading}
                onClose={() => routeState.setSelected(null)}
                onDelete={() => setDeleteTarget(routeState.selected!)}
                onEdit={
                  routeState.selected.memory_type === "pinned"
                    ? () => setEditTarget(routeState.selected)
                    : undefined
                }
                t={t}
              />
            )}
        </div>
      </div>

      {!routeState.isDesktopViewport && features.enableAnalysis && (
        <MobileAnalysisSheet
          open={routeState.mobileAnalysisOpen}
          onOpenChange={routeState.setMobileAnalysisOpen}
          state={dataModel.analysis.state}
          sourceCount={dataModel.analysis.sourceCount}
          sourceLoading={dataModel.analysis.sourceLoading}
          taxonomy={dataModel.analysis.taxonomy}
          taxonomyUnavailable={dataModel.analysis.taxonomyUnavailable}
          cards={dataModel.analysis.cards}
          activeCategory={routeState.analysisCategory}
          activeTag={routeState.tag}
          tagStats={dataModel.analysisTagStats}
          onSelectCategory={(category) =>
            navigateAndScrollToMemoryList(() =>
              routeState.handleMobileAnalysisCategoryChange(category),
            )
          }
          onSelectTag={(tag) =>
            navigateAndScrollToMemoryList(() => {
              routeState.handleTagChange(tag);
              routeState.setMobileAnalysisOpen(false);
            })
          }
          onRefreshMemories={onRefreshMemories}
          refreshingMemories={refreshingMemories}
          onRetry={dataModel.analysis.retry}
          t={t}
        />
      )}

      {routeState.selected &&
        (!routeState.isDesktopViewport || routeState.selectedDetailMode === "sheet") && (
          <MobileDetailSheet
            memory={routeState.selected}
            derivedTags={dataModel.getActiveDerivedTags(routeState.selected)}
            sessionPreview={dataModel.selectedSessionPreview}
            sessionPreviewLoading={dataModel.selectedSessionPreviewLoading}
            open={!!routeState.selected}
            onOpenChange={(open) => !open && routeState.setSelected(null)}
            onDelete={() => {
              if (!routeState.selected) return;
              setDeleteTarget(routeState.selected);
              routeState.setSelected(null);
            }}
            onEdit={
              routeState.selected?.memory_type === "pinned"
                ? () => {
                    setEditTarget(routeState.selected);
                    routeState.setSelected(null);
                  }
                : undefined
            }
            t={t}
          />
        )}

      {features.enableManualAdd && (
        <AddMemoryDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          onSave={onHandleCreate}
          loading={dataModel.createMutation.isPending}
          t={t}
        />
      )}
      {editTarget && (
        <EditMemoryDialog
          memory={editTarget}
          open={!!editTarget}
          onOpenChange={(open) => !open && setEditTarget(null)}
          onSave={(content, tags) => onHandleEdit(editTarget, content, tags)}
          loading={dataModel.updateMutation.isPending}
          t={t}
        />
      )}
      {deleteTarget && (
        <DeleteDialog
          memory={deleteTarget}
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          onConfirm={() => onHandleDelete(deleteTarget)}
          loading={dataModel.deleteMutation.isPending}
          t={t}
        />
      )}
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        onExport={onHandleExport}
        stats={dataModel.totalStats}
        loading={dataModel.exportMutation.isPending}
        t={t}
      />
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={onHandleImport}
        onViewHistory={() => setImportStatusOpen(true)}
        loading={dataModel.importMutation.isPending}
        t={t}
      />
      <ImportStatusDialog
        open={importStatusOpen}
        onOpenChange={setImportStatusOpen}
        tasks={dataModel.importTaskData?.tasks ?? []}
        t={t}
      />
      <MemoryFarmPreparationDialog
        open={farmPrepOpen}
        onOpenChange={setFarmPrepOpen}
        status={dataModel.farmEntryStatus}
        analysisState={dataModel.analysis.state}
        currentRange={routeState.range}
        onRetry={dataModel.analysis.retry}
      />
    </div>
  );
}
