import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import {
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCcw,
} from "lucide-react";
import { buildFacetStats } from "@/api/analysis-helpers";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type {
  AnalysisCategory,
  AnalysisCategoryCard,
  AnalysisFacetStat,
  AnalysisJobSnapshotResponse,
  SpaceAnalysisState,
  TaxonomyResponse,
} from "@/types/analysis";

const TERMINAL_SNAPSHOT_STATUSES = new Set([
  "COMPLETED",
  "PARTIAL_FAILED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
]);
const COLLAPSED_CARD_LIMIT = 5;
const COLLAPSED_FACET_LIMIT = 8;

function humanizeCategory(category: AnalysisCategory): string {
  return category
    .split("_")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatCategoryLabel(t: TFunction, category: AnalysisCategory): string {
  const key = `analysis.category.${category}`;
  const translated = t(key);
  return translated === key ? humanizeCategory(category) : translated;
}

export function formatPhaseLabel(t: TFunction, phase: SpaceAnalysisState["phase"]): string {
  return t(`analysis.phase.${phase}`);
}

function getFacetStats(
  snapshot: AnalysisJobSnapshotResponse,
  kind: "tags" | "topics",
): AnalysisFacetStat[] {
  if (kind === "tags") {
    if (snapshot.topTagStats !== undefined) {
      return snapshot.topTagStats;
    }

    if (snapshot.topTags.length > 0) {
      return snapshot.topTags
        .map((value) => ({
          value,
          count: snapshot.aggregate.tagCounts[value] ?? 0,
        }))
        .filter((stat) => stat.count > 0);
    }

    return buildFacetStats(snapshot.aggregate.tagCounts);
  }

  if (snapshot.topTopicStats !== undefined) {
    return snapshot.topTopicStats;
  }

  if (snapshot.topTopics.length > 0) {
    return snapshot.topTopics
      .map((value) => ({
        value,
        count: snapshot.aggregate.topicCounts[value] ?? 0,
      }))
      .filter((stat) => stat.count > 0);
  }

  return buildFacetStats(snapshot.aggregate.topicCounts);
}

function getTagStatsFromState(
  state: SpaceAnalysisState,
): AnalysisFacetStat[] {
  return state.snapshot ? getFacetStats(state.snapshot, "tags") : [];
}

export function getDisplayedBatchProgress(
  phase: SpaceAnalysisState["phase"],
  snapshot: AnalysisJobSnapshotResponse,
): { current: number; total: number; ratio: number } {
  const total = snapshot.expectedTotalBatches;

  if (total === 0) {
    return {
      current: 0,
      total: 0,
      ratio: 0,
    };
  }

  if (phase === "completed" || TERMINAL_SNAPSHOT_STATUSES.has(snapshot.status)) {
    return {
      current: total,
      total,
      ratio: 100,
    };
  }

  if (phase === "uploading") {
    const current = Math.min(snapshot.progress.uploadedBatches, total);
    return {
      current,
      total,
      ratio: Math.round((current / total) * 100),
    };
  }

  if (phase === "processing") {
    const current = Math.min(
      snapshot.progress.completedBatches + snapshot.progress.failedBatches,
      total,
    );
    return {
      current,
      total,
      ratio: Math.round((current / total) * 100),
    };
  }

  return {
    current: 0,
    total,
    ratio: 0,
  };
}

export function formatBatchSummary(
  t: TFunction,
  phase: SpaceAnalysisState["phase"],
  snapshot: AnalysisJobSnapshotResponse,
): string {
  const progress = getDisplayedBatchProgress(phase, snapshot);

  if (phase === "creating" || phase === "uploading") {
    return t("analysis.batch_summary.syncing", {
      current: progress.current,
      total: progress.total,
    });
  }

  if (phase === "processing") {
    return t("analysis.batch_summary.processing", {
      current: progress.current,
      total: progress.total,
    });
  }

  return t("analysis.batch_summary.completed", {
    current: progress.current,
    total: progress.total,
  });
}

export function AnalysisPanel({
  state,
  sourceCount,
  sourceLoading,
  taxonomy,
  taxonomyUnavailable,
  cards,
  activeCategory,
  activeTag,
  tagStats,
  onSelectCategory,
  onSelectTag,
  onRefreshMemories = () => {},
  refreshingMemories = false,
  onRetry,
  t,
}: {
  state: SpaceAnalysisState;
  sourceCount: number;
  sourceLoading: boolean;
  taxonomy: TaxonomyResponse | null;
  taxonomyUnavailable: boolean;
  cards: AnalysisCategoryCard[];
  activeCategory?: AnalysisCategory;
  activeTag?: string;
  tagStats?: AnalysisFacetStat[];
  onSelectCategory: (category: AnalysisCategory | undefined) => void;
  onSelectTag: (tag: string | undefined) => void;
  onRefreshMemories?: () => void;
  refreshingMemories?: boolean;
  onRetry: () => void;
  t: TFunction;
}) {
  return (
    <aside className="w-full shrink-0 xl:sticky xl:top-[calc(3.5rem+2rem)] xl:self-start xl:w-[312px] 2xl:w-[320px]">
      <div className="surface-card overflow-hidden xl:max-h-[calc(100vh-6rem)]">
        <div className="border-b px-4 py-4 xl:sticky xl:top-0 xl:z-10 xl:bg-card/95 xl:backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <BarChart3 className="size-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">
              {t("analysis.title")}
            </h2>
          </div>
        </div>

        <div className="analysis-scroll-area space-y-4 px-4 py-4 xl:max-h-[calc(100vh-9.5rem)] xl:overflow-y-auto">
          <AnalysisPanelBody
            state={state}
            sourceCount={sourceCount}
            sourceLoading={sourceLoading}
            taxonomy={taxonomy}
            taxonomyUnavailable={taxonomyUnavailable}
            cards={cards}
            activeCategory={activeCategory}
            activeTag={activeTag}
            tagStats={tagStats}
            onSelectCategory={onSelectCategory}
            onSelectTag={onSelectTag}
            onRefreshMemories={onRefreshMemories}
            refreshingMemories={refreshingMemories}
            onRetry={onRetry}
            t={t}
          />
        </div>
      </div>
    </aside>
  );
}

export function AnalysisPanelBody({
  state,
  sourceCount,
  sourceLoading,
  taxonomy: _taxonomy,
  taxonomyUnavailable,
  cards,
  activeCategory,
  activeTag,
  tagStats,
  onSelectCategory,
  onSelectTag,
  onRefreshMemories = () => {},
  refreshingMemories = false,
  onRetry,
  t,
}: {
  state: SpaceAnalysisState;
  sourceCount: number;
  sourceLoading: boolean;
  taxonomy: TaxonomyResponse | null;
  taxonomyUnavailable: boolean;
  cards: AnalysisCategoryCard[];
  activeCategory?: AnalysisCategory;
  activeTag?: string;
  tagStats?: AnalysisFacetStat[];
  onSelectCategory: (category: AnalysisCategory | undefined) => void;
  onSelectTag: (tag: string | undefined) => void;
  onRefreshMemories?: () => void;
  refreshingMemories?: boolean;
  onRetry: () => void;
  t: TFunction;
}) {
  const snapshot = state.snapshot;
  const progress = snapshot
    ? getDisplayedBatchProgress(state.phase, snapshot)
    : null;
  const topTagStats = useMemo(
    () => tagStats ?? getTagStatsFromState(state),
    [state, tagStats],
  );
  const visibleCards = useMemo(
    () => cards.filter((card) => card.count > 0),
    [cards],
  );
  const [isCardsExpanded, setIsCardsExpanded] = useState(false);
  const isCardOverflowing = visibleCards.length > COLLAPSED_CARD_LIMIT;
  const displayedCards =
    isCardsExpanded || !isCardOverflowing
      ? visibleCards
      : visibleCards.slice(0, COLLAPSED_CARD_LIMIT);
  const showCompactProgress =
    snapshot !== null &&
    (state.phase === "creating" ||
      state.phase === "uploading" ||
      state.phase === "processing");
  const showRunDetails = snapshot !== null;

  useEffect(() => {
    setIsCardsExpanded(false);
  }, [cards]);

  return (
    <>
      {sourceLoading && (
        <div className="flex items-center gap-2 rounded-xl bg-secondary/60 px-3 py-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t("analysis.loading_source")}
        </div>
      )}

      {!sourceLoading && sourceCount === 0 && (
        <div className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">
          {t("analysis.empty")}
        </div>
      )}

      {(state.phase === "degraded" || state.phase === "failed") && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-4 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                {state.phase === "degraded"
                  ? t("analysis.degraded_title")
                  : t("analysis.failed_title")}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {state.error === "analysis_unavailable"
                  ? t("analysis.degraded_body")
                  : state.error === "analysis_stalled"
                    ? t("analysis.stalled_body")
                  : t("analysis.failed_body")}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={onRetry}
                data-mp-event="Dashboard/Analysis/RetryClicked"
                data-mp-page-name="space"
                className="mt-3 w-full gap-1.5"
              >
                <RefreshCcw className="size-3.5" />
                {t("analysis.retry")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showCompactProgress && (
        <section className="rounded-xl border bg-secondary/20 px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ring">
                {t("analysis.status")}
              </p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {formatPhaseLabel(t, state.phase)}
              </p>
            </div>
            <span className="rounded-full bg-secondary px-2 py-1 text-[11px] font-medium text-muted-foreground">
              {progress?.current ?? 0}/{progress?.total ?? 0}
            </span>
          </div>
          <div className="mt-3">
            <Progress value={progress?.ratio ?? 0} />
          </div>
          <p className="mt-2 text-xs text-soft-foreground">
            {formatBatchSummary(t, state.phase, snapshot!)}
          </p>
        </section>
      )}

      {visibleCards.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-ring">
            {t("analysis.cards")}
          </h3>
          <div data-testid="analysis-cards" className="mt-2 space-y-2">
            {displayedCards.map((card) => (
              <button
                key={card.category}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectCategory(
                    activeCategory === card.category ? undefined : card.category,
                  );
                }}
                data-mp-event="Dashboard/Analysis/CategoryClicked"
                data-mp-page-name="space"
                data-mp-category={card.category}
                className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  activeCategory === card.category
                    ? "border-primary/20 bg-primary/8 ring-1 ring-primary/25"
                    : "border-transparent bg-secondary/55 hover:border-foreground/10 hover:bg-secondary/80"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-foreground">
                    {formatCategoryLabel(t, card.category)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {card.count}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-soft-foreground">
                  {t("analysis.confidence", {
                    value: `${Math.round(card.confidence * 100)}%`,
                  })}
                </div>
              </button>
            ))}
          </div>
          {isCardOverflowing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsCardsExpanded((current) => !current);
              }}
              aria-expanded={isCardsExpanded}
              data-testid="analysis-cards-toggle"
              data-mp-event="Dashboard/Analysis/CardToggleClicked"
              data-mp-page-name="space"
              className="-ml-2 mt-1 h-auto px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {isCardsExpanded ? t("analysis.less") : t("analysis.more")}
            </Button>
          )}
        </section>
      )}

      {topTagStats.length > 0 && (
        <section className="space-y-3">
          <FacetSection
            kind="tags"
            title={t("analysis.top_tags")}
            stats={topTagStats}
            activeValue={activeTag}
            onSelect={onSelectTag}
            t={t}
          />
        </section>
      )}

      {showRunDetails && (
        <InlineCollapsibleSection
          title={t("analysis.run_details")}
          defaultOpen={state.phase !== "completed"}
          t={t}
        >
          <>
            {!showCompactProgress && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{t("analysis.progress")}</span>
                  <span>{progress?.current ?? 0}/{progress?.total ?? 0}</span>
                </div>
                <Progress value={progress?.ratio ?? 0} />
                <p className="text-xs text-soft-foreground">
                  {formatBatchSummary(t, state.phase, snapshot!)}
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <MetricCard
                label={t("analysis.metrics.memories")}
                value={String(snapshot!.expectedTotalMemories)}
              />
              <MetricCard
                label={t("analysis.metrics.processed")}
                value={String(snapshot!.progress.processedMemories)}
              />
              <MetricCard
                label={t("analysis.metrics.uploaded")}
                value={String(snapshot!.progress.uploadedBatches)}
              />
              <MetricCard
                label={t("analysis.metrics.failed")}
                value={String(snapshot!.progress.failedBatches)}
              />
            </div>
            <p className="text-xs text-soft-foreground">
              {t("analysis.processed_hint")}
            </p>

            {taxonomyUnavailable && (
              <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                {t("analysis.taxonomy_warning")}
              </div>
            )}

            {state.warning === "poll_retrying" && (
              <div className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">
                {t("analysis.retrying_updates")}
              </div>
            )}

            <div className="ml-auto flex flex-nowrap items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onRefreshMemories}
                disabled={sourceLoading || refreshingMemories}
                data-mp-event="Dashboard/Analysis/RefreshMemoryClicked"
                data-mp-page-name="space"
                className="h-8 shrink-0 gap-1.5 px-3 text-[11px] whitespace-nowrap"
              >
                <RefreshCcw className={`size-3.5 ${refreshingMemories ? "animate-spin" : ""}`} />
                {t("analysis.refresh_memory")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onRetry}
                disabled={sourceLoading || sourceCount === 0 || refreshingMemories}
                data-mp-event="Dashboard/Analysis/ReanalyzeClicked"
                data-mp-page-name="space"
                className="h-8 shrink-0 gap-1.5 px-3 text-[11px] whitespace-nowrap"
              >
                <RefreshCcw className="size-3.5" />
                {t("analysis.reanalyze")}
              </Button>
            </div>
          </>
        </InlineCollapsibleSection>
      )}
    </>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-secondary/55 px-3 py-2">
      <div className="text-base font-semibold tracking-tight text-foreground">
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-soft-foreground">{label}</div>
    </div>
  );
}

function FacetSection({
  kind,
  title,
  stats,
  activeValue,
  onSelect,
  t,
}: {
  kind: "topics" | "tags";
  title: string;
  stats: AnalysisFacetStat[];
  activeValue?: string;
  onSelect: (value: string | undefined) => void;
  t: TFunction;
}) {
  const items = useMemo(() => stats.slice(0, 50), [stats]);
  const [isExpanded, setIsExpanded] = useState(false);
  const isOverflowing = items.length > COLLAPSED_FACET_LIMIT;
  const displayedItems =
    isExpanded || !isOverflowing
      ? items
      : items.slice(0, COLLAPSED_FACET_LIMIT);
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-ring">
        {title}
      </h3>
      <div
        data-testid={`analysis-facets-${kind}`}
        className="mt-2 flex flex-wrap gap-2"
      >
        {displayedItems.map((stat) => (
          (() => {
            const badgeLabel = kind === "tags"
              ? stat.origin === "mixed"
                ? t("analysis.mixed_badge")
                : null
              : null;

            return (
              <button
                key={stat.value}
                type="button"
                onClick={() => {
                  onSelect(activeValue === stat.value ? undefined : stat.value);
                }}
                aria-label={
                  badgeLabel
                    ? `${stat.value} ${badgeLabel} (${stat.count})`
                    : `${stat.value} (${stat.count})`
                }
                className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                  activeValue === stat.value
                    ? "bg-primary/20 text-primary hover:bg-primary/30"
                    : "bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                }`}
              >
                <span>{stat.value}</span>
                {badgeLabel && (
                  <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${
                    stat.origin === "mixed"
                      ? "bg-amber-500/12 text-amber-300"
                      : "bg-primary/10 text-primary"
                  }`}>
                    {badgeLabel}
                  </span>
                )}
                <span className="ml-1">({stat.count})</span>
              </button>
            );
          })()
        ))}
      </div>
      {isOverflowing && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setIsExpanded((current) => !current);
          }}
          aria-expanded={isExpanded}
          data-mp-event="Dashboard/Analysis/FacetToggleClicked"
          data-mp-page-name="space"
          data-mp-kind={kind}
          className="-ml-2 mt-1 h-auto px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {isExpanded ? t("analysis.less") : t("analysis.more")}
        </Button>
      )}
    </div>
  );
}

function InlineCollapsibleSection({
  title,
  defaultOpen = false,
  t,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  t: TFunction;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section className="border-t pt-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-ring">
          {title}
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsOpen((current) => !current)}
          aria-expanded={isOpen}
          data-mp-event="Dashboard/Analysis/SectionToggleClicked"
          data-mp-page-name="space"
          className="-mr-2 h-auto gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {isOpen ? t("analysis.collapse_section") : t("analysis.expand_section")}
          {isOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </Button>
      </div>
      {isOpen && <div className="mt-3 space-y-3">{children}</div>}
    </section>
  );
}
