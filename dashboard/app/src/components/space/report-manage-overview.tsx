import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Activity,
  ArrowUpRight,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import {
  useAllMemoryAnalysisReports,
  useGenerateMemoryAnalysisReport,
  type MemoryAnalysisReport,
  type MemoryAnalysisReportStatus,
} from "@/api/memory-analysis-reports";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { buildDefaultAnalysisRange } from "@/components/space/date-range-picker";
import {
  REPORT_PDF_API_KEY_HANDOFF_PARAM,
  createReportPdfApiKeyHandoffNonce,
  startReportPdfApiKeyHandoff,
} from "@/lib/report-pdf";
import { cn } from "@/lib/utils";

type TemplateId = "weekly" | "trend" | "emotion" | "structure" | "growth";
type TemplateTone = "amber" | "blue" | "green" | "violet";

const templateIcons = {
  weekly: TrendingUp,
  trend: Target,
  emotion: Activity,
  structure: Sparkles,
  growth: RefreshCw,
} as const;

const templateTone: Record<TemplateId, TemplateTone> = {
  weekly: "blue",
  trend: "amber",
  emotion: "violet",
  structure: "green",
  growth: "blue",
};

const workflowSteps = [0, 1, 2] as const;
const REPORT_HISTORY_PAGE_SIZE = 10;
const REPORT_HISTORY_GRID_CLASS = "grid gap-2 sm:grid-cols-[minmax(0,1.15fr)_minmax(5.5rem,0.7fr)_minmax(6.5rem,0.8fr)_7rem] sm:items-center";

export function ReportManageOverview({
  spaceId,
  className,
}: {
  spaceId: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId>("weekly");

  const templates = useMemo(
    () =>
      (["weekly", "trend", "emotion", "structure", "growth"] as const).map((id) => ({
        id,
        name: t(`report_manage.templates.${id}.name`),
        cadence: t(`report_manage.templates.${id}.cadence`),
        lastGenerated: t(`report_manage.templates.${id}.last_generated`),
      })),
    [t],
  );

  const selected = templates.find((template) => template.id === selectedTemplate) ?? templates[0]!;
  const SelectedIcon = templateIcons[selectedTemplate];
  const selectedToneClass = templateToneClass(templateTone[selectedTemplate]);
  const allReportsQuery = useAllMemoryAnalysisReports(spaceId);
  const generateReportMutation = useGenerateMemoryAnalysisReport(spaceId);
  const [isRefreshingReports, setIsRefreshingReports] = useState(false);
  const isGenerating = generateReportMutation.isPending || isRefreshingReports;

  useEffect(() => startReportPdfApiKeyHandoff(spaceId), [spaceId]);

  const generate = async () => {
    try {
      const result = await generateReportMutation.mutateAsync({
        analysisRange: buildDefaultAnalysisRange(),
      });
      setIsRefreshingReports(true);
      await allReportsQuery.refetch();

      if (result.renderStatus === "fail") {
        toast.error(result.failReason || t("report_manage.generate_failed"));
        return;
      }

      toast.success(t("report_manage.generate_success", {
        template: selected.name,
        count: result.memoryCount,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message || t("report_manage.generate_failed"));
    } finally {
      setIsRefreshingReports(false);
    }
  };

  const selectTemplate = (template: TemplateId) => {
    if (isGenerating) {
      return;
    }
    setSelectedTemplate(template);
  };

  const openTemplateReport = (report: MemoryAnalysisReport) => {
    const reportUrl = new URL(`${import.meta.env.BASE_URL}template-report`, window.location.origin);
    reportUrl.searchParams.set("reportId", String(report.report_id));
    reportUrl.searchParams.set(
      REPORT_PDF_API_KEY_HANDOFF_PARAM,
      createReportPdfApiKeyHandoffNonce(),
    );
    window.open(reportUrl.toString(), "_blank", "noopener,noreferrer");
  };

  return (
    <section className={cn("relative overflow-hidden", className)} data-testid="report-manage-overview">
      <div className="relative">
        <div className="surface-card px-4 py-5 sm:px-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-ring">{t("report_manage.eyebrow")}</p>
            <h2 className="mt-2 text-[clamp(1.45rem,2vw,1.85rem)] font-semibold tracking-[-0.06em] text-foreground">{t("report_manage.title")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("report_manage.subtitle")}</p>
          </div>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(255px,0.78fr)_minmax(0,2.22fr)]">
          <aside className="rounded-2xl border border-foreground/7 bg-foreground/[0.018] p-3 sm:p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-base font-semibold tracking-[-0.03em]">{t("report_manage.library_title")}</h3>
              <span className="text-xs text-soft-foreground">{t("report_manage.template_count", { count: templates.length })}</span>
            </div>
            <div className="mt-4 max-h-[17.5rem] space-y-2 overflow-y-auto pr-1">
              {templates.map((template) => {
                const Icon = templateIcons[template.id];
                const iconToneClass = templateToneClass(templateTone[template.id]);
                const active = template.id === selectedTemplate;
                return <button key={template.id} onClick={() => selectTemplate(template.id)} disabled={isGenerating} className={cn("w-full rounded-xl border p-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60", active ? "border-ring/45 bg-ring/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" : "border-foreground/7 bg-background/25 hover:border-foreground/16 hover:bg-foreground/[0.025]")}>
                  <div className="flex items-center gap-2.5"><span className={cn("flex size-7 items-center justify-center rounded-lg", iconToneClass)}><Icon className="size-3.5" /></span><span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{template.name}</span><span className="rounded-md bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">{t("report_manage.enabled")}</span></div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-soft-foreground"><span>{t("report_manage.cadence", { value: template.cadence })}</span><ChevronRight className="size-3.5" /></div>
                  <p className="mt-1 text-[11px] text-soft-foreground">{t("report_manage.last_generated", { value: template.lastGenerated })}</p>
                </button>;
              })}
            </div>
          </aside>

          <div className="min-w-0 space-y-4">
            <div>
              <p className="text-base font-semibold tracking-[-0.03em] text-foreground">{t("report_manage.details_title")}</p>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className={cn("flex size-10 items-center justify-center rounded-full", selectedToneClass)}>
                  <SelectedIcon className="size-4" />
                </span>
                <span className="text-[clamp(1.05rem,1.55vw,1.3rem)] font-semibold leading-none tracking-[-0.04em] text-foreground">{selected.name}</span>
                <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">{t("report_manage.enabled")}</span>
              </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,.82fr)_minmax(0,1.18fr)]">
              <div className="rounded-3xl border border-foreground/10 bg-foreground/[0.024] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-6">
                <h3 className="text-lg font-semibold tracking-[-0.035em]">{t("report_manage.description_title")}</h3>
                <dl className="mt-5 space-y-4 text-sm">
                  <DetailRow label={t("report_manage.goal_label")} value={t(`report_manage.templates.${selectedTemplate}.goal`)} />
                  <DetailRow label={t("report_manage.period_label")} value={selected.cadence} />
                  <DetailRow label={t("report_manage.evidence_label")} value={t("report_manage.evidence_value")} />
                </dl>
              </div>
              <div className="rounded-3xl border border-foreground/10 bg-foreground/[0.024] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-6">
                <h3 className="text-lg font-semibold tracking-[-0.035em]">{t("report_manage.handoff_title")}</h3>
                <div className="mt-5 space-y-2.5">
                  {workflowSteps.map((step) => (
                    <div key={step} className="grid gap-2.5 px-1 py-2 text-xs sm:grid-cols-[10.5rem_minmax(0,1fr)] sm:items-center">
                      <p className="font-semibold text-foreground">
                        <span className="mr-2 tabular-nums">{String(step + 1).padStart(2, "0")}</span>
                        {t(`report_manage.workflow_items.${step}.title`)}
                      </p>
                      <p className="leading-relaxed text-soft-foreground">{t(`report_manage.workflow_items.${step}.body`)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="font-semibold">{t("report_manage.all_history_title")}</h3>
            <Button onClick={generate} disabled={isGenerating} className="rounded-xl">
              {isGenerating ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              {t("report_manage.generate_template")}
            </Button>
          </div>
          <div className="mt-3 overflow-hidden rounded-2xl border border-foreground/7 bg-foreground/[0.018] divide-y divide-foreground/7">
            <ReportHistoryRows
              reports={allReportsQuery.data?.reports ?? []}
              loading={allReportsQuery.isLoading}
              error={allReportsQuery.isError}
              onOpen={openTemplateReport}
              t={t}
            />
          </div>
        </div>

        <p className="mt-5 flex items-center gap-2 text-xs text-soft-foreground"><span className="flex size-4 items-center justify-center rounded-full border border-current text-[10px]">i</span>{t("report_manage.note")}</p>
      </div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-[4.8rem_minmax(0,1fr)] gap-3"><dt className="text-soft-foreground">{label}</dt><dd className="min-w-0 font-medium leading-relaxed text-foreground">{value}</dd></div>;
}

function ReportHistoryMessage({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-sm text-muted-foreground">{children}</p>;
}

function ReportHistoryRows({
  reports,
  loading,
  error,
  unavailable = false,
  onOpen,
  t,
}: {
  reports: MemoryAnalysisReport[];
  loading: boolean;
  error: boolean;
  unavailable?: boolean;
  onOpen: (report: MemoryAnalysisReport) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(reports.length / REPORT_HISTORY_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageStart = (safePage - 1) * REPORT_HISTORY_PAGE_SIZE;
  const pageReports = reports.slice(pageStart, pageStart + REPORT_HISTORY_PAGE_SIZE);
  const pageEnd = pageStart + pageReports.length;

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  if (unavailable) {
    return <ReportHistoryMessage>{t("report_manage.report_type_unavailable")}</ReportHistoryMessage>;
  }
  if (loading) {
    return <ReportHistoryMessage>{t("report_manage.report_history_loading")}</ReportHistoryMessage>;
  }
  if (error) {
    return <ReportHistoryMessage>{t("report_manage.report_history_failed")}</ReportHistoryMessage>;
  }
  if (reports.length === 0) {
    return <ReportHistoryMessage>{t("report_manage.report_history_empty")}</ReportHistoryMessage>;
  }

  return (
    <>
      <div className={cn(REPORT_HISTORY_GRID_CLASS, "bg-foreground/[0.018] px-4 py-2.5 text-xs font-semibold text-soft-foreground")}>
        <span>{t("report_manage.history_columns.period")}</span>
        <span className="justify-self-start text-left">{t("report_manage.history_columns.status")}</span>
        <span className="justify-self-start text-left">{t("report_manage.history_columns.memory_count")}</span>
        <span className="sm:text-right">{t("report_manage.history_columns.actions")}</span>
      </div>
      {pageReports.map((report) => (
        <div key={`${report.template_id}-${report.report_id}`} className={cn(REPORT_HISTORY_GRID_CLASS, "px-4 py-3 text-sm")}>
          <span className="min-w-0 font-medium">{formatReportPeriod(report)}</span>
          <ReportStatusBadge
            status={report.render_status}
            failReason={report.fail_reason}
            t={t}
          />
          <span className="justify-self-start truncate text-left text-muted-foreground">
            {t("report_manage.memory_count", { count: report.memory_count })}
          </span>
          <div className="flex gap-2 sm:justify-end">
            <Button variant="outline" size="xs" disabled={report.render_status !== "success"} onClick={() => onOpen(report)}>{t("report_manage.view_template")}<ArrowUpRight className="size-3" /></Button>
          </div>
        </div>
      ))}
      {reports.length > REPORT_HISTORY_PAGE_SIZE ? (
        <div className="flex flex-col gap-2 px-4 py-3 text-xs text-soft-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            {t("report_manage.pagination_summary", {
              start: pageStart + 1,
              end: pageEnd,
              total: reports.length,
            })}
          </span>
          <div className="flex items-center gap-2 sm:justify-end">
            <Button
              variant="outline"
              size="xs"
              disabled={safePage <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              aria-label={t("report_manage.previous_page")}
            >
              <ChevronLeft className="size-3" />
              {t("report_manage.previous_page")}
            </Button>
            <span className="min-w-12 text-center tabular-nums">
              {safePage} / {pageCount}
            </span>
            <Button
              variant="outline"
              size="xs"
              disabled={safePage >= pageCount}
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              aria-label={t("report_manage.next_page")}
            >
              {t("report_manage.next_page")}
              <ChevronRight className="size-3" />
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ReportStatusBadge({
  status,
  failReason,
  t,
}: {
  status: MemoryAnalysisReportStatus;
  failReason?: string | null;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const shouldShowFailReason = status === "fail" && !!failReason?.trim();

  return (
    <span className="flex items-center gap-1.5 justify-self-start text-left">
      <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", reportStatusClass(status))}>
        {t(`report_manage.status.${status}`)}
      </span>
      {shouldShowFailReason ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex size-5 items-center justify-center rounded-md text-red-600 outline-none transition-colors hover:bg-red-500/10 focus-visible:ring-2 focus-visible:ring-red-500/35 dark:text-red-400"
                aria-label={t("report_manage.failure_reason")}
              >
                <AlertTriangle className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {failReason}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
    </span>
  );
}

function reportStatusClass(status: MemoryAnalysisReportStatus): string {
  if (status === "success") {
    return "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400";
  }
  if (status === "fail") {
    return "bg-red-500/12 text-red-600 dark:text-red-400";
  }
  if (status === "running") {
    return "bg-blue-500/12 text-blue-600 dark:text-blue-400";
  }
  return "bg-amber-500/12 text-amber-700 dark:text-amber-300";
}

function templateToneClass(tone: TemplateTone): string {
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

function formatReportPeriod(report: MemoryAnalysisReport): string {
  const start = formatShortDate(report.startTime);
  const end = formatShortDate(report.endTime);
  if (!start && !end) return "-";
  if (!start || !end) return start || end;
  return `${start} - ${end}`;
}

function formatShortDate(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}
