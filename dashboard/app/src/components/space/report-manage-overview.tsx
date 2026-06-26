import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Activity,
  ArrowUpRight,
  BrainCircuit,
  ChevronRight,
  Flag,
  Play,
  Sprout,
} from "lucide-react";
import {
  useMemoryAnalysisReports,
  type MemoryAnalysisReport,
  type MemoryAnalysisReportType,
} from "@/api/memory-analysis-reports";
import { Button } from "@/components/ui/button";
import { REPORT_PDF_API_KEY_STORAGE_KEY } from "@/lib/report-pdf";
import { cn } from "@/lib/utils";

type TemplateId = "weekly" | "trend" | "structure" | "growth";

const templateIcons = {
  weekly: Activity,
  trend: Flag,
  structure: BrainCircuit,
  growth: Sprout,
} as const;

const workflowSteps = [0, 1, 2] as const;
const reportTypeByTemplate: Record<TemplateId, MemoryAnalysisReportType | null> = {
  weekly: "focus_area",
  trend: "long_term_goal",
  structure: "emotion",
  growth: null,
};

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
      (["weekly", "trend", "structure", "growth"] as const).map((id) => ({
        id,
        name: t(`report_manage.templates.${id}.name`),
        cadence: t(`report_manage.templates.${id}.cadence`),
        lastGenerated: t(`report_manage.templates.${id}.last_generated`),
      })),
    [t],
  );

  const selected = templates.find((template) => template.id === selectedTemplate) ?? templates[0]!;
  const SelectedIcon = templateIcons[selectedTemplate];
  const reportType = reportTypeByTemplate[selectedTemplate];
  const reportsQuery = useMemoryAnalysisReports(spaceId, reportType);
  const reports = reportsQuery.data?.reports ?? [];

  const generate = () => {
    toast.success(t("report_manage.generate_success", { template: selected.name }));
  };

  const openPdfReport = (report: MemoryAnalysisReport) => {
    window.localStorage.setItem(REPORT_PDF_API_KEY_STORAGE_KEY, spaceId);
    const reportUrl = new URL(`${import.meta.env.BASE_URL}report-pdf`, window.location.origin);
    reportUrl.searchParams.set("reportId", String(report.report_id));
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
            <h3 className="text-base font-semibold tracking-[-0.03em]">{t("report_manage.library_title")}</h3>
            <div className="mt-4 space-y-2">
              {templates.map((template) => {
                const Icon = templateIcons[template.id];
                const active = template.id === selectedTemplate;
                return <button key={template.id} onClick={() => setSelectedTemplate(template.id)} className={cn("w-full rounded-xl border p-3 text-left transition-all", active ? "border-ring/45 bg-ring/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" : "border-foreground/7 bg-background/25 hover:border-foreground/16 hover:bg-foreground/[0.025]")}>
                  <div className="flex items-center gap-2.5"><span className="flex size-7 items-center justify-center rounded-lg bg-foreground/[0.06] text-ring"><Icon className="size-3.5" /></span><span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{template.name}</span><span className="rounded-md bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">{t("report_manage.enabled")}</span></div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-soft-foreground"><span>{t("report_manage.cadence", { value: template.cadence })}</span><ChevronRight className="size-3.5" /></div>
                  <p className="mt-1 text-[11px] text-soft-foreground">{t("report_manage.last_generated", { value: template.lastGenerated })}</p>
                </button>;
              })}
            </div>
            <p className="mt-4 text-xs text-soft-foreground">{t("report_manage.template_count", { count: templates.length })}</p>
          </aside>

          <div className="min-w-0 space-y-4">
            <div>
              <p className="text-base font-semibold tracking-[-0.03em] text-foreground">{t("report_manage.details_title")}</p>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="flex size-10 items-center justify-center rounded-full bg-blue-500/20 text-blue-400 shadow-[0_0_22px_rgba(59,130,246,0.18)]">
                  <SelectedIcon className="size-4" />
                </span>
                <span className="text-[clamp(1.05rem,1.55vw,1.3rem)] font-semibold leading-none tracking-[-0.04em] text-foreground">{selected.name}</span>
                <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">{t("report_manage.enabled")}</span>
                <span className="text-sm font-medium text-soft-foreground">v1.0</span>
              </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,.82fr)_minmax(0,1.18fr)]">
              <div className="rounded-3xl border border-foreground/10 bg-foreground/[0.024] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-6">
                <h3 className="text-lg font-semibold tracking-[-0.035em]">{t("report_manage.description_title")}</h3>
                <dl className="mt-5 space-y-4 text-sm">
                  <DetailRow label={t("report_manage.goal_label")} value={t(`report_manage.templates.${selectedTemplate}.goal`)} />
                  <DetailRow label={t("report_manage.period_label")} value={selected.cadence} />
                  <DetailRow label={t("report_manage.input_label")} value={t("report_manage.input_value")} />
                  <DetailRow label={t("report_manage.output_label")} value={t("report_manage.output_value")} />
                  <DetailRow label={t("report_manage.evidence_label")} value={t("report_manage.evidence_value")} />
                </dl>
              </div>
              <div className="rounded-3xl border border-foreground/10 bg-foreground/[0.024] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-6">
                <h3 className="text-lg font-semibold tracking-[-0.035em]">{t("report_manage.handoff_title")}</h3>
                <p className="mt-2 text-xs font-medium leading-relaxed text-soft-foreground">
                  {t("report_manage.handoff_body", { template: selected.name })}
                </p>
                <div className="mt-5 space-y-2.5">
                  {workflowSteps.map((step) => (
                    <div key={step} className="grid gap-2.5 rounded-2xl border border-foreground/10 bg-background/25 px-4 py-3 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] sm:grid-cols-[10.5rem_minmax(0,1fr)] sm:items-center">
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

            <div className="overflow-hidden rounded-2xl border border-foreground/7 bg-foreground/[0.018]">
              <div className="flex items-center justify-between border-b border-foreground/7 px-4 py-3">
                <h3 className="font-semibold">{t("report_manage.history_title")}</h3>
                <Button onClick={generate} className="rounded-xl"><Play className="size-4" />{t("report_manage.generate_template")}</Button>
              </div>
              <div className="divide-y divide-foreground/7">
                {!reportType ? (
                  <ReportHistoryMessage>{t("report_manage.report_type_unavailable")}</ReportHistoryMessage>
                ) : reportsQuery.isLoading ? (
                  <ReportHistoryMessage>{t("report_manage.report_history_loading")}</ReportHistoryMessage>
                ) : reportsQuery.isError ? (
                  <ReportHistoryMessage>{t("report_manage.report_history_failed")}</ReportHistoryMessage>
                ) : reports.length === 0 ? (
                  <ReportHistoryMessage>{t("report_manage.report_history_empty")}</ReportHistoryMessage>
                ) : (
                  reports.map((report) => (
                    <div key={report.report_id} className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[1.15fr_.7fr_.8fr_auto] sm:items-center">
                      <span className="font-medium">{formatReportGeneratedAt(report.generated_at)}</span>
                      <span>
                        <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", report.render_status === "success" ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" : "bg-red-500/12 text-red-600 dark:text-red-400")}>
                          {report.render_status === "success" ? t("report_manage.complete") : t("report_manage.failed")}
                        </span>
                      </span>
                      <span className="truncate text-muted-foreground" title={report.fail_reason || report.template_id}>
                        {report.render_status === "fail" && report.fail_reason ? report.fail_reason : t("report_manage.memory_count", { count: report.memory_count })}
                      </span>
                      <div className="flex gap-2">
                        <Button variant="outline" size="xs" disabled={report.render_status !== "success"} onClick={() => openPdfReport(report)}>{t("report_manage.view_template")}<ArrowUpRight className="size-3" /></Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <p className="flex items-center gap-2 text-xs text-soft-foreground"><span className="flex size-4 items-center justify-center rounded-full border border-current text-[10px]">i</span>{t("report_manage.note")}</p>
          </div>
        </div>
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

function formatReportGeneratedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value || "-";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}
