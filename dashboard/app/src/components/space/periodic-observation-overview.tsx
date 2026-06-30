import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  Edit3,
  Ellipsis,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
  Target,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
} from "lucide-react";
import {
  analyzeMemorySourceQueryKey,
  latestCompletedMemoryAnalysisQueryKey,
  useAnalyzeMemorySource,
  useEditSessionMessage,
  useLatestCompletedMemoryAnalysis,
  useMarkSessionMessage,
  type AnalyzeMemorySourceInput,
  type AnalyzeMemorySourceResponse,
  type LatestCompletedMemoryAnalysisResult,
  type MemoryAnalysisChange,
  type MemoryAnalysisChangeDimensionGroup,
  type MemoryAnalysisChangeEvidence,
  type MemoryAnalysisReport,
  type MemorySignalDimension,
} from "@/api/memory-analysis-reports";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DateRangePicker, buildDefaultAnalysisRange } from "@/components/space/date-range-picker";
import { cn } from "@/lib/utils";

const dimensionOrder: MemorySignalDimension[] = [
  "long_term_goal",
  "focus_area",
  "emotion",
  "preference_signal",
  "growth_signal",
];

const dimensionIcon: Record<MemorySignalDimension, typeof Target> = {
  long_term_goal: Target,
  focus_area: TrendingUp,
  emotion: Activity,
  preference_signal: Sparkles,
  growth_signal: RefreshCw,
};

const dimensionTone: Record<MemorySignalDimension, "amber" | "blue" | "green" | "violet"> = {
  long_term_goal: "amber",
  focus_area: "blue",
  emotion: "violet",
  preference_signal: "green",
  growth_signal: "blue",
};

let initialPeriodicAnalysisRange: AnalyzeMemorySourceInput | null = null;

export function PeriodicObservationOverview({
  spaceId,
  active = true,
}: {
  spaceId: string;
  active?: boolean;
}) {
  const { t } = useTranslation();
  const [pendingRange, setPendingRange] = useState(() => getInitialPeriodicAnalysisRange());
  const [analysisRange, setAnalysisRange] = useState(pendingRange);
  const [hasRequestedAnalysis, setHasRequestedAnalysis] = useState(false);
  const [appliedDefaultReportRangeKey, setAppliedDefaultReportRangeKey] = useState<string | null>(null);

  const latestCompletedAnalysisQuery = useLatestCompletedMemoryAnalysis(spaceId, {
    enabled: active,
  });
  const latestCompletedReport = latestCompletedAnalysisQuery.data?.report ?? null;
  const analysisQuery = useAnalyzeMemorySource(spaceId, analysisRange, {
    enabled: active && hasRequestedAnalysis,
  });
  const analysisData = analysisQuery.data ?? latestCompletedAnalysisQuery.data?.analysis;
  const isFetching = analysisQuery.isFetching
    || (latestCompletedAnalysisQuery.isFetching && analysisQuery.data === undefined);
  const isError = analysisQuery.isError
    || (analysisQuery.data === undefined && latestCompletedAnalysisQuery.isError);
  const error = analysisQuery.isError ? analysisQuery.error : latestCompletedAnalysisQuery.error;
  const hasGenerated = hasRequestedAnalysis
    ? analysisQuery.data !== undefined || analysisQuery.isError || analysisQuery.isFetching
    : latestCompletedAnalysisQuery.data !== undefined || latestCompletedAnalysisQuery.isError || latestCompletedAnalysisQuery.isFetching;
  const isRenderingStoredReport = analysisQuery.data === undefined
    && !!latestCompletedAnalysisQuery.data?.report
    && !latestCompletedAnalysisQuery.isFetching;
  const dimensions = useMemo(
    () => sortDimensions(analysisData?.dimensions ?? []),
    [analysisData?.dimensions],
  );
  const [selectedDimension, setSelectedDimension] = useState<MemorySignalDimension>("long_term_goal");
  const activeDimension = dimensions.find((group) => group.dimension === selectedDimension)
    ?? dimensions[0]
    ?? null;
  const totalChanges = dimensions.reduce((count, group) => count + group.changes.length, 0);
  const total = analysisData?.memoryCount ?? 0;

  useEffect(() => {
    if (hasRequestedAnalysis || !latestCompletedReport) return;

    const defaultRange = buildReportAnalysisRange(latestCompletedReport);
    if (!defaultRange) return;

    const reportRangeKey = [
      latestCompletedReport.report_id,
      defaultRange.createdAfter,
      defaultRange.createdBefore,
    ].join(":");
    if (appliedDefaultReportRangeKey === reportRangeKey) return;

    setPendingRange(defaultRange);
    setAnalysisRange(defaultRange);
    setAppliedDefaultReportRangeKey(reportRangeKey);
  }, [appliedDefaultReportRangeKey, hasRequestedAnalysis, latestCompletedReport]);

  const refreshAnalysis = () => {
    if (pendingRange.createdAfter === analysisRange.createdAfter
      && pendingRange.createdBefore === analysisRange.createdBefore
      && hasRequestedAnalysis) {
      void analysisQuery.refetch();
      return;
    }

    setAnalysisRange(pendingRange);
    setHasRequestedAnalysis(true);
  };

  return (
    <section data-testid="periodic-observation-overview" className="relative">
      <header className="surface-card px-4 py-5 sm:px-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[.22em] text-ring">
            {t("periodic_observation.eyebrow")}
          </p>
          <h2 className="mt-2 text-[clamp(1.55rem,2.4vw,2.15rem)] font-semibold tracking-[-.065em]">
            {t("periodic_observation.title")}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("periodic_observation.subtitle")}</p>
        </div>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <DateRangePicker
          label={t("periodic_observation.range")}
          startLabel={t("periodic_observation.date_from")}
          endLabel={t("periodic_observation.date_to")}
          value={pendingRange}
          onChange={setPendingRange}
        />
        <Metric label={t("periodic_observation.memory_count")} value={t("periodic_observation.memories", { count: total })} />
        <Metric label={t("periodic_observation.change_count")} value={t("periodic_observation.changes", { count: totalChanges })} />
        <Button
          onClick={refreshAnalysis}
          disabled={isFetching}
          className="ml-auto"
        >
          {isFetching ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          {t("periodic_observation.generate")}
        </Button>
      </div>

      {isRenderingStoredReport ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/8 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>{t("periodic_observation.stored_report_notice")}</p>
        </div>
      ) : null}

      {isFetching ? (
        <ObservationState icon={<Loader2 className="size-5 animate-spin" />} title={t("periodic_observation.loading")} />
      ) : isError ? (
        <ObservationState
          icon={<AlertTriangle className="size-5" />}
          title={t("periodic_observation.failed")}
          description={error instanceof Error ? error.message : t("periodic_observation.failed_description")}
        />
      ) : !hasGenerated ? (
        <ObservationState
          icon={<Sparkles className="size-5" />}
          title={t("periodic_observation.ready")}
          description={t("periodic_observation.ready_description")}
        />
      ) : dimensions.length === 0 ? (
        <ObservationState
          icon={<Sparkles className="size-5" />}
          title={t("periodic_observation.empty")}
          description={t("periodic_observation.empty_description")}
        />
      ) : (
        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(240px,.85fr)_minmax(0,2fr)]">
          <section className="surface-card p-5">
            <h3 className="text-xl font-semibold tracking-[-.045em]">
              {t("periodic_observation.key_changes.title")}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("periodic_observation.key_changes.subtitle")}
            </p>
            <div className="mt-5 space-y-3">
              {dimensions.map((group) => (
                <DimensionButton
                  key={group.dimension}
                  group={group}
                  selected={activeDimension?.dimension === group.dimension}
                  onSelect={() => setSelectedDimension(group.dimension)}
                />
              ))}
            </div>
          </section>

          {activeDimension ? (
            <DimensionDetail
              group={activeDimension}
              spaceId={spaceId}
              analysisRange={analysisRange}
            />
          ) : null}
        </div>
      )}
    </section>
  );
}

function DimensionButton({
  group,
  selected,
  onSelect,
}: {
  group: MemoryAnalysisChangeDimensionGroup;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const Icon = dimensionIcon[group.dimension];
  const tone = dimensionTone[group.dimension];
  const firstChange = group.changes[0];

  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full rounded-xl border p-4 text-left transition-all",
        selected
          ? "border-blue-500/65 bg-blue-500/[.07] shadow-[0_0_22px_rgba(59,130,246,.10)]"
          : "border-foreground/8 bg-background/20 hover:border-foreground/18",
      )}
    >
      <div className="flex items-start gap-3">
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", toneClass(tone))}>
          <Icon className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-3">
            <span className="font-semibold">{t(`periodic_observation.dimensions.${group.dimension}`)}</span>
            <span className="shrink-0 text-xs font-semibold text-blue-500">
              {t("periodic_observation.changes", { count: group.changes.length })}
            </span>
          </span>
          {firstChange ? (
            <span className="mt-1 block text-sm leading-6 text-muted-foreground">
              {firstChange.title || firstChange.summary}
            </span>
          ) : null}
        </span>
      </div>
    </button>
  );
}

function DimensionDetail({
  group,
  spaceId,
  analysisRange,
}: {
  group: MemoryAnalysisChangeDimensionGroup;
  spaceId: string;
  analysisRange: AnalyzeMemorySourceInput;
}) {
  const { t } = useTranslation();
  const Icon = dimensionIcon[group.dimension];
  const tone = dimensionTone[group.dimension];

  if (group.dimension === "emotion") {
    return (
      <EmotionDimensionDetail
        group={group}
        spaceId={spaceId}
        analysisRange={analysisRange}
      />
    );
  }

  return (
    <section className="surface-card p-5">
      <div className="flex items-start gap-3">
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", toneClass(tone))}>
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[.22em] text-ring">
            {t("periodic_observation.detail.eyebrow")}
          </p>
          <h3 className="mt-1 text-xl font-semibold tracking-[-.045em]">
            {t(`periodic_observation.dimensions.${group.dimension}`)}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {group.summary.trim() || t("periodic_observation.detail.card_count", { count: group.changes.length })}
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {group.changes.map((change, index) => (
          <ChangeCard
            key={`${change.title}-${change.period.start}-${index}`}
            change={change}
            index={index}
            spaceId={spaceId}
            analysisRange={analysisRange}
          />
        ))}
      </div>
    </section>
  );
}

function ChangeCard({
  change,
  index,
  spaceId,
  analysisRange,
}: {
  change: MemoryAnalysisChange;
  index: number;
  spaceId: string;
  analysisRange: AnalyzeMemorySourceInput;
}) {
  const { t } = useTranslation();
  const title = change.title.trim() || t("periodic_observation.detail.untitled", { index: index + 1 });
  const summary = change.summary.trim();
  const periodLabel = formatRangeLabel(change.period.start, change.period.end);

  return (
    <article className="rounded-xl border border-foreground/8 bg-background/20 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h4 className="text-lg font-semibold tracking-[-.025em]">{title}</h4>
        </div>
        {periodLabel ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-foreground/6 px-2 py-1 text-xs text-muted-foreground">
            {periodLabel}
          </span>
        ) : null}
      </div>

      {summary ? (
        <div className="mt-4">
          <p className="mt-1 text-sm leading-7 text-foreground/80">{summary}</p>
        </div>
      ) : null}

      <EvidencePanel
        change={change}
        spaceId={spaceId}
        analysisRange={analysisRange}
        className="mt-4 border-t border-foreground/8 pt-4"
      />
    </article>
  );
}

function EmotionDimensionDetail({
  group,
  spaceId,
  analysisRange,
}: {
  group: MemoryAnalysisChangeDimensionGroup;
  spaceId: string;
  analysisRange: AnalyzeMemorySourceInput;
}) {
  const { t } = useTranslation();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedChange = group.changes[Math.min(selectedIndex, group.changes.length - 1)] ?? null;

  return (
    <section className="surface-card p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/12 text-violet-500">
          <Activity className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[.22em] text-ring">
            {t("periodic_observation.emotion_detail.stages")}
          </p>
          <h3 className="mt-1 text-xl font-semibold tracking-[-.045em]">
            {t("periodic_observation.dimensions.emotion")}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {group.summary.trim() || t("periodic_observation.detail.card_count", { count: group.changes.length })}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {group.changes.map((change, index) => {
          const title = change.title.trim() || t("periodic_observation.detail.untitled", { index: index + 1 });
          const summary = change.summary.trim();
          const periodLabel = formatRangeLabel(change.period.start, change.period.end);
          const selected = selectedChange === change;

          return (
            <button
              key={`${change.title}-${change.period.start}-${index}`}
              type="button"
              onClick={() => setSelectedIndex(index)}
              className={cn(
                "flex min-h-36 flex-col rounded-xl border p-4 text-left transition-all",
                selected
                  ? "border-violet-500/60 bg-violet-500/[.08] shadow-[0_0_24px_rgba(139,92,246,.12)]"
                  : "border-foreground/8 bg-background/20 hover:border-violet-500/35",
              )}
            >
              {periodLabel ? (
                <span className="text-sm font-semibold text-violet-600 dark:text-violet-300">
                  {periodLabel}
                </span>
              ) : null}
              <span className="mt-3 text-base font-semibold tracking-[-.015em] text-foreground">
                {title}
              </span>
              {summary ? (
                <span className="mt-2 text-sm leading-6 text-muted-foreground">
                  {summary}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {selectedChange ? (
        <EvidencePanel
          change={selectedChange}
          spaceId={spaceId}
          analysisRange={analysisRange}
          className="mt-5"
          title={t("periodic_observation.emotion_detail.selected_evidence")}
        />
      ) : null}
    </section>
  );
}

function EvidencePanel({
  change,
  spaceId,
  analysisRange,
  className,
  title,
}: {
  change: MemoryAnalysisChange;
  spaceId: string;
  analysisRange: AnalyzeMemorySourceInput;
  className?: string;
  title?: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const editSessionMessage = useEditSessionMessage(spaceId);
  const markSessionMessage = useMarkSessionMessage(spaceId);
  const [editingEvidence, setEditingEvidence] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const activeEvidence = editingEvidence === null ? null : change.evidence[editingEvidence] ?? null;
  const openEdit = (evidenceIndex: number) => {
    setDraft(change.evidence[evidenceIndex]?.quote ?? "");
    setEditingEvidence(evidenceIndex);
  };
  const markEvidence = async (
    evidence: MemoryAnalysisChangeEvidence,
    correctness: "correct" | "incorrect",
  ) => {
    if (!evidence.evidenceId) return;

    try {
      const markResult = await markSessionMessage.mutateAsync({
        messageId: evidence.evidenceId,
        correctness,
      });
      queryClient.setQueryData<AnalyzeMemorySourceResponse | undefined>(
        analyzeMemorySourceQueryKey(spaceId, analysisRange),
        (current) => updateEvidenceReview(current, evidence.evidenceId, markResult.metadata),
      );
      queryClient.setQueryData<LatestCompletedMemoryAnalysisResult | undefined>(
        latestCompletedMemoryAnalysisQueryKey(spaceId),
        (current) => updateLatestCompletedEvidenceReview(current, evidence.evidenceId, markResult.metadata),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };
  const saveEdit = async () => {
    if (!activeEvidence?.evidenceId) return;

    try {
      const editResult = await editSessionMessage.mutateAsync({
        messageId: activeEvidence.evidenceId,
        content: draft,
        reason: "manual correction from periodic observation",
      });
      queryClient.setQueryData<AnalyzeMemorySourceResponse | undefined>(
        analyzeMemorySourceQueryKey(spaceId, analysisRange),
        (current) => updateEditedEvidence(current, activeEvidence.evidenceId, editResult.content, editResult.metadata),
      );
      queryClient.setQueryData<LatestCompletedMemoryAnalysisResult | undefined>(
        latestCompletedMemoryAnalysisQueryKey(spaceId),
        (current) => updateLatestCompletedEditedEvidence(current, activeEvidence.evidenceId, editResult.content, editResult.metadata),
      );
      setEditingEvidence(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className={className}>
      <p className="text-sm font-semibold">{title ?? t("periodic_observation.detail.evidence")}</p>
      {change.evidence.length > 0 ? (
        <div className="mt-3 divide-y divide-foreground/8 rounded-lg bg-background/20">
          {change.evidence.map((evidence, evidenceIndex) => (
            <EvidenceRow
              key={`${evidence.evidenceId}-${evidenceIndex}`}
              evidence={evidence}
              onEdit={() => openEdit(evidenceIndex)}
              onMarkCorrect={() => {
                void markEvidence(evidence, "correct");
              }}
              onMarkIncorrect={() => {
                void markEvidence(evidence, "incorrect");
              }}
              marking={markSessionMessage.isPending}
            />
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{t("periodic_observation.detail.no_evidence")}</p>
      )}

      <Dialog
        open={editingEvidence !== null}
        onOpenChange={(open) => {
          if (!open && !editSessionMessage.isPending) {
            setEditingEvidence(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("periodic_observation.detail.edit_title")}</DialogTitle>
            <DialogDescription>{t("periodic_observation.detail.edit_body")}</DialogDescription>
          </DialogHeader>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={editSessionMessage.isPending}
            className="min-h-28 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditingEvidence(null)}
              disabled={editSessionMessage.isPending}
            >
              {t("periodic_observation.detail.cancel")}
            </Button>
            <Button
              onClick={() => {
                void saveEdit();
              }}
              disabled={editSessionMessage.isPending || !activeEvidence?.evidenceId}
            >
              {editSessionMessage.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("periodic_observation.detail.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function updateEvidenceReview(
  current: AnalyzeMemorySourceResponse | undefined,
  evidenceId: string,
  review: Record<string, unknown> | null,
): AnalyzeMemorySourceResponse | undefined {
  if (!current) return current;

  return {
    ...current,
    dimensions: current.dimensions.map((group) => ({
      ...group,
      changes: group.changes.map((change) => ({
        ...change,
        evidence: change.evidence.map((evidence) => patchEvidenceReview(evidence, evidenceId, review)),
      })),
    })),
  };
}

function updateLatestCompletedEvidenceReview(
  current: LatestCompletedMemoryAnalysisResult | undefined,
  evidenceId: string,
  review: Record<string, unknown> | null,
): LatestCompletedMemoryAnalysisResult | undefined {
  if (!current) return current;
  return {
    ...current,
    analysis: updateEvidenceReview(current.analysis, evidenceId, review) ?? current.analysis,
  };
}

function patchEvidenceReview(
  evidence: MemoryAnalysisChangeEvidence,
  evidenceId: string,
  review: Record<string, unknown> | null,
): MemoryAnalysisChangeEvidence {
  if (evidence.evidenceId !== evidenceId) return evidence;
  return {
    ...evidence,
    review,
  };
}

function updateEditedEvidence(
  current: AnalyzeMemorySourceResponse | undefined,
  evidenceId: string,
  content: string,
  review: Record<string, unknown> | null,
): AnalyzeMemorySourceResponse | undefined {
  if (!current) return current;

  return {
    ...current,
    dimensions: current.dimensions.map((group) => ({
      ...group,
      changes: group.changes.map((change) => ({
        ...change,
        evidence: change.evidence.map((evidence) => patchEditedEvidence(evidence, evidenceId, content, review)),
      })),
    })),
  };
}

function updateLatestCompletedEditedEvidence(
  current: LatestCompletedMemoryAnalysisResult | undefined,
  evidenceId: string,
  content: string,
  review: Record<string, unknown> | null,
): LatestCompletedMemoryAnalysisResult | undefined {
  if (!current) return current;
  return {
    ...current,
    analysis: updateEditedEvidence(current.analysis, evidenceId, content, review) ?? current.analysis,
  };
}

function patchEditedEvidence(
  evidence: MemoryAnalysisChangeEvidence,
  evidenceId: string,
  content: string,
  review: Record<string, unknown> | null,
): MemoryAnalysisChangeEvidence {
  if (evidence.evidenceId !== evidenceId) return evidence;
  return {
    ...evidence,
    quote: content,
    correctness: "correct",
    edited: true,
    review: {
      ...(review ?? {}),
      correctness: "correct",
      edited: true,
    },
  };
}

function EvidenceRow({
  evidence,
  onEdit,
  onMarkCorrect,
  onMarkIncorrect,
  marking,
}: {
  evidence: MemoryAnalysisChangeEvidence;
  onEdit: () => void;
  onMarkCorrect: () => void;
  onMarkIncorrect: () => void;
  marking: boolean;
}) {
  const { t } = useTranslation();
  const hasReview = Object.prototype.hasOwnProperty.call(evidence, "review");
  const correctness = evidence.review?.correctness ?? evidence.correctness;
  const isConfirmed = correctness === "correct";
  const isIncorrect = correctness === "incorrect";

  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0 flex flex-1 items-start gap-2">
        {isConfirmed ? (
          <span className="mt-0.5 shrink-0 rounded-sm bg-green-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-green-600 dark:text-green-400">
            {t("periodic_observation.detail.confirmed")}
          </span>
        ) : null}
        {isIncorrect ? (
          <span className="mt-0.5 shrink-0 rounded-sm bg-red-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-red-600 dark:text-red-400">
            {t("periodic_observation.detail.marked_inaccurate")}
          </span>
        ) : null}
        <p className="min-w-0 flex-1 text-sm leading-6 text-foreground/82">{evidence.quote}</p>
      </div>
      {isConfirmed ? null : (
        <ResponseMenu
          showConfirm={hasReview && !isIncorrect}
          showInaccurate={!isIncorrect}
          marking={marking}
          onEdit={onEdit}
          onMarkCorrect={onMarkCorrect}
          onMarkIncorrect={onMarkIncorrect}
        />
      )}
    </div>
  );
}

function ResponseMenu({
  showConfirm,
  showInaccurate,
  marking,
  onEdit,
  onMarkCorrect,
  onMarkIncorrect,
}: {
  showConfirm: boolean;
  showInaccurate: boolean;
  marking: boolean;
  onEdit: () => void;
  onMarkCorrect: () => void;
  onMarkIncorrect: () => void;
}) {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon-xs"
          className="h-6 w-7 shrink-0 rounded-sm"
          style={{ borderRadius: "4px" }}
          aria-label={t("periodic_observation.detail.respond")}
        >
          <Ellipsis className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {showConfirm ? (
          <DropdownMenuItem disabled={marking} onSelect={onMarkCorrect}>
            {marking ? <Loader2 className="size-4 animate-spin" /> : <ThumbsUp className="size-4" />}
            {t("periodic_observation.detail.confirm")}
          </DropdownMenuItem>
        ) : null}
        {showInaccurate ? (
          <DropdownMenuItem disabled={marking} onSelect={onMarkIncorrect}>
            {marking ? <Loader2 className="size-4 animate-spin" /> : <ThumbsDown className="size-4" />}
            {t("periodic_observation.detail.inaccurate")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={onEdit}>
          <Edit3 className="size-4" />
          {t("periodic_observation.detail.edit")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ObservationState({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div className={cn("surface-card mt-5 flex gap-3 p-5", description ? "items-start" : "items-center")}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/12 text-blue-500">
        {icon}
      </span>
      <div>
        <p className="font-semibold">{title}</p>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-xl border border-foreground/8 bg-background/35 px-3 py-2 text-sm">
      <span className="text-soft-foreground">{icon}</span>
      <span className="text-muted-foreground">{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

function sortDimensions(groups: MemoryAnalysisChangeDimensionGroup[]): MemoryAnalysisChangeDimensionGroup[] {
  return [...groups].sort((left, right) => (
    dimensionOrder.indexOf(left.dimension) - dimensionOrder.indexOf(right.dimension)
  ));
}

function getInitialPeriodicAnalysisRange(): AnalyzeMemorySourceInput {
  initialPeriodicAnalysisRange ??= buildDefaultAnalysisRange();
  return initialPeriodicAnalysisRange;
}

function buildReportAnalysisRange(report: MemoryAnalysisReport): AnalyzeMemorySourceInput | null {
  if (!report.startTime || !report.endTime) return null;

  const start = parseDate(report.startTime);
  const end = parseDate(report.endTime);
  if (!start || !end || start.getTime() > end.getTime()) return null;

  return {
    createdAfter: report.startTime,
    createdBefore: report.endTime,
  };
}

function formatRangeLabel(start: string, end: string): string {
  const startDate = parseDate(start);
  const endDate = parseDate(end);

  if (!startDate || !endDate) {
    return "";
  }

  return `${formatShortDate(startDate)} - ${formatShortDate(endDate)}`;
}

function parseDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatShortDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
  }).format(date);
}

function toneClass(tone: "amber" | "blue" | "green" | "violet") {
  if (tone === "amber") {
    return "bg-amber-500/12 text-amber-500";
  }
  if (tone === "green") {
    return "bg-emerald-500/12 text-emerald-500";
  }
  if (tone === "violet") {
    return "bg-violet-500/12 text-violet-500";
  }
  return "bg-blue-500/12 text-blue-500";
}
