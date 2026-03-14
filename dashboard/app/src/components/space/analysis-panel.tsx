import type { TFunction } from "i18next";
import {
  AlertTriangle,
  BarChart3,
  Clock3,
  Loader2,
  RefreshCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type {
  AnalysisCategory,
  AnalysisCategoryCard,
  AnalysisJobSnapshotResponse,
  SpaceAnalysisState,
  TaxonomyResponse,
} from "@/types/analysis";

function formatCategoryLabel(t: TFunction, category: AnalysisCategory): string {
  return t(`analysis.category.${category}`);
}

function formatPhaseLabel(t: TFunction, phase: SpaceAnalysisState["phase"]): string {
  return t(`analysis.phase.${phase}`);
}

function getCompletionRatio(snapshot: AnalysisJobSnapshotResponse): number {
  if (snapshot.expectedTotalBatches === 0) return 0;
  return Math.round(
    ((snapshot.progress.completedBatches + snapshot.progress.failedBatches) /
      snapshot.expectedTotalBatches) *
      100,
  );
}

function getBatchProgressCount(snapshot: AnalysisJobSnapshotResponse): number {
  return snapshot.progress.completedBatches + snapshot.progress.failedBatches;
}

function formatBatchSummary(
  t: TFunction,
  phase: SpaceAnalysisState["phase"],
  snapshot: AnalysisJobSnapshotResponse,
): string {
  const progressed = getBatchProgressCount(snapshot);
  const total = snapshot.expectedTotalBatches;

  if (phase === "creating" || phase === "uploading") {
    return t("analysis.batch_summary.syncing", {
      current: snapshot.progress.uploadedBatches,
      total,
    });
  }

  if (phase === "processing") {
    return t("analysis.batch_summary.processing", {
      current: progressed,
      total,
    });
  }

  return t("analysis.batch_summary.completed", {
    current: progressed,
    total,
  });
}

function parseSummaryLine(
  t: TFunction,
  line: string,
): { label: string; count: string } {
  const [category, count] = line.split(":");
  if (
    category === "identity" ||
    category === "emotion" ||
    category === "preference" ||
    category === "experience" ||
    category === "activity"
  ) {
    return {
      label: formatCategoryLabel(t, category),
      count: count ?? "0",
    };
  }
  return { label: line, count: "" };
}

export function AnalysisPanel({
  state,
  sourceCount,
  sourceLoading,
  taxonomy,
  taxonomyUnavailable,
  cards,
  activeCategory,
  onSelectCategory,
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
  onSelectCategory: (category: AnalysisCategory | undefined) => void;
  onRetry: () => void;
  t: TFunction;
}) {
  const snapshot = state.snapshot;

  return (
    <aside className="w-full shrink-0 xl:w-[360px]">
      <div className="surface-card sticky top-[calc(3.5rem+2rem)] overflow-hidden">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="size-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">
                {t("analysis.title")}
              </h2>
            </div>
            <p className="mt-1 text-xs text-soft-foreground">
              {taxonomy?.version
                ? t("analysis.taxonomy_version", { version: taxonomy.version })
                : t("analysis.taxonomy_fallback")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onRetry}
              disabled={sourceLoading || sourceCount === 0}
              className="gap-1.5 text-xs"
            >
              <RefreshCcw className="size-3.5" />
              {t("analysis.reanalyze")}
            </Button>
            <span className="rounded-full bg-secondary px-2 py-1 text-[11px] font-medium text-muted-foreground">
              {formatPhaseLabel(t, state.phase)}
            </span>
          </div>
        </div>

        <div className="space-y-4 px-5 py-4">
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
                      : t("analysis.failed_body")}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onRetry}
                    className="mt-3 gap-1.5"
                  >
                    <RefreshCcw className="size-3.5" />
                    {t("analysis.retry")}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {snapshot && (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{t("analysis.progress")}</span>
                  <span>
                    {getBatchProgressCount(snapshot)}/
                    {snapshot.expectedTotalBatches}
                  </span>
                </div>
                <Progress value={getCompletionRatio(snapshot)} />
                <p className="text-xs text-soft-foreground">
                  {formatBatchSummary(t, state.phase, snapshot)}
                </p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <MetricCard
                    label={t("analysis.metrics.memories")}
                    value={String(snapshot.expectedTotalMemories)}
                  />
                  <MetricCard
                    label={t("analysis.metrics.processed")}
                    value={String(snapshot.progress.processedMemories)}
                  />
                  <MetricCard
                    label={t("analysis.metrics.uploaded")}
                    value={String(snapshot.progress.uploadedBatches)}
                  />
                  <MetricCard
                    label={t("analysis.metrics.failed")}
                    value={String(snapshot.progress.failedBatches)}
                  />
                </div>
              </div>

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

              {cards.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-ring">
                    {t("analysis.cards")}
                  </h3>
                  <div className="mt-2 space-y-2">
                    {cards.map((card) => (
                      <button
                        key={card.category}
                        type="button"
                        onClick={() =>
                          onSelectCategory(
                            activeCategory === card.category ? undefined : card.category,
                          )
                        }
                        className={`w-full rounded-xl px-3 py-2 text-left transition-colors ${
                          activeCategory === card.category
                            ? "bg-primary/8 ring-1 ring-primary/25"
                            : "bg-secondary/55 hover:bg-secondary/80"
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
                </section>
              )}

              {snapshot.aggregate.summarySnapshot.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-ring">
                    {t("analysis.summary")}
                  </h3>
                  <div className="mt-2 space-y-2">
                    {snapshot.aggregate.summarySnapshot.map((line) => {
                      const parsed = parseSummaryLine(t, line);
                      return (
                        <div
                          key={line}
                          className="flex items-center justify-between rounded-lg bg-secondary/55 px-3 py-2 text-sm"
                        >
                          <span className="text-foreground">{parsed.label}</span>
                          <span className="text-muted-foreground">
                            {parsed.count}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {(snapshot.topTags.length > 0 || snapshot.topTopics.length > 0) && (
                <section className="space-y-3">
                  {snapshot.topTopics.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-ring">
                        {t("analysis.top_topics")}
                      </h3>
                      <ChipRow items={snapshot.topTopics} />
                    </div>
                  )}
                  {snapshot.topTags.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-ring">
                        {t("analysis.top_tags")}
                      </h3>
                      <ChipRow items={snapshot.topTags.map((tag) => `#${tag}`)} />
                    </div>
                  )}
                </section>
              )}

              {state.events.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-ring">
                    {t("analysis.recent_updates")}
                  </h3>
                  <div className="mt-2 space-y-2">
                    {state.events.map((event) => (
                      <div
                        key={`${event.version}-${event.timestamp}`}
                        className="flex items-start gap-2 rounded-lg bg-secondary/55 px-3 py-2"
                      >
                        <Clock3 className="mt-0.5 size-3.5 text-soft-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-foreground">
                            {event.message}
                          </div>
                          <div className="mt-0.5 text-[11px] text-soft-foreground">
                            {new Date(event.timestamp).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-secondary/55 px-3 py-2">
      <div className="text-lg font-semibold tracking-tight text-foreground">
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-soft-foreground">{label}</div>
    </div>
  );
}

function ChipRow({ items }: { items: string[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground"
        >
          {item}
        </span>
      ))}
    </div>
  );
}
